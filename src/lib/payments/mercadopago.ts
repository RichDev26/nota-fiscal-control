/**
 * Integração com o Mercado Pago via SDK oficial (não fetch cru — ver justificativa
 * no plano de implementação, Task 6): criação de cobrança PIX, busca do status
 * real de um pagamento, e validação da assinatura do webhook.
 */
import { MercadoPagoConfig, Payment, WebhookSignatureValidator, InvalidWebhookSignatureError } from 'mercadopago';

function getClient(): MercadoPagoConfig {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) throw new Error('MP_ACCESS_TOKEN não configurado');
  return new MercadoPagoConfig({ accessToken });
}

export interface CriarCobrancaPixInput {
  valor: number;
  descricao: string;
  idempotencyKey: string;
  payerEmail: string;
  payerNome: string;
  payerCpfCnpj: string; // somente dígitos
}

export interface CobrancaPixResultado {
  mpPaymentId: string;
  status: string;
  qrCode: string;
  qrCodeBase64: string;
}

export async function criarCobrancaPix(input: CriarCobrancaPixInput): Promise<CobrancaPixResultado> {
  const payment = new Payment(getClient());

  const partesNome = input.payerNome.trim().split(/\s+/);
  const firstName  = partesNome[0];
  const lastName   = partesNome.slice(1).join(' ') || partesNome[0];
  const cpfCnpj    = input.payerCpfCnpj.replace(/\D/g, '');
  const tipoDoc    = cpfCnpj.length === 14 ? 'CNPJ' : 'CPF';

  const response = await payment.create({
    body: {
      transaction_amount: input.valor,
      description: input.descricao,
      payment_method_id: 'pix',
      payer: {
        email: input.payerEmail,
        first_name: firstName,
        last_name: lastName,
        identification: { type: tipoDoc, number: cpfCnpj },
      },
    },
    requestOptions: { idempotencyKey: input.idempotencyKey },
  });

  const transactionData = response.point_of_interaction?.transaction_data;
  if (!response.id || !transactionData?.qr_code || !transactionData?.qr_code_base64) {
    throw new Error('Resposta do Mercado Pago sem dados de QR Code PIX');
  }

  return {
    mpPaymentId:  String(response.id),
    status:       response.status ?? 'pending',
    qrCode:       transactionData.qr_code,
    qrCodeBase64: transactionData.qr_code_base64,
  };
}

/** Snapshot completo do pagamento no gateway — base de TODA decisão de acesso. */
export interface PagamentoGateway {
  mpPaymentId: string;
  status: string;
  statusDetail: string | null;
  valor: number;
  moeda: string;
  liveMode: boolean;
  ultimosDigitos: string | null;
  bandeira: string | null;
  parcelas: number | null;
}

export function mapearResposta(response: {
  id?: number | string; status?: string; status_detail?: string;
  transaction_amount?: number; currency_id?: string; live_mode?: boolean;
  installments?: number; payment_method_id?: string;
  card?: { last_four_digits?: string };
}): PagamentoGateway {
  return {
    mpPaymentId:    String(response.id ?? ''),
    status:         response.status ?? 'unknown',
    statusDetail:   response.status_detail ?? null,
    valor:          response.transaction_amount ?? 0,
    moeda:          response.currency_id ?? '',
    liveMode:       response.live_mode === true,
    ultimosDigitos: response.card?.last_four_digits ?? null,
    bandeira:       response.payment_method_id ?? null,
    parcelas:       response.installments ?? null,
  };
}

/**
 * Busca o pagamento REAL no gateway. Fonte da verdade para conceder acesso —
 * nunca confiar no corpo do webhook nem em nada vindo do cliente.
 */
export async function buscarPagamento(mpPaymentId: string): Promise<PagamentoGateway> {
  const payment  = new Payment(getClient());
  const response = await payment.get({ id: mpPaymentId });
  return mapearResposta(response);
}

export interface ValidarWebhookInput {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
}

/** true = assinatura autêntica do Mercado Pago. false = rejeitar com 401, sem processar nada. */
export function validarAssinaturaWebhook(input: ValidarWebhookInput): boolean {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret || !input.xSignature || !input.dataId) return false;
  try {
    WebhookSignatureValidator.validate({
      xSignature: input.xSignature,
      xRequestId: input.xRequestId ?? '',
      dataId:     input.dataId,
      secret,
    });
    return true;
  } catch (err) {
    if (err instanceof InvalidWebhookSignatureError) return false;
    throw err;
  }
}
