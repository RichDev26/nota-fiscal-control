'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  PlusCircle, Search, FileText, ChevronLeft, ChevronRight,
  Trash2, Eye, Zap, AlertCircle, CheckCircle,
  SlidersHorizontal,
} from 'lucide-react';
import { AnteciparModal, SuccessOverlay } from '@/components/notas/AnteciparModal';
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
