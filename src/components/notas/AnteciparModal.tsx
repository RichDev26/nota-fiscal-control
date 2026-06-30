'use client';

import { useState, useEffect } from 'react';
import { Zap, X, AlertCircle, DollarSign, CheckCircle } from 'lucide-react';
import { formatarMoeda, formatarData } from '@/lib/validators';
import type { NotaFiscal } from '@/types';

// ─── Confetti ────────────────────────────────────────────────────────────────
const CONFETTI_COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4'];

export function SuccessOverlay({ onDone }: { onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 2800); return () => clearTimeout(t); }, [onDone]);
  const pieces = Array.from({ length: 20 }, (_, i) => ({
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    left: `${4 + Math.random() * 92}%`,
    delay: `${Math.random() * 0.6}s`,
    size: 6 + Math.random() * 8,
  }));
  return (
    <div
      className="success-overlay fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/50 backdrop-blur-sm cursor-pointer"
      onClick={onDone}
    >
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {pieces.map((p, i) => (
          <div
            key={i}
            className="confetti-piece absolute top-0 rounded-sm"
            style={{ left: p.left, width: p.size, height: p.size, background: p.color, animationDelay: p.delay }}
          />
        ))}
      </div>
      <div className="bg-white rounded-3xl shadow-2xl px-12 py-10 flex flex-col items-center gap-4 max-w-xs text-center">
        <div className="relative w-24 h-24">
          <svg className="success-circle w-24 h-24" viewBox="0 0 96 96" fill="none">
            <circle cx="48" cy="48" r="44" fill="#dcfce7" stroke="#22c55e" strokeWidth="4" />
          </svg>
          <svg className="absolute inset-0 w-24 h-24" viewBox="0 0 96 96" fill="none">
            <polyline className="success-check" points="28,50 42,64 68,36" stroke="#16a34a" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="success-text">
          <p className="text-xl font-bold text-gray-900">Nota Antecipada!</p>
          <p className="text-sm text-gray-500 mt-1">Valores atualizados com sucesso</p>
          <p className="text-xs text-gray-400 mt-4">Clique para fechar</p>
        </div>
      </div>
    </div>
  );
}

// ─── Modal ───────────────────────────────────────────────────────────────────
export function AnteciparModal({
  nota,
  onClose,
  onSuccess,
}: {
  nota: NotaFiscal;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const hoje = new Date();
  const venc = nota.dataVencimento ? new Date(nota.dataVencimento) : null;
  const diasDefault = venc ? Math.max(1, Math.ceil((venc.getTime() - hoje.getTime()) / 86400000)) : 30;

  // Modo "Valor do Encargo" é o padrão — exige um único campo do usuário.
  const [modo, setModo] = useState<'DIRECT_FEE' | 'RATE_AND_DAYS'>('DIRECT_FEE');

  // Modo Taxa + Dias — lógica de cálculo 100% preservada do que já existia.
  const [taxa, setTaxa]     = useState('2.50');
  const [dias, setDias]     = useState(String(diasDefault));

  // Modo Valor do Encargo — único campo novo.
  const [encargoInput, setEncargoInput] = useState('');

  const [loading, setLoading] = useState(false);
  const [err, setErr]       = useState('');

  const valorBase = nota.valorLiquido ?? nota.valorBruto ?? 0;

  const encargosRateAndDays = valorBase * (parseFloat(taxa) / 100) * (parseInt(dias) / 30);
  const encargoDireto       = parseFloat(encargoInput.replace(',', '.')) || 0;

  const encargos        = modo === 'DIRECT_FEE' ? encargoDireto : encargosRateAndDays;
  const valorAntecipado = Math.max(0, valorBase - encargos);

  const encargoInvalido = modo === 'DIRECT_FEE' && (encargoDireto < 0 || encargoDireto > valorBase);

  const handleAntecipar = async () => {
    if (encargoInvalido) return;
    setLoading(true); setErr('');
    try {
      const res = await fetch(`/api/notas/${nota.id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status:                       'antecipada',
          dataRecebimento:              hoje.toISOString().split('T')[0],
          valorLiquidoAntecipacao:      parseFloat(valorAntecipado.toFixed(2)),
          valorTotalTributosAntecipacao: parseFloat(encargos.toFixed(2)),
          metodoAntecipacao:            modo,
          taxaAntecipacao:              modo === 'RATE_AND_DAYS' ? parseFloat(taxa) : null,
          diasAntecipacao:              modo === 'RATE_AND_DAYS' ? parseInt(dias)   : null,
        }),
      });
      if (!res.ok) { const d = await res.json(); setErr(d.detail || d.error || 'Erro.'); return; }
      onSuccess();
    } catch { setErr('Erro de conexão.'); }
    finally { setLoading(false); }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 animate-enter"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-amber-50 rounded-xl flex items-center justify-center">
              <Zap size={18} className="text-amber-500" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900">Antecipar Nota</h3>
              <p className="text-xs text-gray-400 truncate max-w-[180px]">
                {nota.nomeOrganizador || `NF ${nota.numeroNf}`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5"><X size={16} /></button>
        </div>

        <div className="bg-gray-50 rounded-2xl p-4 mb-4">
          <p className="text-xs text-gray-400 mb-0.5">Valor da nota (líquido)</p>
          <p className="text-2xl font-bold text-gray-900">{formatarMoeda(valorBase)}</p>
          {venc && (
            <p className="text-xs text-gray-400 mt-1">
              Vence em {formatarData(nota.dataVencimento)} · {diasDefault} dia{diasDefault !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        <div className="mb-4">
          <label className="label">Modo de cálculo</label>
          <div className="grid grid-cols-2 gap-2">
            {([
              { v: 'DIRECT_FEE',     label: 'Valor do Encargo' },
              { v: 'RATE_AND_DAYS',  label: 'Taxa + Dias' },
            ] as const).map(opt => (
              <button
                key={opt.v}
                type="button"
                onClick={() => setModo(opt.v)}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-sm font-semibold transition-colors ${
                  modo === opt.v
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                <span className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 ${
                  modo === opt.v ? 'border-blue-500' : 'border-gray-300'
                }`}>
                  {modo === opt.v && <span className="block w-1.5 h-1.5 m-auto mt-[3px] rounded-full bg-blue-500" />}
                </span>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {modo === 'DIRECT_FEE' ? (
          <div className="mb-4">
            <label className="label">Valor do Encargo</label>
            <input
              type="number" step="0.01" min="0" inputMode="decimal" className="input"
              placeholder="0,00"
              value={encargoInput} onChange={e => setEncargoInput(e.target.value)}
            />
            {encargoInvalido && (
              <p className="text-xs text-red-500 mt-1">
                {encargoDireto < 0 ? 'O encargo não pode ser negativo.' : 'O encargo não pode ser maior que o valor líquido da nota.'}
              </p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="label">Taxa (% ao mês)</label>
              <input
                type="number" step="0.1" min="0" max="20" className="input"
                value={taxa} onChange={e => setTaxa(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Dias até vencimento</label>
              <input
                type="number" step="1" min="1" className="input"
                value={dias} onChange={e => setDias(e.target.value)}
              />
            </div>
          </div>
        )}

        <div className="bg-amber-50 rounded-2xl p-4 mb-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">
              Encargos{modo === 'RATE_AND_DAYS' ? ` (${parseFloat(taxa || '0').toFixed(1)}% × ${dias}d)` : ''}
            </span>
            <span className="font-semibold text-amber-700">- {formatarMoeda(encargos)}</span>
          </div>
          <div className="h-px bg-amber-200" />
          <div className="flex justify-between">
            <span className="font-bold text-gray-700 text-sm">Você receberá</span>
            <span className="font-bold text-green-700 text-lg">{formatarMoeda(valorAntecipado)}</span>
          </div>
        </div>

        {err && (
          <div className="flex items-center gap-2 bg-red-50 text-red-700 rounded-xl p-3 text-sm mb-3">
            <AlertCircle size={14} />{err}
          </div>
        )}

        <button
          onClick={handleAntecipar}
          disabled={loading || encargoInvalido}
          className="btn-primary w-full py-3 rounded-2xl text-base"
        >
          <DollarSign size={16} />
          {loading ? 'Antecipando...' : 'Confirmar Antecipação'}
        </button>
      </div>
    </div>
  );
}
