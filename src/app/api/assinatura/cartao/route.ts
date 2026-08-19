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
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  // Rate limit por usuário (session.sub — nunca algo influenciável pelo cliente) — anti card testing.
  const rl = checkPagamentoRateLimit(session.sub);
  if (!rl.allowed) {
    return NextResponse.json(
      { aprovado: false, mensagem: `Muitas tentativas de pagamento. Aguarde ${Math.ceil(rl.retryAfter / 60)} minuto(s) e tente novamente.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    );
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { body = {}; }

  // ── Plano: preço/moeda/duração vêm do servidor, nunca do cliente ──
  const plano = resolverPlano(body.planoId ?? 'mensal');
  if (!plano) return NextResponse.json({ aprovado: false, mensagem: 'Plano inválido.' }, { status: 400 });

  // ── Dados do cartão: opacos, só repassados ao gateway ──
  const token           = typeof body.token === 'string' ? body.token : '';
  const paymentMethodId = typeof body.paymentMethodId === 'string' ? body.paymentMethodId : '';
  // issuerId só é aceito se for uma string só de dígitos — criarPagamentoCartao faz
  // Number(issuerId) sem checar; uma string não-numérica viraria NaN → null no body
  // enviado ao gateway, silenciosamente. Qualquer outra coisa é omitida (campo opcional).
  const issuerIdRaw = body.issuerId;
  const issuerId     = typeof issuerIdRaw === 'string' && /^\d+$/.test(issuerIdRaw) ? issuerIdRaw : undefined;
  const installments = Number.isInteger(body.installments) ? Number(body.installments) : 1;

  if (!token || !paymentMethodId) {
    return NextResponse.json({ aprovado: false, mensagem: 'Dados do cartão incompletos. Tente novamente.' }, { status: 400 });
  }
  // Nesta fase só há plano à vista. Impede manipulação de parcelas.
  if (installments !== 1) {
    return NextResponse.json({ aprovado: false, mensagem: 'Número de parcelas inválido.' }, { status: 400 });
  }

  const usuario = await prisma.usuario.findUnique({ where: { id: session.sub } });
  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });

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
  if (!assinatura) return NextResponse.json({ error: 'Assinatura não encontrada' }, { status: 404 });

  // Cobrança criada ANTES da chamada ao gateway: garante que todo pagamento
  // tenha registro local, mesmo se o processo cair no meio.
  const idempotencyKey = randomUUID();
  const cobranca = await prisma.cobranca.create({
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
    // Gateway indisponível / timeout / resposta inválida.
    // NUNCA concede acesso. Estado FALHA é terminal e auditável.
    logError('assinatura.cartao', `Falha ao criar pagamento com cartão (cobranca ${cobranca.id})`, err as Error);
    await prisma.cobranca.update({ where: { id: cobranca.id }, data: { status: 'FALHA' } });
    return NextResponse.json(
      { aprovado: false, mensagem: 'Não foi possível processar o pagamento agora. Tente novamente em instantes.' },
      { status: 502 },
    );
  }

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

  const statusFinal =
    pagamento.status === 'rejected'  ? 'REJEITADA' :
    pagamento.status === 'cancelled' ? 'CANCELADA' :
    pagamento.status === 'approved'  ? 'FALHA' : // aprovado mas reprovado na validação → auditar
    'PENDENTE';

  await prisma.cobranca.update({ where: { id: cobranca.id }, data: { status: statusFinal } });

  return NextResponse.json({
    aprovado: false,
    mensagem: mensagemErroCartao(pagamento.status, pagamento.statusDetail),
  });
}
