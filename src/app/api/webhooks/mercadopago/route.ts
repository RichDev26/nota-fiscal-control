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
    if (pagamento.status !== 'approved') {
      return NextResponse.json({ ok: true }); // pendente/rejeitado — nada a liberar ainda
    }

    const resultado = await processarPagamentoAprovado(dataId);
    logInfo('webhooks.mercadopago', 'Webhook processado', { dataId, ...resultado });
    return NextResponse.json({ ok: true });
  } catch (err) {
    logError('webhooks.mercadopago', `Falha ao processar webhook do pagamento ${dataId}`, err as Error);
    return NextResponse.json({ error: 'Erro ao processar' }, { status: 500 });
  }
}
