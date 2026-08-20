'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { validarCpfCnpj, maskCpfCnpj } from '@/lib/validators';
import { VALOR_ASSINATURA_FORMATADO } from '@/lib/assinatura/config';
import FormularioCartao from './FormularioCartao';

interface Props {
  motivo: 'trial_expirado' | 'assinatura_vencida';
}

/**
 * Interruptor do cartao: sem chave publica do Mercado Pago nao ha como
 * tokenizar, entao a opcao simplesmente nao e oferecida — nada de botao que
 * leva a um formulario quebrado. Serve tambem como kill switch de deploy:
 * enquanto o webhook de "Planos e assinaturas" nao estiver configurado no
 * painel do MP, basta nao publicar a variavel e so o PIX fica exposto.
 * (NEXT_PUBLIC_* e inlinado no build — ligar/desligar exige redeploy.)
 */
const CARTAO_DISPONIVEL = Boolean(process.env.NEXT_PUBLIC_MP_PUBLIC_KEY);

export default function TelaBloqueio({ motivo }: Props) {
  const router = useRouter();
  const [etapa, setEtapa]                   = useState<'inicial' | 'checkout' | 'qrcode' | 'cartao'>('inicial');
  const [cpfCnpj, setCpfCnpj]               = useState('');
  const [erro, setErro]                     = useState('');
  const [carregando, setCarregando]         = useState(false);
  const [qrCode, setQrCode] = useState<{ qrCode: string; qrCodeBase64: string } | null>(null);
  const [copiado, setCopiado]               = useState(false);

  const gerarPix = useCallback(async (cpfCnpjParaEnviar?: string) => {
    setCarregando(true);
    setErro('');
    try {
      const digitos = (cpfCnpjParaEnviar ?? cpfCnpj).replace(/\D/g, '');
      const r = await fetch('/api/assinatura/pix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(digitos ? { cpfCnpj: digitos } : {}),
      });
      const d = await r.json();
      if (!r.ok) {
        if (d.precisaCpfCnpj) { setEtapa('checkout'); setErro(''); return; }
        setErro(d.error || 'Erro ao gerar cobrança.');
        return;
      }
      setQrCode({ qrCode: d.qrCode, qrCodeBase64: d.qrCodeBase64 });
      setEtapa('qrcode');
    } catch {
      setErro('Erro de conexão.');
    } finally {
      setCarregando(false);
    }
  }, [cpfCnpj]);

  const iniciarAssinatura = useCallback(() => {
    // Tenta direto — se o usuário já tem CPF/CNPJ salvo, o backend gera o PIX sem pedir de novo.
    gerarPix('');
  }, [gerarPix]);

  const confirmarCpfCnpj = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!validarCpfCnpj(cpfCnpj)) { setErro('CPF ou CNPJ inválido.'); return; }
    gerarPix(cpfCnpj);
  }, [cpfCnpj, gerarPix]);

  useEffect(() => {
    if (etapa !== 'qrcode') return;
    const id = setInterval(async () => {
      const r = await fetch('/api/assinatura/status');
      if (!r.ok) return;
      const d = await r.json();
      if (d.ativo) {
        clearInterval(id);
        router.refresh();
      }
    }, 4000);
    return () => clearInterval(id);
  }, [etapa, router]);

  const copiarCodigo = useCallback(() => {
    if (!qrCode) return;
    navigator.clipboard.writeText(qrCode.qrCode).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    });
  }, [qrCode]);

  const titulo    = motivo === 'trial_expirado' ? 'Seu teste gratuito expirou' : 'Renove seu plano para continuar utilizando';
  const textoBotao = motivo === 'trial_expirado' ? 'Assinar Agora' : 'Renovar Plano';
  const cpfCnpjValido = validarCpfCnpj(cpfCnpj);

  return (
    <div className="min-h-dvh flex items-center justify-center bg-[#F4F6FB] px-6 py-10">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-sm p-8">

        {/* ── Etapa inicial: mensagem de bloqueio ─────────────────────────── */}
        {etapa === 'inicial' && (
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-3">{titulo}</h1>
            <p className="text-gray-500 text-sm mb-2">
              Para continuar utilizando o WorkPro Control, é necessário assinar o plano.
            </p>
            <p className="text-3xl font-bold text-gray-900 mb-6">
              {VALOR_ASSINATURA_FORMATADO}<span className="text-base font-medium text-gray-400">/mês</span>
            </p>
            {erro && <p className="text-red-600 text-sm mb-4">{erro}</p>}
            <button
              onClick={iniciarAssinatura}
              disabled={carregando}
              className="w-full bg-blue-600 text-white font-semibold rounded-xl py-3 disabled:opacity-50"
            >
              {carregando ? 'Gerando...' : `${textoBotao} com PIX`}
            </button>
            <p className="text-gray-400 text-xs mt-4 mb-4">Pagamento via PIX · confirmação automática</p>
            {CARTAO_DISPONIVEL && (
              <>
                <button
                  type="button"
                  onClick={() => setEtapa('cartao')}
                  className="w-full border border-gray-200 text-gray-700 font-semibold rounded-xl py-3 hover:bg-gray-50"
                >
                  Pagar com cartão
                </button>
                <p className="text-gray-400 text-xs mt-3">Assinatura mensal · renova sozinha · cancele quando quiser</p>
              </>
            )}
          </div>
        )}

        {/* ── Etapa cartão: tokenização no cliente, decisão sempre do backend ── */}
        {etapa === 'cartao' && CARTAO_DISPONIVEL && (
          <div>
            <button
              type="button"
              onClick={() => setEtapa('inicial')}
              className="text-gray-400 text-sm mb-4 hover:text-gray-600"
            >
              ← Voltar
            </button>
            <h1 className="text-xl font-bold text-gray-900 mb-1 text-center">Pagar com cartão</h1>
            <p className="text-gray-500 text-sm mb-6 text-center">
              Assinatura de {VALOR_ASSINATURA_FORMATADO}/mês.
            </p>
            <FormularioCartao onAprovado={() => router.refresh()} />
          </div>
        )}

        {/* ── Etapa checkout: coleta CPF/CNPJ (só na primeira cobrança) ───── */}
        {etapa === 'checkout' && (
          <form onSubmit={confirmarCpfCnpj}>
            <button
              type="button"
              onClick={() => { setEtapa('inicial'); setErro(''); }}
              className="text-gray-400 text-sm mb-4 hover:text-gray-600"
            >
              ← Voltar
            </button>
            <h1 className="text-xl font-bold text-gray-900 mb-1 text-center">Finalizar assinatura</h1>
            <p className="text-gray-500 text-sm mb-6 text-center">
              Informe seu CPF ou CNPJ para gerar o PIX de {VALOR_ASSINATURA_FORMATADO}.
            </p>
            <label className="block text-xs font-medium text-gray-500 mb-1">CPF ou CNPJ</label>
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              placeholder="000.000.000-00"
              value={cpfCnpj}
              onChange={e => setCpfCnpj(maskCpfCnpj(e.target.value))}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm mb-4 text-center tracking-wide focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {erro && <p className="text-red-600 text-sm mb-4 text-center">{erro}</p>}
            <button
              type="submit"
              disabled={carregando || !cpfCnpjValido}
              className="w-full bg-blue-600 text-white font-semibold rounded-xl py-3 disabled:opacity-50"
            >
              {carregando ? 'Gerando PIX...' : 'Gerar PIX'}
            </button>
          </form>
        )}

        {/* ── Etapa QR code: aguardando pagamento ─────────────────────────── */}
        {etapa === 'qrcode' && qrCode && (
          <div className="text-center">
            <h1 className="text-xl font-bold text-gray-900 mb-1">Escaneie o QR Code</h1>
            <p className="text-gray-500 text-sm mb-5">
              Ou copie o código Pix abaixo no app do seu banco. Valor: {VALOR_ASSINATURA_FORMATADO}.
            </p>
            <img
              src={`data:image/png;base64,${qrCode.qrCodeBase64}`}
              alt="QR Code PIX"
              className="mx-auto mb-4 w-56 h-56 rounded-xl border border-gray-100"
            />
            <button
              type="button"
              onClick={copiarCodigo}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-xs text-gray-600 mb-4 hover:bg-gray-50 truncate"
            >
              {copiado ? '✓ Código copiado!' : 'Copiar código Pix'}
            </button>
            <div className="flex items-center justify-center gap-2 text-gray-400 text-xs">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              Aguardando confirmação do pagamento...
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
