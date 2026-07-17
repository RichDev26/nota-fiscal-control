'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { validarCpfCnpj } from '@/lib/validators';

interface Props {
  motivo: 'trial_expirado' | 'assinatura_vencida';
}

export default function TelaBloqueio({ motivo }: Props) {
  const router = useRouter();
  const [precisaCpfCnpj, setPrecisaCpfCnpj] = useState(false);
  const [cpfCnpj, setCpfCnpj]               = useState('');
  const [erro, setErro]                     = useState('');
  const [carregando, setCarregando]         = useState(false);
  const [qrCode, setQrCode] = useState<{ qrCode: string; qrCodeBase64: string } | null>(null);

  const gerarPix = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      const r = await fetch('/api/assinatura/pix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cpfCnpj ? { cpfCnpj: cpfCnpj.replace(/\D/g, '') } : {}),
      });
      const d = await r.json();
      if (!r.ok) {
        if (d.precisaCpfCnpj) setPrecisaCpfCnpj(true);
        setErro(d.error || 'Erro ao gerar cobrança.');
        return;
      }
      setQrCode({ qrCode: d.qrCode, qrCodeBase64: d.qrCodeBase64 });
    } catch {
      setErro('Erro de conexão.');
    } finally {
      setCarregando(false);
    }
  }, [cpfCnpj]);

  useEffect(() => {
    if (!qrCode) return;
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
  }, [qrCode, router]);

  const titulo      = motivo === 'trial_expirado' ? 'Seu teste gratuito expirou' : 'Renove seu plano para continuar utilizando';
  const textoBotao   = motivo === 'trial_expirado' ? 'Assinar Agora' : 'Renovar Plano';
  const cpfCnpjValido = validarCpfCnpj(cpfCnpj);

  return (
    <div className="min-h-dvh flex items-center justify-center bg-[#F4F6FB] px-6">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-sm p-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-3">{titulo}</h1>
        <p className="text-gray-500 text-sm mb-8">
          Para continuar utilizando o WorkPro Control, é necessário assinar o plano (R$ 49,90/mês via PIX).
        </p>

        {!qrCode && (
          <>
            {precisaCpfCnpj && (
              <input
                type="text"
                placeholder="CPF ou CNPJ"
                value={cpfCnpj}
                onChange={e => setCpfCnpj(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm mb-4 text-center"
              />
            )}
            {erro && <p className="text-red-600 text-sm mb-4">{erro}</p>}
            <button
              onClick={gerarPix}
              disabled={carregando || (precisaCpfCnpj && !cpfCnpjValido)}
              className="w-full bg-blue-600 text-white font-semibold rounded-xl py-3 disabled:opacity-50"
            >
              {carregando ? 'Gerando...' : textoBotao}
            </button>
          </>
        )}

        {qrCode && (
          <div>
            <img
              src={`data:image/png;base64,${qrCode.qrCodeBase64}`}
              alt="QR Code PIX"
              className="mx-auto mb-4 w-56 h-56"
            />
            <textarea
              readOnly
              value={qrCode.qrCode}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs mb-4"
              rows={3}
              onFocus={e => e.currentTarget.select()}
            />
            <p className="text-gray-400 text-xs">Aguardando confirmação do pagamento...</p>
          </div>
        )}
      </div>
    </div>
  );
}
