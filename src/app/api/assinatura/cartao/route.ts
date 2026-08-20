import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSession } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { validarCpfCnpj } from '@/lib/validators';
import { criarAssinaturaRecorrente } from '@/lib/payments/mercadopago';
import { mensagemErroCartao } from '@/lib/payments/erros-cartao';
import { checkPagamentoRateLimit } from '@/lib/payments/rate-limit-pagamento';
import { processarPagamentoAprovado } from '@/lib/assinatura/servico';
import { resolverPlano } from '@/lib/assinatura/config';
import { temAcessoAtivo } from '@/lib/assinatura/acesso';
import { logError, logInfo } from '@/lib/extractors/logger';

export const dynamic = 'force-dynamic';

// Mensagem usada sempre que o dinheiro pode ter sido debitado e não sabemos
// (ou sabemos que sim) se o acesso foi concedido. NUNCA convida a nova tentativa.
const MSG_EM_VERIFICACAO =
  'Seu pagamento foi recebido e está em verificação. Se o acesso não for liberado em alguns minutos, fale com o suporte — não tente pagar novamente.';

/**
 * Adesão à assinatura RECORRENTE com cartão.
 *
 * Cria uma preapproval no Mercado Pago (POST /preapproval, status=authorized):
 * a partir daí o MP cobra o cartão sozinho a cada mês, e o cancelamento
 * (PUT /preapproval/{id} status=cancelled) é o que interrompe as cobranças.
 *
 * IMPORTANTE — o acesso NÃO é liberado por ter criado a assinatura. Criar a
 * preapproval não é dinheiro confirmado. O acesso só é concedido quando a
 * FATURA recorrente (authorized_payment) é efetivamente paga, o que chega pelo
 * webhook subscription_authorized_payment e passa pelo mesmo núcleo
 * processarPagamentoAprovado de sempre. O frontend faz polling do status.
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

  // Se o usuário ainda tem acesso vigente (trial ou período já pago), a primeira
  // cobrança recorrente é agendada para quando esse acesso terminar — não faz
  // sentido cobrar de novo por um período que ele já tem.
  const acessoAtualAte =
    assinatura.periodoFimEm && assinatura.periodoFimEm > new Date() ? assinatura.periodoFimEm
    : assinatura.trialFimEm > new Date()                            ? assinatura.trialFimEm
    : null;

  const origem = req.nextUrl.origin;

  let recorrente;
  try {
    recorrente = await criarAssinaturaRecorrente({
      valor:             plano.valor,
      motivo:            plano.descricao,
      cardTokenId:       token,
      payerEmail:        usuario.email,
      externalReference: assinatura.id,
      backUrl:           `${origem}/configuracoes`,
      inicioEm:          acessoAtualAte ?? undefined,
    });
  } catch (err) {
    // Gateway indisponível / recusa na validação do cartão / resposta inválida.
    // Falha fechada: nenhum acesso concedido, cobrança segue PROCESSANDO para
    // o webhook reconciliar caso o MP tenha criado algo do outro lado.
    logError('assinatura.cartao', `Falha ao criar assinatura recorrente (cobranca ${cobranca.id})`, err as Error,
      { cobrancaId: cobranca.id, idempotencyKey });
    return NextResponse.json(
      { aprovado: false, mensagem: 'Não foi possível concluir a assinatura agora. Confira os dados do cartão e tente novamente em instantes.' },
      { status: 502 },
    );
  }

  try {
    // Vincula a preapproval à assinatura e à cobrança. É por mpPreapprovalId que
    // o webhook das faturas recorrentes vai encontrar de quem é o pagamento.
    await prisma.assinatura.update({
      where: { id: assinatura.id },
      data: { mpPreapprovalId: recorrente.mpPreapprovalId, valorRecorrente: plano.valor, canceladaEm: null },
    });
    await prisma.cobranca.update({
      where: { id: cobranca.id },
      data: { mpPreapprovalId: recorrente.mpPreapprovalId, statusDetalhe: recorrente.status },
    });

    logInfo('assinatura.cartao', 'Assinatura recorrente criada', {
      cobrancaId: cobranca.id,
      preapprovalId: recorrente.mpPreapprovalId,
      status: recorrente.status,
      proximaCobranca: recorrente.proximaCobranca,
    });

    // status 'authorized' = MP aceitou o cartão e vai cobrar no ciclo. Ainda
    // NÃO é dinheiro confirmado desta competência — quem libera acesso é a
    // fatura paga, via webhook.
    if (recorrente.status !== 'authorized') {
      await prisma.cobranca.updateMany({
        where: { id: cobranca.id, status: 'PROCESSANDO' },
        data: { status: 'REJEITADA' },
      });
      return NextResponse.json({
        aprovado: false,
        mensagem: mensagemErroCartao('rejected', null),
      });
    }

    // Se o usuário já tinha acesso vigente, a assinatura entra em vigor sem
    // interrupção e ele continua liberado agora mesmo.
    const jaTemAcesso = temAcessoAtivo(assinatura);

    return NextResponse.json({
      aprovado: jaTemAcesso,
      assinaturaCriada: true,
      aguardandoConfirmacao: !jaTemAcesso,
      proximaCobranca: recorrente.proximaCobranca,
      mensagem: jaTemAcesso
        ? 'Assinatura ativada. A partir de agora a renovação é automática.'
        : 'Assinatura criada. Estamos confirmando o pagamento — seu acesso é liberado automaticamente em instantes.',
    });
  } catch (err) {
    // Exceção DEPOIS de a assinatura existir no gateway. Nunca dizer que falhou:
    // o cartão pode já ter sido debitado e a recorrência está de pé.
    logError('assinatura.cartao', `Falha pos-criacao da assinatura recorrente (cobranca ${cobranca.id})`, err as Error,
      { cobrancaId: cobranca.id, preapprovalId: recorrente.mpPreapprovalId });
    return NextResponse.json(
      { aprovado: false, mensagem: MSG_EM_VERIFICACAO },
      { status: 202 },
    );
  }
}
