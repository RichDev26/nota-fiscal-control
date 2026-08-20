import { NextRequest, NextResponse } from 'next/server';
import {
  validarAssinaturaWebhook,
  buscarPagamento,
  buscarFaturaRecorrente,
  buscarAssinaturaRecorrente,
} from '@/lib/payments/mercadopago';
import {
  processarPagamentoAprovado,
  processarFaturaRecorrente,
  sincronizarStatusAssinatura,
} from '@/lib/assinatura/servico';
import { logInfo, logError } from '@/lib/extractors/logger';

export const dynamic = 'force-dynamic';

/**
 * Webhook do Mercado Pago.
 *
 * Nunca confia no corpo da notificação: valida o HMAC e depois BUSCA o recurso
 * de verdade no gateway antes de qualquer decisão. Toda concessão de acesso
 * continua passando por processarPagamentoAprovado — não existe caminho novo.
 *
 * Tópicos tratados:
 *   - payment                          → cobrança avulsa (PIX)
 *   - subscription_authorized_payment  → fatura da assinatura recorrente (cartão)
 *   - subscription_preapproval         → mudança de status da assinatura, inclui
 *                                        o cancelamento automático que o MP faz
 *                                        após 3 faturas recusadas
 */
export async function POST(req: NextRequest) {
  const params     = req.nextUrl.searchParams;
  const dataId     = params.get('data.id');
  const xSignature = req.headers.get('x-signature');
  const xRequestId = req.headers.get('x-request-id');

  const valido = validarAssinaturaWebhook({ xSignature, xRequestId, dataId });
  if (!valido) {
    logError('webhooks.mercadopago', 'Assinatura de webhook inválida — requisição rejeitada');
    return NextResponse.json({ error: 'Assinatura inválida' }, { status: 401 });
  }

  if (!dataId) return NextResponse.json({ ok: true }); // notificação sem data.id — nada a fazer

  // O MP manda o tópico em `type` ou `topic` (varia por origem). O corpo é lido
  // SÓ para descobrir o tópico — nenhum valor dele influencia a decisão de
  // acesso, que vem sempre do recurso buscado no gateway.
  let corpo: { type?: string; topic?: string } = {};
  try { corpo = await req.json(); } catch { /* corpo vazio é normal */ }
  const topico = params.get('type') ?? params.get('topic') ?? corpo.type ?? corpo.topic ?? 'payment';

  try {
    // ── Fatura da assinatura recorrente: o caminho normal de renovação ──
    if (topico === 'subscription_authorized_payment') {
      const fatura = await buscarFaturaRecorrente(dataId);
      if (!fatura.mpPreapprovalId) {
        logError('webhooks.mercadopago', 'Fatura recorrente sem preapproval_id', undefined, { dataId });
        return NextResponse.json({ ok: true });
      }

      // live_mode não vem na fatura — lemos da assinatura no gateway, que de
      // quebra confirma que a preapproval existe do lado do MP.
      const preapproval = await buscarAssinaturaRecorrente(fatura.mpPreapprovalId);

      const resultado = await processarFaturaRecorrente({
        faturaId:        fatura.faturaId,
        mpPreapprovalId: fatura.mpPreapprovalId,
        statusPagamento: fatura.statusPagamento,
        valor:           fatura.valor,
        moeda:           fatura.moeda,
        liveMode:        preapproval.liveMode,
      });

      logInfo('webhooks.mercadopago', 'Fatura recorrente processada', {
        dataId, statusPagamento: fatura.statusPagamento, ...resultado,
      });

      if (!resultado.processado && fatura.statusPagamento === 'approved' && resultado.motivo !== 'ja_processada') {
        logError('webhooks.mercadopago', `Fatura APROVADA nao concedeu acesso: ${resultado.motivo}`, undefined,
          { dataId, preapprovalId: fatura.mpPreapprovalId, motivo: resultado.motivo });

        // Assinatura ainda não vinculada localmente (corrida com a rota de
        // adesão): 409 faz o MP reentregar em vez de queimar a notificação.
        if (resultado.motivo === 'cobranca_nao_encontrada') {
          return NextResponse.json({ error: 'Assinatura ainda nao reconciliada — reentregar' }, { status: 409 });
        }
      }

      return NextResponse.json({ ok: true });
    }

    // ── Mudança de status da assinatura (cancelamento automático, pausa...) ──
    if (topico === 'subscription_preapproval') {
      const preapproval = await buscarAssinaturaRecorrente(dataId);
      const r = await sincronizarStatusAssinatura(dataId, preapproval.status);
      logInfo('webhooks.mercadopago', 'Status de assinatura sincronizado', {
        dataId, status: preapproval.status, ...r,
      });
      return NextResponse.json({ ok: true });
    }

    // ── Cobrança avulsa (PIX) — caminho original, inalterado ──
    const pagamento = await buscarPagamento(dataId);
    const resultado = await processarPagamentoAprovado(pagamento);

    if (!resultado.processado && pagamento.status === 'approved' && resultado.motivo !== 'ja_processada') {
      logError('webhooks.mercadopago', `Pagamento aprovado NAO concedeu acesso: ${resultado.motivo}`, undefined, { dataId, motivo: resultado.motivo });
    }
    logInfo('webhooks.mercadopago', 'Webhook processado', { dataId, topico, status: pagamento.status, ...resultado });

    // Pagamento APROVADO cuja cobrança ainda não existe no banco: a rota de
    // pagamento grava o mpPaymentId só depois de capturar — o webhook pode
    // chegar nessa janela. Responder 200 queimaria a entrega e o cliente
    // ficaria pago e sem acesso. 409 faz o MP reentregar; a 2ª entrega
    // encontra a linha e o CAS concede exatamente uma vez.
    if (!resultado.processado && pagamento.status === 'approved' && resultado.motivo === 'cobranca_nao_encontrada') {
      return NextResponse.json({ error: 'Cobranca ainda nao reconciliada — reentregar' }, { status: 409 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    logError('webhooks.mercadopago', `Falha ao processar webhook (${topico}) ${dataId}`, err as Error);
    return NextResponse.json({ error: 'Erro ao processar' }, { status: 500 });
  }
}
