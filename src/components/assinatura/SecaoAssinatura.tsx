'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { CreditCard, Loader2, AlertCircle, Check, XCircle } from 'lucide-react';
import { formatarData } from '@/lib/validators';
import { VALOR_ASSINATURA_FORMATADO } from '@/lib/assinatura/config';
import type { StatusAssinatura } from '@/types';

/**
 * Painel de assinatura em Configurações.
 *
 * O cancelamento NÃO revoga acesso: o usuário mantém o período já pago. Como a
 * cobrança de cartão aqui é avulsa (não é uma preapproval recorrente do Mercado
 * Pago), não existe cobrança automática futura para interromper — o texto abaixo
 * diz exatamente isso, em vez de prometer o contrário.
 */
export default function SecaoAssinatura() {
  const [status, setStatus]         = useState<StatusAssinatura | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [modalAberto, setModal]     = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [erro, setErro]             = useState('');
  const [sucesso, setSucesso]       = useState('');

  const carregar = useCallback(async () => {
    try {
      const r = await fetch('/api/assinatura/status');
      if (r.ok) setStatus(await r.json());
    } catch {
      /* mantém o estado anterior */
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  // Fecha o modal com Esc — só quando não há requisição em voo.
  useEffect(() => {
    if (!modalAberto) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !cancelando) setModal(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalAberto, cancelando]);

  const confirmarCancelamento = useCallback(async () => {
    setCancelando(true);
    setErro('');
    try {
      const r = await fetch('/api/assinatura/cancelar', { method: 'POST' });
      const d = await r.json();
      if (!r.ok || !d.cancelada) {
        setErro(d.mensagem || 'Não foi possível cancelar. Tente novamente.');
        return;
      }
      setSucesso(
        d.acessoAte
          ? `Renovação cancelada. Você continua com acesso até ${formatarData(d.acessoAte)}.`
          : 'Renovação cancelada.',
      );
      setModal(false);
      await carregar();
    } catch {
      setErro('Erro de conexão. Tente novamente.');
    } finally {
      setCancelando(false);
    }
  }, [carregar]);

  const cabecalho = (
    <div className="flex items-center gap-2.5 mb-2">
      <div className="w-8 h-8 bg-blue-50 rounded-xl flex items-center justify-center">
        <CreditCard size={15} className="text-blue-600" />
      </div>
      <p className="font-bold text-gray-900">Assinatura</p>
    </div>
  );

  if (carregando) {
    return (
      <div className="card p-6">
        {cabecalho}
        <div className="h-4 bg-gray-100 rounded animate-pulse w-2/3 mt-4" />
      </div>
    );
  }

  const emTrial = Boolean(status?.ativo && !status?.periodoFimEm);
  const acessoAte = status?.periodoFimEm ? formatarData(status.periodoFimEm) : 'o fim do período pago';

  return (
    <div className="card p-6 space-y-4">
      {cabecalho}

      {sucesso && (
        <div className="flex items-center gap-2 rounded-xl p-3.5 text-sm bg-green-50 border border-green-200 text-green-700">
          <Check size={15} className="shrink-0" />{sucesso}
        </div>
      )}
      {erro && !modalAberto && (
        <div className="flex items-center gap-2 rounded-xl p-3.5 text-sm bg-red-50 border border-red-200 text-red-700">
          <AlertCircle size={15} className="shrink-0" />{erro}
        </div>
      )}

      {/* ── Situação atual ── */}
      <div className="space-y-2.5">
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-500">Situação</span>
          <span className={`badge ${
            status?.canceladaEm ? 'bg-amber-100 text-amber-700'
              : status?.ativo   ? 'bg-green-100 text-green-700'
              : 'bg-red-100 text-red-700'
          }`}>
            {status?.canceladaEm ? 'Cancelada' : status?.ativo ? (emTrial ? 'Teste grátis' : 'Ativa') : 'Inativa'}
          </span>
        </div>

        <div className="flex justify-between">
          <span className="text-sm text-gray-500">Plano</span>
          <span className="text-sm font-medium text-gray-900">{VALOR_ASSINATURA_FORMATADO}/mês</span>
        </div>

        {emTrial && status?.trialFimEm && (
          <div className="flex justify-between">
            <span className="text-sm text-gray-500">Teste grátis até</span>
            <span className="text-sm font-medium text-gray-900">{formatarData(status.trialFimEm)}</span>
          </div>
        )}

        {status?.periodoFimEm && (
          <div className="flex justify-between">
            <span className="text-sm text-gray-500">{status.canceladaEm ? 'Acesso até' : 'Renova em'}</span>
            <span className="text-sm font-medium text-gray-900">{formatarData(status.periodoFimEm)}</span>
          </div>
        )}

        {status?.metodoUltimoPagamento && (
          <div className="flex justify-between">
            <span className="text-sm text-gray-500">Último pagamento</span>
            <span className="text-sm font-medium text-gray-900">
              {status.metodoUltimoPagamento === 'CARTAO' ? 'Cartão de crédito' : 'PIX'}
            </span>
          </div>
        )}
      </div>

      {/* ── Ação ── */}
      {status?.canceladaEm ? (
        <p className="text-xs text-gray-400 leading-relaxed border-t border-gray-50 pt-4">
          Renovação cancelada em {formatarData(status.canceladaEm)}. Você mantém o acesso até o fim do
          período já pago e não faremos nenhuma cobrança nova. Para voltar, é só assinar de novo quando quiser.
        </p>
      ) : status?.podeCancelar ? (
        <div className="border-t border-gray-50 pt-4">
          <button
            type="button"
            onClick={() => { setModal(true); setErro(''); }}
            className="btn-secondary w-full justify-center py-3 rounded-2xl text-red-600 hover:bg-red-50 hover:border-red-200"
          >
            <XCircle size={16} /> Cancelar assinatura
          </button>
          <p className="text-xs text-gray-400 mt-2.5 leading-relaxed">
            Você continua com acesso até {acessoAte}. Sem multa e sem cobrança nova.
          </p>
        </div>
      ) : (
        <p className="text-xs text-gray-400 leading-relaxed border-t border-gray-50 pt-4">
          {status?.metodoUltimoPagamento === 'PIX'
            ? 'Seu último pagamento foi via PIX. Como o PIX é avulso, não há renovação automática para cancelar — se você não pagar de novo, o acesso simplesmente encerra no fim do período.'
            : 'O cancelamento pelo painel fica disponível para assinaturas pagas com cartão de crédito.'}
        </p>
      )}

      {!status?.ativo && (
        <Link href="/painel" className="btn-primary w-full justify-center py-3 rounded-2xl">
          Assinar agora
        </Link>
      )}

      {/* ── Modal de confirmação ── */}
      {modalAberto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-cancelar-assinatura"
          onClick={() => { if (!cancelando) setModal(false); }}
        >
          <div
            className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-11 h-11 bg-red-50 rounded-2xl flex items-center justify-center mb-4">
              <AlertCircle size={20} className="text-red-600" />
            </div>
            <h3 id="titulo-cancelar-assinatura" className="font-bold text-gray-900 text-lg">
              Cancelar assinatura?
            </h3>
            <p className="text-sm text-gray-500 mt-2 leading-relaxed">
              Você continua com acesso normal até <strong className="text-gray-800">{acessoAte}</strong>.
              Depois dessa data o acesso encerra e nada é cobrado. Nenhum dado seu é apagado.
            </p>

            {erro && <p className="text-red-600 text-sm mt-3">{erro}</p>}

            <div className="flex gap-2 mt-6">
              <button
                type="button"
                onClick={() => setModal(false)}
                disabled={cancelando}
                className="btn-secondary flex-1 justify-center py-3 rounded-2xl disabled:opacity-50"
              >
                Manter assinatura
              </button>
              <button
                type="button"
                onClick={confirmarCancelamento}
                disabled={cancelando}
                className="btn-danger flex-1 justify-center py-3 rounded-2xl disabled:opacity-50"
              >
                {cancelando ? <Loader2 size={16} className="animate-spin" /> : null}
                {cancelando ? 'Cancelando...' : 'Sim, cancelar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
