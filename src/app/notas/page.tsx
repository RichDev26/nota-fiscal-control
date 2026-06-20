'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  PlusCircle, Search, FileText, ChevronLeft, ChevronRight,
  Trash2, Eye, Zap, X, AlertCircle, CheckCircle, DollarSign,
  SlidersHorizontal,
} from 'lucide-react';
import { formatarMoeda, formatarData } from '@/lib/validators';
import { STATUS_LABELS, STATUS_COLORS } from '@/types';
import type { NotaFiscal } from '@/types';

const STATUS_OPTIONS = ['rascunho', 'lancada', 'recebida', 'antecipada', 'incompleta', 'invalida', 'substitutiva', 'substituida', 'cancelada'];

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ msg, type, onClose }: { msg: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className={`toast-enter fixed bottom-24 md:bottom-6 right-4 z-40 flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-xl text-sm font-semibold ${
      type === 'success' ? 'bg-white border border-green-100 text-green-800' : 'bg-white border border-red-100 text-red-700'
    }`}>
      {type === 'success' ? <CheckCircle size={18} className="text-green-500" /> : <AlertCircle size={18} className="text-red-500" />}
      {msg}
    </div>
  );
}

// ─── Success overlay ──────────────────────────────────────────────────────────
const CONFETTI_COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4'];

function SuccessOverlay({ onDone }: { onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 2800); return () => clearTimeout(t); }, [onDone]);
  const pieces = Array.from({ length: 20 }, (_, i) => ({
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    left: `${4 + Math.random() * 92}%`,
    delay: `${Math.random() * 0.6}s`,
    size: 6 + Math.random() * 8,
  }));
  return (
    <div className="success-overlay fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/50 backdrop-blur-sm cursor-pointer" onClick={onDone}>
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {pieces.map((p, i) => (
          <div key={i} className="confetti-piece absolute top-0 rounded-sm"
            style={{ left: p.left, width: p.size, height: p.size, background: p.color, animationDelay: p.delay }} />
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

// ─── Modal Antecipar ──────────────────────────────────────────────────────────
function AnteciparModal({ nota, onClose, onSuccess }: { nota: NotaFiscal; onClose: () => void; onSuccess: () => void }) {
  const hoje = new Date();
  const venc = nota.dataVencimento ? new Date(nota.dataVencimento) : null;
  const diasDefault = venc ? Math.max(1, Math.ceil((venc.getTime() - hoje.getTime()) / 86400000)) : 30;

  const [taxa, setTaxa]   = useState('2.50');
  const [dias, setDias]   = useState(String(diasDefault));
  const [loading, setLoading] = useState(false);
  const [err, setErr]     = useState('');

  const valorBase     = nota.valorLiquido ?? nota.valorBruto ?? 0;
  const encargos      = valorBase * (parseFloat(taxa) / 100) * (parseInt(dias) / 30);
  const valorAntecipado = Math.max(0, valorBase - encargos);

  const handleAntecipar = async () => {
    setLoading(true); setErr('');
    try {
      const res = await fetch(`/api/notas/${nota.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'antecipada',
          dataRecebimento: hoje.toISOString().split('T')[0],
          valorLiquidoAntecipacao: parseFloat(valorAntecipado.toFixed(2)),
          valorTotalTributosAntecipacao: parseFloat(encargos.toFixed(2)),
        }),
      });
      if (!res.ok) { const d = await res.json(); setErr(d.detail || d.error || 'Erro.'); return; }
      onSuccess();
    } catch { setErr('Erro de conexão.'); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 animate-enter" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-amber-50 rounded-xl flex items-center justify-center">
              <Zap size={18} className="text-amber-500" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900">Antecipar Nota</h3>
              <p className="text-xs text-gray-400 truncate max-w-[180px]">{nota.nomeOrganizador || `NF ${nota.numeroNf}`}</p>
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5"><X size={16} /></button>
        </div>

        <div className="bg-gray-50 rounded-2xl p-4 mb-4">
          <p className="text-xs text-gray-400 mb-0.5">Valor da nota (líquido)</p>
          <p className="text-2xl font-bold text-gray-900">{formatarMoeda(valorBase)}</p>
          {venc && <p className="text-xs text-gray-400 mt-1">Vence em {formatarData(nota.dataVencimento)} · {diasDefault} dia{diasDefault !== 1 ? 's' : ''}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="label">Taxa (% ao mês)</label>
            <input type="number" step="0.1" min="0" max="20" className="input" value={taxa} onChange={e => setTaxa(e.target.value)} />
          </div>
          <div>
            <label className="label">Dias até vencimento</label>
            <input type="number" step="1" min="1" className="input" value={dias} onChange={e => setDias(e.target.value)} />
          </div>
        </div>

        <div className="bg-amber-50 rounded-2xl p-4 mb-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Encargos ({parseFloat(taxa).toFixed(1)}% × {dias}d)</span>
            <span className="font-semibold text-amber-700">- {formatarMoeda(encargos)}</span>
          </div>
          <div className="h-px bg-amber-200" />
          <div className="flex justify-between">
            <span className="font-bold text-gray-700 text-sm">Você receberá</span>
            <span className="font-bold text-green-700 text-lg">{formatarMoeda(valorAntecipado)}</span>
          </div>
        </div>

        {err && <div className="flex items-center gap-2 bg-red-50 text-red-700 rounded-xl p-3 text-sm mb-3"><AlertCircle size={14} />{err}</div>}

        <button onClick={handleAntecipar} disabled={loading} className="btn-primary w-full py-3 rounded-2xl text-base">
          <DollarSign size={16} />
          {loading ? 'Antecipando...' : 'Confirmar Antecipação'}
        </button>
      </div>
    </div>
  );
}

// ─── Nota card ────────────────────────────────────────────────────────────────
function NotaCard({ n, onAntecipar, onDelete }: { n: NotaFiscal; onAntecipar: (n: NotaFiscal) => void; onDelete: (n: NotaFiscal) => void }) {
  const tomador = (n.tomador?.nomeRazaoSocial || n.tomador?.nomeFantasia || '').replace(/\s+(Ltda\.?|S\.A\.?|ME\.?|EIRELI)\.?$/i, '').trim().slice(0, 24);
  const podeAntecipar = n.status !== 'antecipada' && (n.valorLiquido ?? 0) > 0;

  return (
    <div className="card overflow-hidden">
      <Link href={`/notas/${n.id}`} className="block p-4 hover:bg-gray-50/50 transition-colors">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-900 truncate text-[15px]">
              {n.nomeOrganizador || `NF ${n.numeroNf || 'S/N'}`}
            </p>
            <p className="text-sm text-gray-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
              {n.numeroNf && <span>NF {n.numeroNf}</span>}
              {n.dataEmissao && <><span>·</span><span>{formatarData(n.dataEmissao)}</span></>}
              {tomador && <><span>·</span><span className="truncate">{tomador}</span></>}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="font-bold text-gray-900 text-[15px]">{formatarMoeda(n.valorBruto)}</p>
            <span className={`badge ${STATUS_COLORS[n.status] || 'bg-gray-100 text-gray-500'} mt-0.5 text-[10px]`}>
              {STATUS_LABELS[n.status] || n.status}
            </span>
          </div>
        </div>
      </Link>

      {/* Actions row */}
      {(podeAntecipar || true) && (
        <div className="flex items-center gap-2 px-4 pb-3 pt-0">
          <Link href={`/notas/${n.id}`} className="btn-ghost btn-sm py-1.5 flex items-center gap-1 text-gray-500">
            <Eye size={13} /> Ver
          </Link>
          {podeAntecipar && (
            <button onClick={() => onAntecipar(n)} className="btn-amber btn-sm py-1.5 flex items-center gap-1">
              <Zap size={13} /> Antecipar
            </button>
          )}
          <button onClick={() => onDelete(n)} className="btn-ghost btn-sm py-1.5 text-red-400 hover:text-red-600 ml-auto">
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function NotasContent() {
  const sp = useSearchParams();

  const [notas, setNotas]       = useState<NotaFiscal[]>([]);
  const [total, setTotal]       = useState(0);
  const [totalPaginas, setTotalPaginas] = useState(1);
  const [loading, setLoading]   = useState(true);
  const [showFilters, setShowFilters] = useState(false);

  const [busca, setBusca]       = useState(sp.get('busca') || '');
  const [status, setStatus]     = useState(sp.get('status') || '');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim]   = useState('');
  const [pagina, setPagina]     = useState(1);

  const [anteciparNota, setAnteciparNota]   = useState<NotaFiscal | null>(null);
  const [successOverlay, setSuccessOverlay] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type });

  const fetchNotas = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      busca, status, dataInicio, dataFim,
      ordenarPor: 'createdAt', ordem: 'desc',
      pagina: String(pagina), por: '12',
    });
    try {
      const r = await fetch(`/api/notas?${params}`);
      const d = await r.json();
      setNotas(d.notas || []);
      setTotal(d.total || 0);
      setTotalPaginas(d.totalPaginas || 1);
    } finally { setLoading(false); }
  }, [busca, status, dataInicio, dataFim, pagina]);

  useEffect(() => { fetchNotas(); }, [fetchNotas]);

  const handleDelete = async (n: NotaFiscal) => {
    if (!confirm(`Excluir "${n.nomeOrganizador || n.numeroNf}"? Esta ação não pode ser desfeita.`)) return;
    const res = await fetch(`/api/notas/${n.id}`, { method: 'DELETE' });
    if (res.ok) { showToast('Nota excluída.'); fetchNotas(); }
    else showToast('Erro ao excluir.', 'error');
  };

  const handleAnteciparSuccess = () => {
    setAnteciparNota(null);
    fetchNotas();
    setSuccessOverlay(true);
  };

  return (
    <div className="p-5 md:p-8 max-w-2xl mx-auto space-y-5">
      {successOverlay && <SuccessOverlay onDone={() => setSuccessOverlay(false)} />}
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      {anteciparNota && (
        <AnteciparModal nota={anteciparNota} onClose={() => setAnteciparNota(null)} onSuccess={handleAnteciparSuccess} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between pt-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Notas Fiscais</h1>
          <p className="text-sm text-gray-400 mt-0.5">{total} nota{total !== 1 ? 's' : ''}</p>
        </div>
        <Link href="/notas/nova" className="btn-primary hidden sm:flex">
          <PlusCircle size={16} /> Nova Nota
        </Link>
      </div>

      {/* Busca + filtros */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text" placeholder="Buscar por nome, NF, tomador..."
              className="input pl-10"
              value={busca}
              onChange={e => { setBusca(e.target.value); setPagina(1); }}
            />
          </div>
          <button
            onClick={() => setShowFilters(f => !f)}
            className={`btn-secondary px-3 ${showFilters ? 'bg-blue-50 border-blue-200 text-blue-700' : ''}`}
          >
            <SlidersHorizontal size={16} />
          </button>
        </div>

        {showFilters && (
          <div className="card p-4 space-y-3 animate-enter">
            <div className="space-y-2 sm:grid sm:grid-cols-4 sm:gap-2 sm:space-y-0">
              <select className="input-sm input" value={status} onChange={e => { setStatus(e.target.value); setPagina(1); }}>
                <option value="">Todos os status</option>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-2 sm:contents">
                <input type="date" className="input-sm input min-w-0" value={dataInicio} onChange={e => { setDataInicio(e.target.value); setPagina(1); }} />
                <input type="date" className="input-sm input min-w-0" value={dataFim} onChange={e => { setDataFim(e.target.value); setPagina(1); }} />
              </div>
              {(status || dataInicio || dataFim) && (
                <button className="btn-ghost btn-sm text-red-500 text-xs" onClick={() => { setStatus(''); setDataInicio(''); setDataFim(''); setPagina(1); }}>
                  Limpar
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : notas.length === 0 ? (
        <div className="card p-12 flex flex-col items-center gap-4 text-center">
          <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center">
            <FileText size={28} className="text-gray-300" />
          </div>
          <div>
            <p className="font-semibold text-gray-500">Nenhuma nota encontrada</p>
            <p className="text-sm text-gray-400 mt-1">
              {busca || status ? 'Tente outros filtros' : 'Lance sua primeira nota agora'}
            </p>
          </div>
          <Link href="/notas/nova" className="btn-primary">
            <PlusCircle size={15} /> Nova Nota
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {notas.map(n => (
            <NotaCard key={n.id} n={n} onAntecipar={setAnteciparNota} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {/* Paginação */}
      {totalPaginas > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button className="btn-secondary btn-sm" disabled={pagina <= 1} onClick={() => setPagina(p => p - 1)}>
            <ChevronLeft size={15} />
          </button>
          <span className="text-sm text-gray-500 px-2">
            {pagina} / {totalPaginas}
          </span>
          <button className="btn-secondary btn-sm" disabled={pagina >= totalPaginas} onClick={() => setPagina(p => p + 1)}>
            <ChevronRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

export default function NotasPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>}>
      <NotasContent />
    </Suspense>
  );
}
