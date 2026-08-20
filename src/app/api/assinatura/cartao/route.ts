import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSession } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { validarCpfCnpj } from '@/lib/validators';
import { criarPagamentoCartao } from '@/lib/payments/mercadopago';
import { mensagemErroCartao } from '@/lib/payments/erros-cartao';
import { checkPagamentoRateLimit } from '@/lib/payments/rate-limit-pagamento';
import { processarPagamentoAprovado } from '@/lib/assinatura/servico';
import { resolverPlano } from '@/lib/assinatura/config';
import { logError, logInfo } from '@/lib/extractors/logger';

export const dynamic = 'force-dynamic';

// Mensagem usada sempre que o dinheiro pode ter sido debitado e não sabemos
// (ou sabemos que sim) se o acesso foi concedido. NUNCA convida a nova tentativa.
const MSG_EM_VERIFICACAO =
  'Seu pagamento foi recebido e está em verificação. Se o acesso não for liberado em alguns minutos, fale com o suporte — não tente pagar novamente.';

/**
 * Cobrança com cartão — síncrona.
 *
 * FRONTEIRA DE CONFIANÇA: do corpo da requisição usamos APENAS
 *   - planoId  → resolvido contra o catálogo server-side (preço nunca vem do cliente)
 *   - token, installments, paymentMethodId, issuerId → opacos, repassados ao gateway
 *   - cpfCnpj  → só quando o usuário ainda não tem um salvo
 * Qualquer outro campo enviado é ignorado. Status, valor, id de pagamento e
 * usuário JAMAIS são lidos do cliente.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Não autorizado', aprovado: false, mensagem: 'Não autorizado.' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { body = {}; }
  if (!body || typeof body !== 'object') body = {};

  // ── Plano: preço/moeda/duração vêm do servidor, nunca do cliente ──
  const plano = resolverPlano(body.planoId ?? 'mensal');
  if (!plano) return NextResponse.json({ aprovado: false, mensagem: 'Plano inválido.' }, { status: 400 });

  // ── Dados do cartão: opacos, só repassados ao gateway ──
  const token           = typeof body.token === 'string' ? body.token : '';
  const paymentMethodId = typeof body.paymentMethodId === 'string' ? body.paymentMethodId : '';
  // issuerId só é aceito se for uma string curta só de dígitos — criarPagamentoCartao
  // faz Number(issuerId) sem checar; uma string longa perderia precisão no Number(),
  // e uma não-numérica viraria NaN → null no body enviado ao gateway, silenciosamente.
  const issuerIdRaw = body.issuerId;
  const issuerId     = typeof issuerIdRaw === 'string' && /^\d{1,10}$/.test(issuerIdRaw) ? issuerIdRaw : undefined;
  if (!token || !paymentMethodId) {
    return NextResponse.json({ aprovado: false, mensagem: 'Dados do cartão incompletos. Tente novamente.' }, { status: 400 });
  }
  // Nesta fase só há plano à vista. Aceita só undefined (default 1) ou
  // literalmente o número 1 — rejeita qualquer outra coisa (strings, floats,
  // null) em vez de coagir silenciosamente para 1. Impede manipulação de parcelas.
  if (body.installments !== undefined && body.installments !== 1) {
    return NextResponse.json({ aprovado: false, mensagem: 'Número de parcelas inválido.' }, { status: 400 });
  }
  const installments = 1;

  const usuario = await prisma.usuario.findUnique({ where: { id: session.sub } });
  if (!usuario) {
    return NextResponse.json({ error: 'Usuário não encontrado', aprovado: false, mensagem: 'Usuário não encontrado.' }, { status: 404 });
  }

  let cpfCnpj = usuario.cpfCnpj;
  if (!cpfCnpj) {
    if (typeof body.cpfCnpj !== 'string' || !validarCpfCnpj(body.cpfCnpj)) {
      return NextResponse.json({ aprovado: false, mensagem: 'Informe um CPF ou CNPJ válido.', precisaCpfCnpj: true }, { status: 400 });
    }
    cpfCnpj = body.cpfCnpj.replace(/\D/g, '');
    await prisma.usuario.update({ where: { id: usuario.id }, data: { cpfCnpj } });
  }

  // A assinatura é sempre a DO USUÁRIO DA SESSÃO — nunca um id vindo do corpo.
  const assinatura = await prisma.assinatura.findUnique({ where: { usuarioId: usuario.id } });
  if (!assinatura) {
    return NextResponse.json({ error: 'Assinatura não encontrada', aprovado: false, mensagem: 'Assinatura não encontrada.' }, { status: 404 });
  }

  // Guard contra cobrança duplicada: se já há uma cobrança em voo (criada há
  // menos de 2min, ainda PROCESSANDO) para esta assinatura, recusa uma nova.
  // Sem isto, um retry na UI com token de cartão fresco gera uma nova cobrança
  // por tentativa — e cada aprovação concede outro período de acesso.
  // Fast path (não-atômico): resolve o caso comum sem tocar no unique
  // constraint. O guard real contra corrida está no idempotencyKey abaixo.
  const emVoo = await prisma.cobranca.findFirst({
    where: { assinaturaId: assinatura.id, status: 'PROCESSANDO', createdAt: { gt: new Date(Date.now() - 120_000) } },
  });
  if (emVoo) {
    return NextResponse.json(
      { aprovado: false, mensagem: 'Já existe um pagamento em processamento. Aguarde alguns instantes antes de tentar novamente.' },
      { status: 409 },
    );
  }

  // Rate limit por usuário (session.sub — nunca algo influenciável pelo cliente) —
  // anti card testing. Chave própria (não compartilhada com PIX) e verificado só
  // agora, imediatamente antes de criar a cobrança: toda validação acima já
  // passou, então só tentativas que de fato chegariam perto do gateway
  // consomem o orçamento, e uma requisição barrada por 429 não deixa linha no banco.
  const rl = checkPagamentoRateLimit(`cartao:${session.sub}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { aprovado: false, mensagem: `Muitas tentativas de pagamento. Aguarde ${Math.ceil(rl.retryAfter / 60)} minuto(s) e tente novamente.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    );
  }

  // Cobrança criada ANTES da chamada ao gateway: garante que todo pagamento
  // tenha registro local, mesmo se o processo cair no meio.
  //
  // Chave determinística por assinatura + janela de 2 min (em vez de um UUID
  // aleatório): dois cliques simultâneos no botão de pagar (ou duas abas)
  // geram a MESMA chave, então o unique constraint em idempotencyKey deixa
  // só um create passar — o outro cai no catch abaixo com P2002. Essa mesma
  // chave também é enviada ao Mercado Pago como X-Idempotency-Key, então
  // ganhamos de graça a idempotência do próprio gateway. Residual: duas
  // requisições a cavaleiro de uma fronteira de bucket ainda escapam do
  // unique local — mas a idempotência do MP sobre o mesmo token de cartão
  // cobre o caso comum, e a janela cai de "qualquer concorrência" para um
  // instante específico de poucos milissegundos.
  let idempotencyKey = `cartao:${assinatura.id}:${Math.floor(Date.now() / 120_000)}`;
  let cobranca;
  try {
    cobranca = await prisma.cobranca.create({
      data: {
        assinaturaId: assinatura.id,
        metodo:       'CARTAO',
        planoId:      plano.id,
        valor:        plano.valor,
        moeda:        plano.moeda,
        status:       'PROCESSANDO',
        parcelas:     installments,
        idempotencyKey,
      },
    });
  } catch (e) {
    if ((e as { code?: string }).code !== 'P2002') throw e;
    const anterior = await prisma.cobranca.findUnique({ where: { idempotencyKey } });
    // Só uma recusa TERMINAL libera nova tentativa dentro da mesma janela: nesses
    // estados nada foi capturado. PROCESSANDO/APROVADA seguem em 409 — é isso que
    // impede duplo clique e duplo período.
    if (anterior?.status !== 'REJEITADA' && anterior?.status !== 'CANCELADA') {
      return NextResponse.json(
        { aprovado: false, mensagem: 'Já existe um pagamento em processamento. Aguarde alguns instantes antes de tentar novamente.' },
        { status: 409 },
      );
    }
    // Chave NOVA e obrigatória: reusar a anterior faria o Mercado Pago devolver o
    // resultado cacheado da recusa, e o novo cartão nunca seria cobrado.
    idempotencyKey = `${idempotencyKey}:${randomUUID()}`;
    cobranca = await prisma.cobranca.create({
      data: {
        assinaturaId: assinatura.id,
        metodo:       'CARTAO',
        planoId:      plano.id,
        valor:        plano.valor,
        moeda:        plano.moeda,
        status:       'PROCESSANDO',
        parcelas:     installments,
        idempotencyKey,
      },
    });
  }

  let pagamento;
  try {
    pagamento = await criarPagamentoCartao({
      valor:             plano.valor,
      descricao:         plano.descricao,
      idempotencyKey,
      token,
      installments,
      paymentMethodId,
      issuerId,
      payerEmail:        usuario.email,
      payerCpfCnpj:      cpfCnpj,
      externalReference: cobranca.id,
    });
  } catch (err) {
    // Gateway indisponível / timeout / resposta inválida — indistinguível
    // localmente de "o Mercado Pago capturou mas a resposta não chegou".
    // Mantém a cobrança PROCESSANDO (nunca FALHA): FALHA é terminal e leria
    // como "nada foi cobrado", quando pode não ser o caso. PROCESSANDO deixa
    // o webhook reconciliar depois, e o guard acima bloqueia retry por 2min
    // enquanto não sabemos se o dinheiro foi debitado. Segue falhando fechado
    // (nenhum acesso concedido aqui).
    logError('assinatura.cartao', `Falha ao criar pagamento com cartão (cobranca ${cobranca.id})`, err as Error,
      { cobrancaId: cobranca.id, idempotencyKey });
    return NextResponse.json(
      { aprovado: false, mensagem: 'Não foi possível confirmar seu pagamento agora. Aguarde alguns minutos antes de tentar novamente — evite tentar de novo imediatamente.' },
      { status: 502 },
    );
  }

  try {
    // Vincula o pagamento do gateway à nossa cobrança e guarda só metadados
    // não-sensíveis (últimos 4 dígitos e bandeira vêm da RESPOSTA do gateway).
    await prisma.cobranca.update({
      where: { id: cobranca.id },
      data: {
        mpPaymentId:    pagamento.mpPaymentId,
        statusDetalhe:  pagamento.statusDetail,
        ultimosDigitos: pagamento.ultimosDigitos,
        bandeira:       pagamento.bandeira,
      },
    });

    // ── DECISÃO: delegada ao núcleo, que revalida status/valor/moeda/ambiente
    // e é idempotente contra o webhook do mesmo pagamento. ──
    const resultado = await processarPagamentoAprovado(pagamento);

    logInfo('assinatura.cartao', 'Pagamento com cartão processado', {
      cobrancaId: cobranca.id,
      status: pagamento.status,
      processado: resultado.processado,
      motivo: resultado.motivo,
    });

    if (resultado.processado) {
      return NextResponse.json({ aprovado: true });
    }

    // Não aprovado: registra o estado real e devolve mensagem segura.
    // 'ja_processada' significa que o webhook chegou primeiro — o acesso JÁ está
    // liberado, então para o usuário isso é sucesso.
    if (resultado.motivo === 'ja_processada') {
      return NextResponse.json({ aprovado: true });
    }

    // 'conflito_concorrencia': as 3 tentativas de retry do CAS perderam a corrida.
    // A cobrança pode ter sido de fato aprovada no gateway — não sabemos se outra
    // execução venceu ou se todas colidiram. Isto NÃO é uma recusa: reportar como
    // falha aqui seria mentir (o cartão pode já ter sido debitado), e marcar a
    // cobrança como REJEITADA fecharia a porta para o webhook completá-la depois.
    // Portanto: não tocamos no status da cobrança (fica como o CAS deixou —
    // PENDENTE/PROCESSANDO — para o webhook do mesmo pagamento processar em
    // seguida) e devolvemos uma mensagem de "em processamento" ao usuário.
    if (resultado.motivo === 'conflito_concorrencia') {
      return NextResponse.json({
        aprovado: false,
        mensagem: mensagemErroCartao('in_process', null),
      });
    }

    // O gateway APROVOU a cobrança (dinheiro capturado) mas o núcleo recusou
    // conceder acesso (valor/moeda/ambiente divergente). NUNCA convidar a
    // tentar de novo — isso duplicaria a cobrança em cima de um cliente que
    // já pagou. Loga em ERROR para alguém ser avisado (ex.: MP_ACCESS_TOKEN
    // de teste em produção faria TODA cobrança cair aqui).
    if (pagamento.status === 'approved') {
      logError('assinatura.cartao', `Pagamento aprovado NAO concedeu acesso: ${resultado.motivo}`, undefined,
        { cobrancaId: cobranca.id, mpPaymentId: pagamento.mpPaymentId, motivo: resultado.motivo });
      return NextResponse.json({ aprovado: false, mensagem: MSG_EM_VERIFICACAO });
    }

    const statusFinal =
      pagamento.status === 'rejected'  ? 'REJEITADA' :
      pagamento.status === 'cancelled' ? 'CANCELADA' :
      'PENDENTE';

    // Write CONDICIONAL: só avança se a linha ainda estiver PROCESSANDO (ou
    // seja, ainda é "nossa" para mover). Sem esta guarda, um write
    // incondicional poderia sobrescrever um APROVADA que o webhook do MESMO
    // pagamento já tenha aplicado via CAS (processarPagamentoAprovado) na
    // janela entre aquele CAS e este ponto — voltando a cobrança para
    // PENDENTE e deixando o próximo delivery do webhook rodar o CAS de novo,
    // concedendo um segundo período de acesso de graça.
    const rStatus = await prisma.cobranca.updateMany({
      where: { id: cobranca.id, status: 'PROCESSANDO' },
      data: { status: statusFinal },
    });
    if (rStatus.count === 0) {
      logError('assinatura.cartao', 'Status final nao aplicado (linha ja nao estava PROCESSANDO)', undefined,
        { cobrancaId: cobranca.id, statusFinal, mpPaymentId: pagamento.mpPaymentId });
    }

    return NextResponse.json({
      aprovado: false,
      mensagem: mensagemErroCartao(pagamento.status, pagamento.statusDetail),
    });
  } catch (err) {
    // Qualquer exceção daqui em diante acontece DEPOIS da captura no gateway
    // (pool esgotado, lock do SQLite, blip de conexão...). Loga cobrancaId +
    // mpPaymentId juntos para a cobrança ser sempre reconciliável a partir
    // dos logs, mesmo que mpPaymentId não tenha sido persistido no banco por
    // causa deste mesmo erro.
    //
    // A mensagem NÃO pode ser a mesma em todo caminho: se o gateway não
    // capturou (ex.: cartão recusado) e o erro só aconteceu na escrita local
    // do status final, dizer "pagamento recebido, não tente de novo" mente
    // para um cliente que não pagou nada e o deixa sem meio de tentar de
    // novo. Só quando sabemos que o MP aprovou é seguro (e necessário) travar
    // o retry — e nesse caso o status HTTP também muda para 202: uma falha
    // interna depois de uma captura real não pode passar por um 200
    // silencioso, senão fica invisível para alertas de 4xx/5xx.
    logError('assinatura.cartao', `Falha pós-captura ao processar pagamento com cartão (cobranca ${cobranca.id})`, err as Error,
      { cobrancaId: cobranca.id, mpPaymentId: pagamento.mpPaymentId });
    return NextResponse.json({
      aprovado: false,
      mensagem: pagamento.status === 'approved'
        ? MSG_EM_VERIFICACAO
        : mensagemErroCartao(pagamento.status, pagamento.statusDetail),
    }, { status: pagamento.status === 'approved' ? 202 : 200 });
  }
}
