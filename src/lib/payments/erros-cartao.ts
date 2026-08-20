/**
 * Tradução de status/status_detail do Mercado Pago para mensagens seguras ao
 * usuário final.
 *
 * Regras:
 *   - Nunca expor código interno do gateway, nome do provedor ou detalhe técnico.
 *   - Nunca dizer "aprovado" em nenhum caminho de erro.
 *   - Código desconhecido cai numa mensagem genérica (o MP adiciona detalhes
 *     novos sem aviso; o default precisa ser seguro).
 */

const MENSAGENS: Record<string, string> = {
  // Dados preenchidos errado — o usuário consegue corrigir e tentar de novo.
  cc_rejected_bad_filled_card_number: 'Confira o número do cartão e tente novamente.',
  cc_rejected_bad_filled_date:        'Confira a data de validade do cartão e tente novamente.',
  cc_rejected_bad_filled_security_code: 'Confira o código de segurança (CVV) e tente novamente.',
  cc_rejected_bad_filled_other:       'Confira os dados do cartão e tente novamente.',

  // Limite / saldo
  cc_rejected_insufficient_amount:    'O cartão não tem limite disponível para esta compra.',

  // Requer ação do titular junto ao banco
  cc_rejected_call_for_authorize:     'Seu banco precisa autorizar esta compra. Entre em contato com o banco e tente novamente.',
  cc_rejected_card_disabled:          'Este cartão está desabilitado. Fale com o banco emissor ou use outro cartão.',
  cc_rejected_card_error:             'Não foi possível processar este cartão. Tente outro cartão.',
  cc_rejected_invalid_installments:   'Este cartão não aceita o número de parcelas escolhido.',
  cc_rejected_max_attempts:           'Muitas tentativas com este cartão. Aguarde alguns minutos ou use outro cartão.',
  cc_rejected_duplicated_payment:     'Já existe um pagamento igual em processamento. Aguarde antes de tentar de novo.',

  // Risco / antifraude — deliberadamente vago (não dar pistas a fraudador).
  cc_rejected_high_risk:              'Pagamento recusado. Tente outro cartão ou outro meio de pagamento.',
  cc_rejected_blacklist:              'Pagamento recusado. Tente outro cartão ou outro meio de pagamento.',

  // Cancelamento
  by_collector:                       'Pagamento cancelado.',
  by_payer:                           'Pagamento cancelado.',
  expired:                            'O prazo para concluir este pagamento expirou. Gere uma nova cobrança.',
};

const GENERICA = 'Não foi possível concluir o pagamento. Tente novamente ou use outro cartão.';

export function mensagemErroCartao(status: string, statusDetail: string | null): string {
  if (statusDetail && Object.prototype.hasOwnProperty.call(MENSAGENS, statusDetail)) {
    return MENSAGENS[statusDetail];
  }
  if (status === 'cancelled') return 'Pagamento cancelado.';
  if (status === 'in_process' || status === 'pending') {
    return 'Pagamento em análise. Assim que for confirmado, seu acesso é liberado automaticamente.';
  }
  return GENERICA;
}
