'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Wallet, PlusCircle, Search, Loader2,
  AlertCircle, CheckCircle, BarChart2,
} from 'lucide-react';
import { formatarMoeda } from '@/lib/validators';
import { GastoListItem } from '@/components/gastos/GastoListItem';
import { ServicosPanel } from '@/components/gastos/ServicosPanel';
import type { Gasto } from '@/types';

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ msg, type, onClose }: { msg: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className={`toast-enter fixed bottom-24 md:bottom-6 right-4 z-50 flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-xl text-sm font-semibold ${
      type === 'success' ? 'bg-white border border-green-100 text-green-800' : 'bg-white border border-red-100 text-red-700'
    }`}>
      {type === 'success' ? <CheckCircle size={18} className="text-green-500" /> : <AlertCircle size={18} className="text-red-500" />}
      {msg}
    </div>
  );
}

// ─── Períodos ───────────────────────────────────────────────────────────────────
// 'todos' é o padrão: um gasto lançado a partir de um documento usa a data real
// de emissão (quase sempre fora do mês corrente) e não pode ficar escondido da
// lista por causa de um filtro implícito — o usuário só restringe se quiser.
type Periodo = 'todos' | 'mes' | 'hoje' | 'custom';
function rangeFor(p: Periodo, custom: { ini: string; fim: string }): { dataInicio: string; dataFim: string } {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().split('T')[0];
  if (p === 'todos') return { dataInicio: '', dataFim: '' };
  if (p === 'hoje') return { dataInicio: iso(now), dataFim: iso(now) };
  if (p === 'mes') {
    return {
      dataInicio: iso(new Date(now.getFullYear(), now.getMonth(), 1)),
      dataFim:    iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    };
  }
  return { dataInicio: custom.ini, dataFim: custom.fim };
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function GastosPage() {
  const [gastos, setGastos]   = useState<Gasto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca]     = useState('');
  const [periodo, setPeriodo] = useState<Periodo>('todos');
  const [custom, setCustom]   = useState({ ini: '', fim: '' });
  const [toast, setToast]     = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const fetchGastos = useCallback(async () => {
    setLoading(true);
    try {
      const { dataInicio, dataFim } = rangeFor(periodo, custom);
      const params = new URLSearchParams({ busca });
      if (periodo !== 'custom' || (custom.ini && custom.fim)) {
        if (dataInicio) params.set('dataInicio', dataInicio);
        if (dataFim)    params.set('dataFim', dataFim);
      }
      const r = await fetch(`/api/gastos?${params}`);
      const d = await r.json();
      setGastos(Array.isArray(d) ? d : []);
    } finally { setLoading(false); }
  }, [busca, periodo, custom]);

  useEffect(() => { fetchGastos(); }, [fetchGastos]);

  const handleDelete = async (g: Gasto) => {
    if (!confirm(`Excluir "${g.descricao}"?`)) return;
    const r = await fetch(`/api/gastos/${g.id}`, { method: 'DELETE' });
    if (r.ok) { setToast({ msg: 'Gasto excluído.', type: 'success' }); fetchGastos(); }
    else setToast({ msg: 'Erro ao excluir.', type: 'error' });
  };

  const total = gastos.reduce((s, g) => s + (g.valor || 0), 0);

  return (
    <div className="p-5 md:p-8 max-w-6xl mx-auto">
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div className="lg:grid lg:grid-cols-[1fr_320px] xl:grid-cols-[1fr_360px] lg:gap-6 lg:items-start">
      <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between pt-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-50 rounded-2xl flex items-center justify-center">
            <Wallet size={18} className="text-purple-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Gastos</h1>
            <p className="text-sm text-gray-400 mt-0.5">Controle simples e rápido</p>
          </div>
        </div>
        <Link href="/gastos/novo" className="btn-primary hidden sm:flex">
          <PlusCircle size={16} /> Novo Gasto
        </Link>
      </div>

      {/* Resumo do período */}
      <div className="card p-5 flex items-center gap-4 bg-gradient-to-r from-purple-600 to-purple-700 border-0">
        <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center shrink-0">
          <Wallet size={22} className="text-white" />
        </div>
        <div className="flex-1">
          <p className="text-purple-100 text-sm font-medium">Total no período</p>
          <p className="text-white text-2xl font-bold">{formatarMoeda(total)}</p>
        </div>
        <div className="text-right">
          <p className="text-white text-2xl font-bold">{gastos.length}</p>
          <p className="text-purple-100 text-xs font-medium">gasto{gastos.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {/* Botão mobile */}
      <Link href="/gastos/novo" className="btn-primary w-full justify-center py-4 rounded-2xl text-base sm:hidden">
        <PlusCircle size={20} /> Novo Gasto
      </Link>

      {/* Busca */}
      <div className="relative">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text" placeholder="Buscar por descrição, fornecedor, categoria..."
          className="input pl-10"
          value={busca} onChange={e => setBusca(e.target.value)}
        />
      </div>

      {/* Filtros de período */}
      <div className="flex items-center gap-2 flex-wrap">
        {([['todos', 'Todos'], ['mes', 'Este mês'], ['hoje', 'Hoje'], ['custom', 'Período']] as const).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setPeriodo(v)}
            className={`px-3.5 py-1.5 rounded-xl text-sm font-semibold transition-colors ${
              periodo === v ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-500 hover:border-gray-300'
            }`}
          >
            {label}
          </button>
        ))}
        <Link href="/gastos/relatorios" className="ml-auto btn-ghost btn-sm text-blue-600 flex items-center gap-1 text-sm font-semibold">
          <BarChart2 size={14} /> Relatório
        </Link>
      </div>

      {periodo === 'custom' && (
        <div className="card p-4 grid grid-cols-2 gap-3 animate-enter">
          <div>
            <label className="label">De</label>
            <input type="date" className="input" value={custom.ini} onChange={e => setCustom(c => ({ ...c, ini: e.target.value }))} />
          </div>
          <div>
            <label className="label">Até</label>
            <input type="date" className="input" value={custom.fim} onChange={e => setCustom(c => ({ ...c, fim: e.target.value }))} />
          </div>
        </div>
      )}

      {/* Lista */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-blue-400" /></div>
      ) : gastos.length === 0 ? (
        <div className="card p-12 flex flex-col items-center gap-4 text-center">
          <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center">
            <Wallet size={28} className="text-gray-300" />
          </div>
          <div>
            <p className="font-semibold text-gray-500">Nenhum gasto encontrado</p>
            <p className="text-sm text-gray-400 mt-1">{busca ? 'Tente outra busca' : 'Registre seu primeiro gasto'}</p>
          </div>
          <Link href="/gastos/novo" className="btn-primary"><PlusCircle size={15} /> Novo Gasto</Link>
        </div>
      ) : (
        <div className="space-y-2">
          {gastos.map(g => <GastoListItem key={g.id} gasto={g} onDelete={handleDelete} />)}
        </div>
      )}
      </div>

      <div className="mt-5 lg:mt-0">
        <ServicosPanel />
      </div>
      </div>
    </div>
  );
}
