'use client';

/**
 * Tokenização de cartão via SDK oficial do Mercado Pago (client-side) +
 * cobrança via nosso backend.
 *
 * SEGURANÇA: este componente NUNCA decide aprovação. `onAprovado` só é
 * chamado por `submeter()`, e só depois que o backend responder
 * `aprovado === true`. Não existe nenhum outro caminho de sucesso.
 *
 * API real confirmada (SDK JS V2, `mp.cardForm`, docs.mercadopago.com /
 * github.com/mercadopago/sdk-js/docs/card-form.md) — DIVERGE do esboço da
 * task-7-brief.md, que usava um único <div id="form-cartao"/> solto e um
 * botão type="button" chamando uma função de tokenização direta. A API real:
 *
 *   - Exige um <form id="..."> de verdade, com um cardFormMap (id de campo
 *     HTML) para cada um de: cardholderName, cardNumber, expirationDate (ou
 *     expirationMonth+expirationYear), securityCode, installments,
 *     identificationType, identificationNumber e issuer — os quatro últimos
 *     documentados como REQUIRED, não opcionais como o esboço presumia.
 *   - cardNumber/expirationDate/securityCode são "MP Fields": o SDK assume
 *     os elementos por id e intercepta o valor real, que nunca fica
 *     acessível ao nosso JS/DOM — a mesma garantia de segurança do esboço,
 *     só que via <div> gerenciado pelo SDK em vez de <input> nosso.
 *   - Não existe uma função única "tokenizarEEnviar" chamada por onClick: a
 *     tokenização é disparada pelo submit nativo do <form>, e o SDK entrega
 *     o resultado por dois callbacks distintos — `onSubmit` (sucesso: os
 *     dados já tokenizados ficam disponíveis via `getCardFormData()`) e
 *     `onError` (falha de validação/tokenização). Implementamos o contrato
 *     fixo do task-7-brief.md (tokenizar → falha nunca chama backend,
 *     sucesso só chama `submeter()`, `onAprovado()` nunca é chamado direto)
 *     mapeando: onError → passo 2 do contrato; onSubmit → passo 3.
 *   - `getCardFormData()` retorna exatamente
 *       { token, installments, paymentMethodId, issuerId,
 *         identificationType, identificationNumber, processingMode,
 *         merchantAccountId? }
 *     confirmando os nomes camelCase (paymentMethodId/issuerId) que o
 *     esboço já usava.
 *   - `three_ds_info` / 3DS: não encontrado em nenhum ponto do fluxo de
 *     CardForm nem do contrato de backend (route.ts não lê nem repassa esse
 *     campo). Não implementado aqui — é um gap real caso a conta do MP passe
 *     a exigir desafio 3DS; precisaria de Task futura no backend primeiro.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { VALOR_ASSINATURA, VALOR_ASSINATURA_FORMATADO, PLANO_PADRAO } from '@/lib/assinatura/config';
import { maskCpfCnpj } from '@/lib/validators';

interface CardFormData {
  token: string;
  installments: string;
  paymentMethodId: string;
  issuerId: string;
  identificationType: string;
  identificationNumber: string;
  processingMode: string;
  merchantAccountId?: string;
}

interface CardFormFieldMap { id: string; placeholder?: string }

interface CardFormInstance {
  getCardFormData(): CardFormData;
  unmount(): void;
}

interface CardFormConfig {
  amount: string;
  form: {
    id: string;
    cardholderName: CardFormFieldMap;
    cardNumber: CardFormFieldMap;
    expirationDate: CardFormFieldMap;
    securityCode: CardFormFieldMap;
    installments: CardFormFieldMap;
    identificationType: CardFormFieldMap;
    identificationNumber: CardFormFieldMap;
    issuer: CardFormFieldMap;
  };
  callbacks: {
    onFormMounted?: (error?: unknown) => void;
    onSubmit?: (event: Event) => void;
    onError?: (error?: unknown) => void;
  };
}

interface MercadoPagoInstance {
  cardForm(config: CardFormConfig): CardFormInstance;
}

declare global {
  interface Window {
    MercadoPago?: new (publicKey: string, options?: { locale?: string }) => MercadoPagoInstance;
  }
}

interface Props { onAprovado: () => void }

// 'montando_form': script carregado e <form> já está no DOM, mas o SDK ainda
// não confirmou onFormMounted — os campos existem só visualmente.
// 'bloqueado': HTTP 202 (dinheiro capturado, nosso pós-write falhou) — terminal,
// sem botão de retry, para nunca cobrar duas vezes.
// 'sessao_expirada': 401 do middleware — não é recusa de pagamento.
type Estado = 'carregando_sdk' | 'montando_form' | 'pronto' | 'processando' | 'erro' | 'bloqueado' | 'sessao_expirada';

const FORM_ID = 'form-cartao';
const ID = (campo: string) => `${FORM_ID}__${campo}`;

export default function FormularioCartao({ onAprovado }: Props) {
  const [estado, setEstado]           = useState<Estado>('carregando_sdk');
  const [erro, setErro]               = useState('');
  const [identificacao, setIdentificacao] = useState(''); // CPF/CNPJ digitado no próprio form do cartão
  const mpRef       = useRef<MercadoPagoInstance | null>(null);
  const cardFormRef = useRef<CardFormInstance | null>(null);
  // Trava sincrônica contra duplo clique/duplo submit: useState é assíncrono
  // demais para impedir dois envios disparados no mesmo tick.
  const enviandoRef = useRef(false);

  const submeter = useCallback(async (dadosTokenizados: {
    token: string; paymentMethodId: string; issuerId?: string; cpfCnpj?: string;
  }) => {
    if (enviandoRef.current) return;      // trava dura contra duplo envio
    enviandoRef.current = true;
    setEstado('processando');
    setErro('');

    let r: Response;
    try {
      r = await fetch('/api/assinatura/cartao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planoId: PLANO_PADRAO.id,   // referência, nunca preço
          token: dadosTokenizados.token,
          paymentMethodId: dadosTokenizados.paymentMethodId,
          issuerId: dadosTokenizados.issuerId,
          installments: 1,             // único plano suportado — backend rejeita qualquer outro valor
          ...(dadosTokenizados.cpfCnpj ? { cpfCnpj: dadosTokenizados.cpfCnpj } : {}),
        }),
      });
    } catch {
      // Falha de rede: o pagamento PODE ter sido processado. Nunca assumir
      // sucesso nem falha — orientar o usuário a verificar antes de tentar de novo.
      setErro('Não foi possível confirmar o pagamento. Atualize a página antes de tentar de novo.');
      setEstado('pronto');
      enviandoRef.current = false;
      return;
    }

    // 401 vem do middleware com formato PRÓPRIO ({ error }, sem `mensagem`) —
    // nunca ler d.mensagem aqui, e nunca tratar como recusa de pagamento.
    if (r.status === 401) {
      setErro('Sua sessão expirou. Faça login novamente para continuar.');
      setEstado('sessao_expirada');
      enviandoRef.current = false;
      return;
    }

    let d: { aprovado?: boolean; mensagem?: string; precisaCpfCnpj?: boolean } = {};
    try { d = await r.json(); } catch { /* corpo vazio/ inválido: trata como falha genérica abaixo */ }

    // ÚNICO caminho de sucesso do componente: o backend afirmou aprovado.
    if (r.ok && d.aprovado === true) { onAprovado(); return; }

    // HTTP 202: dinheiro capturado, nosso registro pós-captura falhou. Terminal —
    // NUNCA oferecer retry (cobraria de novo em cima de quem já pagou).
    if (r.status === 202) {
      setErro(d.mensagem || 'Seu pagamento foi recebido e está em verificação. Não tente pagar novamente.');
      setEstado('bloqueado');
      enviandoRef.current = false;
      return;
    }

    // 200 recusado, 400 (inclusive precisaCpfCnpj), 409 (em voo) e 429 (rate
    // limit) caem todos aqui: mostrar mensagem do backend e permitir nova
    // tentativa manual — nunca auto-retry.
    setErro(d.mensagem || 'Não foi possível concluir o pagamento.');
    setEstado('pronto');
    enviandoRef.current = false;
  }, [onAprovado]);

  // Carrega o SDK oficial uma única vez e instancia o objeto MercadoPago.
  useEffect(() => {
    const publicKey = process.env.NEXT_PUBLIC_MP_PUBLIC_KEY;
    if (!publicKey) { setEstado('erro'); setErro('Pagamento com cartão indisponível no momento.'); return; }

    const existente = document.querySelector<HTMLScriptElement>('script[data-mp-sdk]');
    const init = () => {
      if (!window.MercadoPago) { setEstado('erro'); setErro('Não foi possível carregar o formulário de pagamento.'); return; }
      mpRef.current = new window.MercadoPago(publicKey, { locale: 'pt-BR' });
      setEstado('montando_form'); // libera a renderização do <form> para o SDK montar em cima dele
    };

    if (existente) { if (window.MercadoPago) init(); else existente.addEventListener('load', init); return; }

    const script = document.createElement('script');
    script.src = 'https://sdk.mercadopago.com/js/v2';
    script.async = true;
    script.dataset.mpSdk = 'true';
    script.onload = init;
    script.onerror = () => { setEstado('erro'); setErro('Não foi possível carregar o formulário de pagamento.'); };
    document.body.appendChild(script);
  }, []);

  // Só depois que o <form id="form-cartao"> (com todos os campos mapeados)
  // já está no DOM é que o cardForm pode ser montado em cima dele.
  useEffect(() => {
    if (estado !== 'montando_form') return;
    if (!mpRef.current || cardFormRef.current) return;

    cardFormRef.current = mpRef.current.cardForm({
      amount: String(VALOR_ASSINATURA),
      form: {
        id: FORM_ID,
        cardholderName:       { id: ID('cardholderName'), placeholder: 'Nome impresso no cartão' },
        cardNumber:            { id: ID('cardNumber'), placeholder: 'Número do cartão' },
        expirationDate:        { id: ID('expirationDate'), placeholder: 'MM/AA' },
        securityCode:          { id: ID('securityCode'), placeholder: 'CVV' },
        installments:          { id: ID('installments') },
        identificationType:    { id: ID('identificationType') },
        identificationNumber:  { id: ID('identificationNumber'), placeholder: 'CPF ou CNPJ' },
        issuer:                { id: ID('issuer') },
      },
      callbacks: {
        // REQUIRED pela API: confirma que os MP Fields (cardNumber/
        // expirationDate/securityCode) montaram nos elementos acima.
        onFormMounted: (error) => {
          if (error) { setEstado('erro'); setErro('Não foi possível carregar o formulário de pagamento.'); return; }
          setEstado('pronto');
        },
        // Passo 2 do contrato: tokenização/validação falhou → mensagem amigável,
        // volta para 'pronto', NUNCA chama o backend.
        onError: () => {
          setEstado('pronto');
          setErro('Não foi possível processar os dados do cartão. Confira as informações e tente novamente.');
        },
        // Passo 3 do contrato: SDK já tokenizou com sucesso (dados disponíveis
        // via getCardFormData) → chama submeter(), nunca onAprovado() direto.
        onSubmit: (event) => {
          event.preventDefault();
          const cf = cardFormRef.current;
          if (!cf) return;
          const dados = cf.getCardFormData();
          if (!dados.token) {
            setEstado('pronto');
            setErro('Não foi possível processar os dados do cartão. Tente novamente.');
            return;
          }
          submeter({
            token: dados.token,
            paymentMethodId: dados.paymentMethodId,
            issuerId: dados.issuerId || undefined,
            // Reaproveita o CPF/CNPJ já coletado pelo próprio form do cartão
            // (campo exigido pelo SDK para tokenizar) — o backend só o usa
            // quando o usuário ainda não tem um salvo; caso contrário ignora.
            cpfCnpj: dados.identificationNumber ? dados.identificationNumber.replace(/\D/g, '') : undefined,
          });
        },
      },
    });

    return () => { cardFormRef.current?.unmount(); cardFormRef.current = null; };
  }, [estado, submeter]);

  if (estado === 'erro') {
    return <p className="text-red-600 text-sm text-center py-6">{erro}</p>;
  }

  if (estado === 'bloqueado') {
    return <p className="text-gray-700 text-sm text-center py-6">{erro}</p>;
  }

  if (estado === 'sessao_expirada') {
    return (
      <div className="text-center py-6">
        <p className="text-red-600 text-sm mb-4">{erro}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="w-full bg-blue-600 text-white font-semibold rounded-xl py-3"
        >
          Recarregar página
        </button>
      </div>
    );
  }

  return (
    <div>
      {estado === 'carregando_sdk' && (
        <p className="text-sm text-gray-400 text-center py-6">Carregando formulário seguro...</p>
      )}

      {/* Renderizado a partir de 'montando_form' para que os ids abaixo já
          existam no DOM quando o SDK tentar montar o cardForm em cima deles.
          Campos sensíveis (cardNumber/expirationDate/securityCode) são "MP
          Fields": o SDK assume esses <div> e o valor real nunca passa pelo
          nosso estado, log ou backend — só o token final. */}
      {(estado === 'montando_form' || estado === 'pronto' || estado === 'processando') && (
        <form id={FORM_ID}>
          <label className="block text-xs font-medium text-gray-500 mb-1">Nome no cartão</label>
          <input
            id={ID('cardholderName')}
            type="text"
            placeholder="Como está impresso no cartão"
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />

          <label className="block text-xs font-medium text-gray-500 mb-1">Número do cartão</label>
          <div id={ID('cardNumber')} className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm mb-3" />

          <div className="flex gap-3 mb-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Validade</label>
              <div id={ID('expirationDate')} className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm" />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">CVV</label>
              <div id={ID('securityCode')} className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm" />
            </div>
          </div>

          <div className="flex gap-3 mb-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">CPF ou CNPJ</label>
              <input
                id={ID('identificationNumber')}
                type="text"
                inputMode="numeric"
                placeholder="000.000.000-00"
                value={identificacao}
                onChange={e => setIdentificacao(maskCpfCnpj(e.target.value))}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="w-28">
              <label className="block text-xs font-medium text-gray-500 mb-1">Tipo</label>
              {/* ponytail: só CPF/CNPJ (app é Brasil-only, mesma dupla usada no
                  fluxo PIX) — sem troca automática pelo tamanho digitado. */}
              <select id={ID('identificationType')} defaultValue="CPF" className="w-full border border-gray-200 rounded-xl px-2 py-3 text-sm">
                <option value="CPF">CPF</option>
                <option value="CNPJ">CNPJ</option>
              </select>
            </div>
          </div>

          {/* Campos exigidos pela API do SDK (installments/issuer), mas sem
              escolha real: só existe um plano à vista e o backend rejeita
              qualquer installments != 1 — por isso ficam ocultos. O SDK só
              precisa dos elementos existirem por id, não de estarem visíveis. */}
          <select id={ID('installments')} className="hidden" defaultValue="1"><option value="1">1x</option></select>
          <select id={ID('issuer')} className="hidden" />

          {erro && <p className="text-red-600 text-sm mt-3 text-center">{erro}</p>}

          <button
            type="submit"
            disabled={estado !== 'pronto'}
            className="w-full bg-blue-600 text-white font-semibold rounded-xl py-3 mt-4 disabled:opacity-50"
          >
            {estado === 'processando' ? 'Processando pagamento...' :
             estado === 'montando_form' ? 'Carregando...' :
             `Pagar ${VALOR_ASSINATURA_FORMATADO}`}
          </button>

          <p className="text-gray-400 text-xs mt-3 text-center">
            Não guardamos os dados do seu cartão.
          </p>
        </form>
      )}
    </div>
  );
}
