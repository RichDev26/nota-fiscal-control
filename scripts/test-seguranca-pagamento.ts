/**
 * Suíte adversarial: tenta CONCEDER ACESSO SEM PAGAR de todas as formas
 * plausíveis. Todo teste passa quando o ataque FALHA.
 *
 * Pré-requisito: servidor de dev rodando (porta informada via env BASE_URL,
 * ou http://localhost:3000 por padrão — o `next dev` pode escolher outra
 * porta se 3000 estiver ocupada; rode com BASE_URL=http://localhost:XXXX).
 * Execução: npx tsx scripts/test-seguranca-pagamento.ts
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import prisma from '../src/lib/prisma';
import { processarPagamentoAprovado } from '../src/lib/assinatura/servico';
import { temAcessoAtivo } from '../src/lib/assinatura/acesso';
import { MAX_TENTATIVAS } from '../src/lib/payments/rate-limit-pagamento';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
let falhas = 0;
const check = (n: string, ok: boolean, d = '') => { console.log(`${ok ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`); if (!ok) falhas++; };
const dia = 24 * 60 * 60 * 1000;

if (!process.env.MP_WEBHOOK_SECRET) {
  console.warn('⚠️  ATAQUE webhook NÃO exercita verificação HMAC neste ambiente (MP_WEBHOOK_SECRET ausente). Rode com credenciais de sandbox antes do go-live.');
}

let proximoIpFake = 1;

async function criarUsuarioBloqueado(sufixo: string) {
  const email = `sec-${sufixo}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemplo.com`;
  // /api/auth/register tem rate limit de 5/15min POR IP (checkAuthRateLimit) —
  // não relacionado ao que esta suíte testa. Sem variar o IP, a própria
  // suíte (que cria ~15 usuários) trombaria nesse limiter alheio antes de
  // chegar nos ataques de pagamento. x-forwarded-for único por usuário evita
  // isso sem tocar em nenhuma defesa real.
  const ipFake = `10.99.${Math.floor(proximoIpFake / 250)}.${proximoIpFake % 250}`;
  proximoIpFake++;
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ipFake },
    body: JSON.stringify({ email, senha: 'Teste1234', nome: 'Sec Teste' }),
  });
  if (!r.ok) throw new Error(`register falhou: ${r.status} — ${await r.text()}`);
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];

  const usuario = await prisma.usuario.findUnique({ where: { email } });
  // Expira o trial: usuário passa a estar BLOQUEADO.
  // Também grava um CPF já validado direto no banco (bypass do validarCpfCnpj):
  // sem isso TODO ataque via /api/assinatura/cartao pararia trivialmente no
  // gate de "informe um CPF/CNPJ" antes de alcançar a lógica que o ataque
  // realmente quer testar (preço, status, corrida etc.) — isso é drift real
  // entre o brief e o código atual, então ajustamos aqui para que os ataques
  // exercitem a defesa de verdade, não um 400 raso.
  await prisma.assinatura.update({
    where: { usuarioId: usuario!.id },
    data: { trialFimEm: new Date(Date.now() - dia), periodoFimEm: null },
  });
  await prisma.usuario.update({ where: { id: usuario!.id }, data: { cpfCnpj: '52998224725' } });
  return { usuario: usuario!, cookie, email };
}

const temAcesso = async (usuarioId: string) =>
  temAcessoAtivo(await prisma.assinatura.findUnique({ where: { usuarioId } }));

// Limpa o guard de "cobrança em voo" para o usuário, simulando uma recusa
// terminal do gateway — usado para isolar ataques que precisam passar pelo
// guard de idempotência antes de alcançar a defesa que estão testando de verdade.
const limparEmVoo = (usuarioId: string) =>
  prisma.cobranca.updateMany({ where: { assinatura: { usuarioId } }, data: { status: 'REJEITADA' } });

(async () => {
  const criados: string[] = [];

  try {
    // ══ ATAQUE 1: forjar aprovação no corpo da requisição ══
    {
      const { usuario, cookie } = await criarUsuarioBloqueado('forjar');
      criados.push(usuario.id);
      const r = await fetch(`${BASE}/api/assinatura/cartao`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          planoId: 'mensal', token: 'token-falso', paymentMethodId: 'visa', installments: 1,
          // campos maliciosos:
          aprovado: true, status: 'approved', paymentStatus: 'approved',
          valor: 0.01, transaction_amount: 0.01,
        }),
      });
      const d = await r.json().catch(() => ({}));
      check('ATAQUE forjar aprovado=true no body → não concede', d.aprovado !== true);
      check('ATAQUE forjar → usuário continua bloqueado', (await temAcesso(usuario.id)) === false);
    }

    // ══ ATAQUE 2: manipular o preço ══
    {
      const { usuario, cookie } = await criarUsuarioBloqueado('preco');
      criados.push(usuario.id);
      await fetch(`${BASE}/api/assinatura/cartao`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ planoId: 'mensal', valor: 0.01, preco: 0.01, token: 'x', paymentMethodId: 'visa', installments: 1 }),
      });
      const cobrancas = await prisma.cobranca.findMany({
        where: { assinatura: { usuarioId: usuario.id } },
      });
      check('ATAQUE manipular preço → ao menos uma cobrança foi criada (ataque alcançou a lógica)', cobrancas.length > 0);
      const precoErrado = cobrancas.some(c => c.valor !== 149.9);
      check('ATAQUE manipular preço → cobrança sempre com o valor do catálogo', !precoErrado);
      check('ATAQUE preço → usuário continua bloqueado', (await temAcesso(usuario.id)) === false);
    }

    // ══ ATAQUE 3: plano inexistente / prototype pollution ══
    {
      const { usuario, cookie } = await criarUsuarioBloqueado('plano');
      criados.push(usuario.id);
      for (const planoId of ['gratis', '__proto__', 'constructor', 'toString']) {
        const r = await fetch(`${BASE}/api/assinatura/cartao`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ planoId, token: 'x', paymentMethodId: 'visa', installments: 1 }),
        });
        const d = await r.json().catch(() => ({}));
        check(`ATAQUE planoId="${planoId}" → rejeitado (400)`, r.status === 400);
        check(`ATAQUE planoId="${planoId}" → mensagem é a específica de plano inválido (não um 400 genérico de outro gate)`, d.mensagem === 'Plano inválido.', `mensagem="${d.mensagem}"`);
      }
      const cobrancasPlano = await prisma.cobranca.findMany({ where: { assinatura: { usuarioId: usuario.id } } });
      check('ATAQUE plano → nenhuma Cobranca foi criada (rejeitado antes de tocar o banco)', cobrancasPlano.length === 0, `cobrancas=${cobrancasPlano.length}`);
      check('ATAQUE plano → usuário continua bloqueado', (await temAcesso(usuario.id)) === false);
    }

    // ══ ATAQUE 4: injeção cross-user — atacante manda os IDs da VÍTIMA no corpo ══
    // A rota afirma que "a assinatura é sempre a DO USUÁRIO DA SESSÃO — nunca
    // um id vindo do corpo" (comentário em src/app/api/assinatura/cartao/route.ts).
    // O ataque de verdade é provar isso: mandar usuarioId/assinaturaId/mpPaymentId/
    // cobrancaId da vítima e verificar que nada disso é lido.
    {
      const vitima   = await criarUsuarioBloqueado('vitima');
      const atacante = await criarUsuarioBloqueado('atacante');
      criados.push(vitima.usuario.id, atacante.usuario.id);

      const assinaturaVitima = await prisma.assinatura.findUnique({ where: { usuarioId: vitima.usuario.id } });
      const mpId = `mp-vitima-${Date.now()}`;
      const cobrancaVitima = await prisma.cobranca.create({
        data: { assinaturaId: assinaturaVitima!.id, valor: 149.9, moeda: 'BRL', idempotencyKey: `idem-${mpId}`, mpPaymentId: mpId },
      });
      // Pagamento REAL e aprovado — mas pertence à vítima.
      await processarPagamentoAprovado({
        mpPaymentId: mpId, status: 'approved', statusDetail: 'accredited',
        valor: 149.9, moeda: 'BRL', liveMode: true,
      });
      check('vítima que pagou recebeu acesso', (await temAcesso(vitima.usuario.id)) === true);
      const cobrancasVitimaAntes = await prisma.cobranca.count({ where: { assinaturaId: assinaturaVitima!.id } });

      // ATACANTE autenticado envia os identificadores da vítima no corpo.
      await fetch(`${BASE}/api/assinatura/cartao`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: atacante.cookie },
        body: JSON.stringify({
          planoId: 'mensal', token: 'token-invalido', paymentMethodId: 'visa', installments: 1,
          usuarioId: vitima.usuario.id, assinaturaId: assinaturaVitima!.id,
          mpPaymentId: mpId, cobrancaId: cobrancaVitima.id,
        }),
      }).then(r => r.json()).catch(() => ({}));

      const assinaturaAtacante = await prisma.assinatura.findUnique({ where: { usuarioId: atacante.usuario.id } });
      const cobrancasAtacante = await prisma.cobranca.findMany({ where: { assinatura: { usuarioId: atacante.usuario.id } } });
      check('ATAQUE injeção cross-user → toda cobrança criada pertence à assinatura do ATACANTE (nunca a da vítima)',
        cobrancasAtacante.length > 0 && cobrancasAtacante.every(c => c.assinaturaId === assinaturaAtacante!.id));
      const cobrancasVitimaDepois = await prisma.cobranca.count({ where: { assinaturaId: assinaturaVitima!.id } });
      check('ATAQUE injeção cross-user → nº de cobranças da vítima inalterado', cobrancasVitimaDepois === cobrancasVitimaAntes,
        `antes=${cobrancasVitimaAntes} depois=${cobrancasVitimaDepois}`);
      check('ATAQUE injeção cross-user → atacante continua sem acesso', (await temAcesso(atacante.usuario.id)) === false);

      // Reprocessar o mesmo pagamento (da vítima) não estende nada.
      const antes = (await prisma.assinatura.findUnique({ where: { usuarioId: vitima.usuario.id } }))!.periodoFimEm!;
      const replay = await processarPagamentoAprovado({
        mpPaymentId: mpId, status: 'approved', statusDetail: 'accredited',
        valor: 149.9, moeda: 'BRL', liveMode: true,
      });
      const depois = (await prisma.assinatura.findUnique({ where: { usuarioId: vitima.usuario.id } }))!.periodoFimEm!;
      check('ATAQUE replay do mesmo pagamento → recusado', replay.processado === false);
      check('ATAQUE replay → período inalterado', antes.getTime() === depois.getTime());

      // Vetor de mpPaymentId fabricado — sem Cobranca correspondente no banco.
      const rFabricado = await processarPagamentoAprovado({
        mpPaymentId: `nao-existe-${Date.now()}`, status: 'approved', statusDetail: 'accredited',
        valor: 149.9, moeda: 'BRL', liveMode: true,
      });
      check('ATAQUE mpPaymentId fabricado → cobranca_nao_encontrada', rFabricado.processado === false && rFabricado.motivo === 'cobranca_nao_encontrada');
    }

    // ══ ATAQUE 5: webhook forjado (sem assinatura HMAC válida) ══
    {
      const { usuario } = await criarUsuarioBloqueado('webhook');
      criados.push(usuario.id);
      const assinatura = await prisma.assinatura.findUnique({ where: { usuarioId: usuario.id } });
      const mpId = `mp-forjado-${Date.now()}`;
      await prisma.cobranca.create({
        data: { assinaturaId: assinatura!.id, valor: 149.9, moeda: 'BRL', idempotencyKey: `idem-${mpId}`, mpPaymentId: mpId },
      });

      // Neste ambiente MP_WEBHOOK_SECRET está ausente, então validarAssinaturaWebhook
      // faz short-circuit em `!secret` e SEMPRE rejeita — o caminho HMAC não é
      // exercitado aqui. Os nomes abaixo documentam exatamente isso, para não
      // afirmar uma cobertura que este ambiente não estabelece. A cobertura de
      // HMAC de verdade vive em src/lib/payments/test-mercadopago.ts.
      for (const [nome, headers] of [
        ['sem assinatura', {}],
        ['assinatura forjada', { 'x-signature': 'ts=1,v1=deadbeef', 'x-request-id': 'req-falso' }],
      ] as Array<[string, Record<string, string>]>) {
        const r = await fetch(`${BASE}/api/webhooks/mercadopago?data.id=${mpId}`, { method: 'POST', headers });
        check(`ATAQUE webhook ${nome} → 401 (neste ambiente rejeitado por MP_WEBHOOK_SECRET ausente, não por HMAC — cobertura de HMAC em src/lib/payments/test-mercadopago.ts)`, r.status === 401);
      }
      check('ATAQUE webhook forjado → usuário continua bloqueado', (await temAcesso(usuario.id)) === false);
    }

    // ══ ATAQUE 6: enumeração de rotas — TODA rota GET fora do allowlist deve 402 sem assinatura ══
    // Em vez de uma lista fixa (cega a rotas novas), varre src/app/api/**/route.ts
    // de verdade e testa cada uma. Só ficam de fora prefixos intencionalmente
    // não-gateados por assinatura (auth, a própria assinatura, webhooks do
    // gateway, e a fila — gateada por admin separadamente) e rotas /sweep
    // (cron interno, não acessado por usuário final).
    {
      const { usuario, cookie } = await criarUsuarioBloqueado('rota');
      criados.push(usuario.id);

      const ALLOWLIST_PREFIXES = ['api/auth/', 'api/assinatura/', 'api/webhooks/', 'api/fila/'];
      const API_DIR = join(__dirname, '..', 'src', 'app', 'api');

      const walk = (dir: string, base = ''): string[] => {
        const out: string[] = [];
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry);
          const rel = base ? `${base}/${entry}` : entry;
          if (statSync(full).isDirectory()) out.push(...walk(full, rel));
          else if (entry === 'route.ts') out.push(rel);
        }
        return out;
      };

      const todasRotas = walk(API_DIR).map(f => f.replace(/\\/g, '/'));
      const candidatas = todasRotas.filter(f => {
        const apiPath = `api/${f.replace(/\/route\.ts$/, '')}`;
        if (ALLOWLIST_PREFIXES.some(p => apiPath.startsWith(p))) return false;
        if (apiPath.endsWith('/sweep')) return false;
        return true;
      });

      const rotasParaTestar: string[] = [];
      for (const f of candidatas) {
        const conteudo = readFileSync(join(API_DIR, f), 'utf-8');
        if (!/export async function GET/.test(conteudo)) continue; // sem GET, nada a testar aqui
        const urlPath = '/api/' + f.replace(/\/route\.ts$/, '').replace(/\[[^\]]+\]/g, 'x');
        rotasParaTestar.push(urlPath);
      }

      console.log(`   rotas enumeradas para o gate de assinatura (${rotasParaTestar.length}): ${rotasParaTestar.join(', ')}`);
      for (const rota of rotasParaTestar) {
        const r = await fetch(`${BASE}${rota}`, { headers: { Cookie: cookie } });
        check(`ATAQUE acessar ${rota} sem assinatura → 402`, r.status === 402, `status=${r.status}`);
      }
    }

    // ══ ATAQUE 7: status não-aprovado nunca concede (todos os estados do MP) ══
    {
      const { usuario } = await criarUsuarioBloqueado('status');
      criados.push(usuario.id);
      const assinatura = await prisma.assinatura.findUnique({ where: { usuarioId: usuario.id } });

      for (const status of ['pending', 'in_process', 'in_mediation', 'rejected', 'cancelled', 'refunded', 'charged_back', 'authorized']) {
        const mpId = `mp-${status}-${Date.now()}`;
        await prisma.cobranca.create({
          data: { assinaturaId: assinatura!.id, valor: 149.9, moeda: 'BRL', idempotencyKey: `idem-${mpId}`, mpPaymentId: mpId },
        });
        await processarPagamentoAprovado({
          mpPaymentId: mpId, status, statusDetail: null, valor: 149.9, moeda: 'BRL', liveMode: true,
        });
        check(`ATAQUE status "${status}" → NÃO concede acesso`, (await temAcesso(usuario.id)) === false);
      }
    }

    // ══ ATAQUE 8: pagar menos que o preço do plano (underpayment) ══
    {
      const { usuario } = await criarUsuarioBloqueado('valor');
      criados.push(usuario.id);
      const assinatura = await prisma.assinatura.findUnique({ where: { usuarioId: usuario.id } });
      const mpId = `mp-barato-${Date.now()}`;
      await prisma.cobranca.create({
        data: { assinaturaId: assinatura!.id, valor: 149.9, moeda: 'BRL', idempotencyKey: `idem-${mpId}`, mpPaymentId: mpId },
      });
      const r = await processarPagamentoAprovado({
        mpPaymentId: mpId, status: 'approved', statusDetail: 'accredited',
        valor: 0.01, moeda: 'BRL', liveMode: true,
      });
      check('ATAQUE pagar R$0,01 por plano de R$149,90 → recusado', r.processado === false && r.motivo === 'valor_divergente');
      check('ATAQUE valor menor → usuário continua bloqueado', (await temAcesso(usuario.id)) === false);
    }

    // ══ ATAQUE 9: overpayment — pagar um pouco A MAIS deve ser ACEITO ══
    // (não é burla de acesso: negar deixaria um cliente que já pagou sem acesso;
    //  incluído para provar que a defesa de valor não é ingênua/simétrica)
    {
      const { usuario } = await criarUsuarioBloqueado('overpay');
      criados.push(usuario.id);
      const assinatura = await prisma.assinatura.findUnique({ where: { usuarioId: usuario.id } });
      const mpId = `mp-overpay-${Date.now()}`;
      await prisma.cobranca.create({
        data: { assinaturaId: assinatura!.id, valor: 149.9, moeda: 'BRL', idempotencyKey: `idem-${mpId}`, mpPaymentId: mpId },
      });
      const r = await processarPagamentoAprovado({
        mpPaymentId: mpId, status: 'approved', statusDetail: 'accredited',
        valor: 150.9, moeda: 'BRL', liveMode: true,
      });
      check('overpagar (R$150,90 por plano de R$149,90) → aceito', r.processado === true);
      check('overpagar → usuário recebe acesso (cliente já foi cobrado)', (await temAcesso(usuario.id)) === true);
    }

    // ══ ATAQUE 10: moeda divergente — pagamento aprovado em moeda diferente ══
    {
      const { usuario } = await criarUsuarioBloqueado('moeda');
      criados.push(usuario.id);
      const assinatura = await prisma.assinatura.findUnique({ where: { usuarioId: usuario.id } });
      const mpId = `mp-moeda-${Date.now()}`;
      await prisma.cobranca.create({
        data: { assinaturaId: assinatura!.id, valor: 149.9, moeda: 'BRL', idempotencyKey: `idem-${mpId}`, mpPaymentId: mpId },
      });
      const r = await processarPagamentoAprovado({
        mpPaymentId: mpId, status: 'approved', statusDetail: 'accredited',
        valor: 149.9, moeda: 'USD', liveMode: true,
      });
      check('ATAQUE moeda divergente (USD numa cobrança BRL) → recusado', r.processado === false && r.motivo === 'moeda_divergente');
      check('ATAQUE moeda → usuário continua bloqueado', (await temAcesso(usuario.id)) === false);
    }

    // ══ ATAQUE 11: pagamento de TESTE (liveMode=false) sendo aprovado em produção ══
    // O pior modo de falha do sistema: um pagamento de sandbox concedendo
    // acesso real em produção. processarPagamentoAprovado lê process.env.NODE_ENV
    // na hora da chamada, e o núcleo já é chamado in-process por esta suíte.
    {
      const { usuario } = await criarUsuarioBloqueado('ambiente');
      criados.push(usuario.id);
      const assinatura = await prisma.assinatura.findUnique({ where: { usuarioId: usuario.id } });
      const mpId = `mp-ambiente-${Date.now()}`;
      await prisma.cobranca.create({
        data: { assinaturaId: assinatura!.id, valor: 149.9, moeda: 'BRL', idempotencyKey: `idem-${mpId}`, mpPaymentId: mpId },
      });

      const antesEnv = process.env.NODE_ENV;
      try {
        Object.defineProperty(process.env, 'NODE_ENV', { value: 'production', configurable: true, writable: true, enumerable: true });
        const r = await processarPagamentoAprovado({
          mpPaymentId: mpId, status: 'approved', statusDetail: 'accredited',
          valor: 149.9, moeda: 'BRL', liveMode: false,
        });
        check('ATAQUE pagamento de TESTE em produção → recusado', r.processado === false && r.motivo === 'ambiente_divergente');
        check('ATAQUE ambiente → usuário continua bloqueado', (await temAcesso(usuario.id)) === false);
      } finally {
        Object.defineProperty(process.env, 'NODE_ENV', { value: antesEnv, configurable: true, writable: true, enumerable: true });
      }
    }

    // ══ ATAQUE 12: replay de status terminal — cobrança já REJEITADA recebe um "approved" ══
    {
      const { usuario } = await criarUsuarioBloqueado('terminal');
      criados.push(usuario.id);
      const assinatura = await prisma.assinatura.findUnique({ where: { usuarioId: usuario.id } });
      const mpId = `mp-terminal-${Date.now()}`;
      await prisma.cobranca.create({
        data: { assinaturaId: assinatura!.id, valor: 149.9, moeda: 'BRL', idempotencyKey: `idem-${mpId}`, mpPaymentId: mpId, status: 'REJEITADA' },
      });
      const r = await processarPagamentoAprovado({
        mpPaymentId: mpId, status: 'approved', statusDetail: 'accredited',
        valor: 149.9, moeda: 'BRL', liveMode: true,
      });
      // O CAS só casa cobranças PENDENTE/PROCESSANDO — uma cobrança REJEITADA
      // (estado terminal) nunca é pega pelo compare-and-swap, então a resposta
      // real do núcleo é 'ja_processada' (não um motivo específico de "terminal").
      // Documentamos aqui o comportamento real, não o que o brief presumia.
      check('ATAQUE replay approved sobre cobrança REJEITADA → não processa', r.processado === false);
      check('ATAQUE replay terminal → motivo é ja_processada (CAS não casa estado terminal)', r.motivo === 'ja_processada');
      check('ATAQUE replay terminal → usuário continua bloqueado (nenhum 2º grant)', (await temAcesso(usuario.id)) === false);
      const cobrancaFinal = await prisma.cobranca.findUnique({ where: { mpPaymentId: mpId } });
      check('ATAQUE replay terminal → status da cobrança não foi alterado para APROVADA', cobrancaFinal?.status === 'REJEITADA');
    }

    // ══ ATAQUE 13: duplo clique / requisição concorrente duplicada ══
    {
      // 13a — núcleo: a MESMA cobrança recebendo dois "approved" concorrentes
      // (é exatamente o cenário que o comentário de processarPagamentoAprovado
      // descreve: resposta síncrona do cartão + webhook chegando juntos).
      const { usuario } = await criarUsuarioBloqueado('duplo-nucleo');
      criados.push(usuario.id);
      const assinatura = await prisma.assinatura.findUnique({ where: { usuarioId: usuario.id } });
      const mpId = `mp-duplo-${Date.now()}`;
      await prisma.cobranca.create({
        data: { assinaturaId: assinatura!.id, valor: 149.9, moeda: 'BRL', idempotencyKey: `idem-${mpId}`, mpPaymentId: mpId },
      });
      const snapshot = { mpPaymentId: mpId, status: 'approved', statusDetail: 'accredited', valor: 149.9, moeda: 'BRL', liveMode: true };
      const [r1, r2] = await Promise.all([processarPagamentoAprovado(snapshot), processarPagamentoAprovado(snapshot)]);
      const aprovacoes = [r1, r2].filter(r => r.processado === true).length;
      check('ATAQUE duplo-clique (núcleo) → exatamente 1 das 2 chamadas concorrentes concede', aprovacoes === 1, `aprovacoes=${aprovacoes}`);
      const assinaturaDepois = await prisma.assinatura.findUnique({ where: { usuarioId: usuario.id } });
      const dias = (assinaturaDepois!.periodoFimEm!.getTime() - Date.now()) / dia;
      check('ATAQUE duplo-clique (núcleo) → período estendido só UMA vez (~30 dias, não ~60)', dias > 25 && dias < 32, `dias=${dias.toFixed(1)}`);

      // 13b — rota HTTP: dois POSTs simultâneos de cartão para o MESMO usuário.
      // Sem MP_ACCESS_TOKEN configurado neste ambiente o gateway nunca é
      // alcançado de verdade — o que a suíte pode provar aqui é a garantia que
      // vem ANTES do gateway: a chave de idempotência determinística bloqueia a
      // segunda requisição antes dela criar uma segunda cobrança/tentar
      // capturar de novo. Deve existir EXATAMENTE uma linha de Cobranca no fim
      // (não "no máximo 1" — 0 também seria uma regressão silenciosa, ex.: as
      // duas requisições sendo 400'adas por engano antes de chegar aqui).
      const { usuario: usuario2, cookie } = await criarUsuarioBloqueado('duplo-http');
      criados.push(usuario2.id);
      const body = JSON.stringify({ planoId: 'mensal', token: 'token-invalido', paymentMethodId: 'visa', installments: 1 });
      await Promise.all([
        fetch(`${BASE}/api/assinatura/cartao`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body }),
        fetch(`${BASE}/api/assinatura/cartao`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body }),
      ]);
      const cobrancasDuplo = await prisma.cobranca.findMany({ where: { assinatura: { usuarioId: usuario2.id } } });
      check('ATAQUE duplo-clique (HTTP) → exatamente 1 cobrança chegou a tentar o gateway', cobrancasDuplo.length === 1, `cobrancas=${cobrancasDuplo.length}`);
      check('ATAQUE duplo-clique (HTTP) → usuário continua bloqueado', (await temAcesso(usuario2.id)) === false);
    }

    // ══ ATAQUE 14: rajada de requisições simultâneas (10x, retry agressivo) ══
    {
      const { usuario, cookie } = await criarUsuarioBloqueado('rajada');
      criados.push(usuario.id);
      const disparos = Array.from({ length: 10 }, () =>
        fetch(`${BASE}/api/assinatura/cartao`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ planoId: 'mensal', token: 'token-invalido', paymentMethodId: 'visa', installments: 1 }),
        }).then(r => r.status).catch(() => 0),
      );
      const status = await Promise.all(disparos);
      check('ATAQUE 10 requisições simultâneas → nenhuma concede acesso', (await temAcesso(usuario.id)) === false);
      // Adaptado do brief: com o guard de "cobrança em voo" (409) adicionado
      // depois da revisão, a rajada agora produz uma MISTURA de 409 (em voo) e
      // 429 (rate limit) — não só 429. O que prova ausência de burla é que a
      // rajada foi rejeitada de alguma forma (409 e/ou 429), não qual código
      // específico apareceu; a asserção de acesso acima é que é decisiva.
      check('ATAQUE rajada → rejeitada por 409 (em voo) e/ou 429 (rate limit)',
        status.some(s => s === 409 || s === 429), `status=${status.join(',')}`);
      // Parte estrita que continua válida mesmo com a mistura 409/429: NENHUM
      // disparo da rajada teve sucesso (200).
      check('ATAQUE rajada → nenhuma resposta 200 (sucesso)', !status.includes(200), `status=${status.join(',')}`);
    }

    // ══ ATAQUE 15 (C-1): card testing — tentativas sequenciais com cartão recusado ══
    // Esta é a rajada REALISTA de card testing: não é concorrência, é uma
    // sequência onde cada tentativa recebe uma recusa terminal do gateway antes
    // da próxima. Zeramos o guard "em voo" entre tentativas (simulando essa
    // recusa) para que o que sobra a barrar seja EXATAMENTE o rate limiter —
    // isolando essa defesa do guard de concorrência da ATAQUE 14.
    {
      const { usuario, cookie } = await criarUsuarioBloqueado('card-testing');
      criados.push(usuario.id);
      const statuses: number[] = [];
      for (let i = 0; i < MAX_TENTATIVAS + 1; i++) {
        const r = await fetch(`${BASE}/api/assinatura/cartao`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ planoId: 'mensal', token: 'token-invalido', paymentMethodId: 'visa', installments: 1 }),
        });
        statuses.push(r.status);
        await limparEmVoo(usuario.id);
      }
      check(`ATAQUE card testing → tentativa ${MAX_TENTATIVAS + 1} barrada por rate limit (429)`, statuses[MAX_TENTATIVAS] === 429, `status=${statuses.join(',')}`);
      check('ATAQUE card testing → nenhuma tentativa concede acesso', (await temAcesso(usuario.id)) === false);
    }
  } catch (e) {
    falhas++;
    console.log(`❌ SUÍTE ABORTOU NO MEIO: ${e instanceof Error ? e.message : e}`);
  } finally {
    // ── Limpeza: só o que esta suíte criou ──
    for (const id of criados) {
      await prisma.cobranca.deleteMany({ where: { assinatura: { usuarioId: id } } });
      await prisma.assinatura.deleteMany({ where: { usuarioId: id } });
      await prisma.usuario.deleteMany({ where: { id } });
    }
  }

  console.log(falhas === 0 ? '\n✅ TODOS OS ATAQUES FORAM BLOQUEADOS' : `\n❌ ${falhas} ATAQUE(S) NÃO FORAM BLOQUEADOS`);
  process.exit(falhas === 0 ? 0 : 1);
})();
