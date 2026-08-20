import { NextRequest, NextResponse } from 'next/server';
import { validarAssinaturaWebhook, buscarPagamento } from '@/lib/payments/mercadopago';
import { processarPagamentoAprovado } from '@/lib/assinatura/servico';
import { logInfo, logError } from '@/lib/extractors/logger';

export const dynamic = 'force-dynamic';

/**
 * Chamado pelo Mercado Pago quando o status de um pagamento muda. Nunca confia
 * no corpo da notificação — sempre busca o pagamento de verdade via
 * buscarPagamento() antes de liberar qualquer acesso (ver auditoria de
 * segurança no spec, docs/superpowers/specs/2026-07-17-assinaturas-mercadopago-design.md).
 */
export async function POST(req: NextRequest) {
  const dataId     = req.nextUrl.searchParams.get('data.id');
  const xSignature = req.headers.get('x-signature');
  const xRequestId = req.headers.get('x-request-id');

  const valido = validarAssinaturaWebhook({ xSignature, xRequestId, dataId });
  if (!valido) {
    logError('webhooks.mercadopago', 'Assinatura de webhook inválida — requisição rejeitada');
    return NextResponse.json({ error: 'Assinatura inválida' }, { status: 401 });
  }

  if (!dataId) return NextResponse.json({ ok: true }); // notificação sem data.id — nada a fazer

  try {
    const pagamento = await buscarPagamento(dataId);
    // Toda a decisão (status, valor, moeda, ambiente, idempotência) é do núcleo.
    const resultado = await processarPagamentoAprovado(pagamento);
    if (!resultado.processado && pagamento.status === 'approved' && resultado.motivo !== 'ja_processada') {
      logError('webhooks.mercadopago', `Pagamento aprovado NAO concedeu acesso: ${resultado.motivo}`, undefined, { dataId, motivo: resultado.motivo });
    }
    logInfo('webhooks.mercadopago', 'Webhook processado', { dataId, status: pagamento.status, ...resultado });

    // Pagamento APROVADO cuja cobrança ainda não existe no banco: a rota de
    // cartão captura no gateway e só depois grava o mpPaymentId — o webhook
    // pode chegar nessa janela. Responder 200 aqui queimaria a única entrega
    // do MP e o cliente ficaria pago e sem acesso caso a rota morresse antes
    // de gravar. 409 faz o MP reentregar com backoff; a 2ª entrega encontra a
    // linha e o CAS concede exatamente uma vez.
    if (!resultado.processado && pagamento.status === 'approved' && resultado.motivo === 'cobranca_nao_encontrada') {
      return NextResponse.json({ error: 'Cobranca ainda nao reconciliada — reentregar' }, { status: 409 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    logError('webhooks.mercadopago', `Falha ao processar webhook do pagamento ${dataId}`, err as Error);
    return NextResponse.json({ error: 'Erro ao processar' }, { status: 500 });
  }
}
