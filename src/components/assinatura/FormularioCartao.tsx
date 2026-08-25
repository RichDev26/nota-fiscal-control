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
 *   - cardNumber/expirationDate/securityCode precisam ser <input> de verdade.
 *     Isto foi verificado no navegador contra o SDK real, depois de um bug em
 *     producao: com <div> o cardForm chama onFormMounted SEM erro e mesmo
 *     assim nao liga nada no elemento — o usuario ve tres caixas vazias que
 *     nao aceitam digitacao. Com <input> o mesmo cardForm passa a resolver
 *     bandeira, emissor e parcelas normalmente.
 *
 *     Consequencia de seguranca, explicita: neste modo o numero do cartao
 *     FICA no DOM da nossa pagina enquanto o usuario digita. O que continua
 *     valendo e que nosso codigo nunca le esse valor e o backend so recebe o
 *     token — nenhum dado de cartao trafega ou e gravado por nos. Se a
 *     exigencia for que o PAN nunca toque o nosso DOM, o caminho e trocar
 *     cardForm por Secure Fields (mp.fields.create(...).mount(div)), que
 *     renderiza cada campo dentro de um iframe do proprio Mercado Pago.
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
// 'falha_conexao': fetch lançou (rede caiu) — backend pode já ter capturado
// a cobrança sem a resposta chegar até nós. Terminal, sem retry direto, para
// nunca cobrar duas vezes em cima de um status que não conhecemos.
type Estado = 'carregando_sdk' | 'montando_form' | 'pronto' | 'processando' | 'erro' | 'bloqueado' | 'sessao_expirada' | 'falha_conexao' | 'aguardando_confirmacao';

const FORM_ID = 'form-cartao';
const ID = (campo: string) => `${FORM_ID}__${campo}`;

export default function FormularioCartao({ onAprovado }: Props) {
  const [estado, setEstado]           = useState<Estado>('carregando_sdk');

  // Unica fonte de verdade para "o <form> esta renderizado": usada tanto pelo
  // JSX quanto pela dependencia do efeito que monta o cardForm, para que os
  // dois nunca saiam de sincronia.
  const formNoDom = estado === 'montando_form' || estado === 'pronto' || estado === 'processando';
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
      // sucesso nem falha — estado terminal, sem form/botão habilitado, para
      // não convidar um retry às cegas em cima de uma cobrança já capturada.
      setErro('Não foi possível confirmar o pagamento. Ele PODE ter sido processado. Recarregue a página para verificar antes de tentar novamente.');
      setEstado('falha_conexao');
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

    let d: {
      aprovado?: boolean; mensagem?: string; precisaCpfCnpj?: boolean;
      assinaturaCriada?: boolean; aguardandoConfirmacao?: boolean;
    } = {};
    try { d = await r.json(); } catch { /* corpo vazio/ inválido: trata como falha genérica abaixo */ }

    // ÚNICO caminho de sucesso imediato: o backend afirmou aprovado.
    if (r.ok && d.aprovado === true) { enviandoRef.current = false; onAprovado(); return; }

    // Assinatura recorrente criada, mas o acesso ainda depende da PRIMEIRA
    // fatura ser paga (chega pelo webhook). Não é sucesso nem recusa: entra em
    // espera e faz polling do status real no backend. Continua valendo a regra
    // central — só liberamos quando o backend disser que o acesso está ativo.
    if (r.ok && d.assinaturaCriada === true && d.aguardandoConfirmacao === true) {
      setErro('');
      setEstado('aguardando_confirmacao');
      enviandoRef.current = false;
      return;
    }

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

  // O SDK guarda os callbacks que recebe no cardForm(). Se `submeter` entrasse
  // no array de dependencias do efeito de montagem, cada nova identidade dele
  // (o pai passa `onAprovado={() => router.refresh()}`, funcao nova a cada
  // render) desmontaria e remontaria os campos seguros. Espelhamos em um ref:
  // o callback le sempre a versao atual sem que o efeito precise re-rodar.
  const submeterRef = useRef(submeter);
  useEffect(() => { submeterRef.current = submeter; });

  // Enquanto a 1ª fatura da assinatura recorrente não é confirmada, consulta o
  // backend periodicamente. Só o backend decide se há acesso — o componente
  // apenas reage ao que ele responde.
  useEffect(() => {
    if (estado !== 'aguardando_confirmacao') return;
    const id = setInterval(async () => {
      try {
        const r = await fetch('/api/assinatura/status');
        if (!r.ok) return;
        const d = await r.json();
        if (d.ativo === true) { clearInterval(id); onAprovado(); }
      } catch { /* tenta de novo no próximo tick */ }
    }, 4000);
    return () => clearInterval(id);
  }, [estado, onAprovado]);

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

    if (existente) {
      if (window.MercadoPago) { init(); return; }
      existente.addEventListener('load', init);
      return () => existente.removeEventListener('load', init);
    }

    const script = document.createElement('script');
    script.src = 'https://sdk.mercadopago.com/js/v2';
    script.async = true;
    script.dataset.mpSdk = 'true';
    script.onload = init;
    script.onerror = () => { setEstado('erro'); setErro('Não foi possível carregar o formulário de pagamento.'); };
    document.body.appendChild(script);

    // Cleanup: só remove o listener que este mount registrou — o <script>
    // é intencionalmente compartilhado/de-duplicado via data-mp-sdk e outros
    // mounts podem depender dele, então ele nunca é removido aqui.
    return () => { script.onload = null; };
  }, []);

  // Só depois que o <form id="form-cartao"> (com todos os campos mapeados)
  // já está no DOM é que o cardForm pode ser montado em cima dele.
  //
  // A dependencia é `formNoDom`, NUNCA `estado`. O motivo é sutil e ja causou
  // bug em producao: o proprio onFormMounted chama setEstado('pronto'), entao
  // com `estado` na lista o React rodava o cleanup — unmount() — no mesmo tick
  // em que o form terminava de montar, e a re-execucao do efeito caía no
  // early-return. Resultado: campos de cartao vazios e impossiveis de
  // preencher, com o botao habilitado. `formNoDom` cobre os tres estados em
  // que o <form> esta renderizado, entao vira true uma vez e so volta a false
  // quando o form realmente sai da tela.
  useEffect(() => {
    if (!formNoDom) return;
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
          submeterRef.current({
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
  }, [formNoDom]);

  if (estado === 'erro') {
    return <p className="text-red-600 text-sm text-center py-6">{erro}</p>;
  }

  if (estado === 'bloqueado') {
    return <p className="text-gray-700 text-sm text-center py-6">{erro}</p>;
  }

  if (estado === 'aguardando_confirmacao') {
    return (
      <div className="text-center py-8">
        <div className="w-7 h-7 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="font-semibold text-gray-800">Confirmando seu pagamento...</p>
        <p className="text-sm text-gray-500 mt-2 leading-relaxed">
          Sua assinatura foi criada e a renovação passa a ser automática. Assim que o pagamento for
          confirmado, seu acesso é liberado aqui mesmo — não é preciso pagar de novo.
        </p>
      </div>
    );
  }

  if (estado === 'sessao_expirada' || estado === 'falha_conexao') {
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
      {formNoDom && (
        <form id={FORM_ID}>
          <label className="block text-xs font-medium text-gray-500 mb-1">Nome no cartão</label>
          <input
            id={ID('cardholderName')}
            type="text"
            placeholder="Como está impresso no cartão"
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />

          <label className="block text-xs font-medium text-gray-500 mb-1">Número do cartão</label>
          <input
            id={ID('cardNumber')}
            type="text"
            inputMode="numeric"
            autoComplete="cc-number"
            placeholder="0000 0000 0000 0000"
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-3"
          />

          <div className="flex gap-3 mb-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Validade</label>
              <input
                id={ID('expirationDate')}
                type="text"
                inputMode="numeric"
                autoComplete="cc-exp"
                placeholder="MM/AA"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">CVV</label>
              <input
                id={ID('securityCode')}
                type="text"
                inputMode="numeric"
                autoComplete="cc-csc"
                placeholder="CVV"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
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
