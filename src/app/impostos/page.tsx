'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  PlusCircle, X, Save, Loader2, AlertCircle, CheckCircle,
  Receipt, Trash2, Edit3, Calendar,
} from 'lucide-react';
import { formatarMoeda, formatarData } from '@/lib/validators';
import { STATUS_IMPOSTO_LABELS, STATUS_IMPOSTO_COLORS } from '@/types';
import type { Imposto } from '@/types';

const TIPOS = ['ISS', 'IRPJ', 'CSLL', 'PIS', 'COFINS', 'INSS', 'IRRF', 'Simples Nacional', 'Outros'];
const STATUS_OPTS = ['pendente', 'pago', 'vencido', 'cancelado'];

const emptyForm = () => ({
  mesReferencia: '', dataVencimento: '', dataPagamento: '',
  imposto: '', valor: '', status: 'pendente', observacao: '',
});

// ─── Toast ─────────────────────────────────────────────────────────────────────
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

// ─── Modal Imposto ─────────────────────────────────────────────────────────────
function ImpostoModal({ editId, initial, onClose, onSaved }: {
  editId: string | null; initial: Record<string, string>;
  onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const f = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  const handleSubmit = async () => {
    if (!form.imposto || !form.valor) { setError('Imposto e valor são obrigatórios.'); return; }
    setSaving(true); setError('');
    try {
      const payload = { ...form, valor: parseFloat(form.valor) || 0 };
      const url    = editId ? `/api/impostos/${editId}` : '/api/impostos';
      const method = editId ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Erro.'); return; }
      onSaved();
    } catch { setError('Erro ao salvar.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 animate-enter" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-gray-900 text-lg">{editId ? 'Editar Imposto' : 'Novo Imposto'}</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X size={16} /></button>
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-50 text-red-700 rounded-xl p-3 text-sm mb-4">
            <AlertCircle size={14} />{error}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="label">Tipo de Imposto *</label>
            <select className="input" value={form.imposto} onChange={e => f('imposto', e.target.value)}>
              <option value="">Selecione...</option>
              {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Valor (R$) *</label>
            <input type="number" step="0.01" className="input text-lg font-bold" placeholder="0,00"
              value={form.valor} onChange={e => f('valor', e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Mês Referência</label>
              <input type="month" className="input" value={form.mesReferencia} onChange={e => f('mesReferencia', e.target.value)} />
            </div>
            <div>
              <label className="label">Vencimento</label>
              <input type="date" className="input" value={form.dataVencimento} onChange={e => f('dataVencimento', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Pagamento</label>
              <input type="date" className="input" value={form.dataPagamento} onChange={e => f('dataPagamento', e.target.value)} />
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input" value={form.status} onChange={e => f('status', e.target.value)}>
                {STATUS_OPTS.map(s => <option key={s} value={s}>{STATUS_IMPOSTO_LABELS[s] || s}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Observação</label>
            <input type="text" className="input" placeholder="Opcional" value={form.observacao} onChange={e => f('observacao', e.target.value)} />
          </div>
        </div>

        <button onClick={handleSubmit} disabled={saving}
          className="btn-primary w-full py-3.5 rounded-2xl text-base justify-center mt-5">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {editId ? 'Atualizar' : 'Salvar Imposto'}
        </button>
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function ImpostosPage() {
  const now = new Date();
  const defaultMes = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [impostos, setImpostos] = useState<Imposto[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filterMes, setFilterMes] = useState(defaultMes);
  const [showModal, setShowModal]  = useState(false);
  const [editId, setEditId]        = useState<string | null>(null);
  const [editForm, setEditForm]    = useState<Record<string, string>>(emptyForm());
  const [toast, setToast]          = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => setToast({ msg, type });

  const fetchImpostos = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ mesReferencia: filterMes });
      const r = await fetch(`/api/impostos?${p}`);
      const d = await r.json();
      setImpostos(Array.isArray(d) ? d : []);
    } finally { setLoading(false); }
  }, [filterMes]);

  useEffect(() => { fetchImpostos(); }, [fetchImpostos]);

  const openNew = () => {
    const initial = emptyForm();
    initial.mesReferencia = filterMes;
    setEditForm(initial); setEditId(null); setShowModal(true);
  };

  const openEdit = (imp: Imposto) => {
    setEditForm({
      mesReferencia: imp.mesReferencia || '',
      dataVencimento: imp.dataVencimento ? new Date(imp.dataVencimento).toISOString().split('T')[0] : '',
      dataPagamento: imp.dataPagamento ? new Date(imp.dataPagamento).toISOString().split('T')[0] : '',
      imposto: imp.imposto || '', valor: imp.valor != null ? String(imp.valor) : '',
      status: imp.status, observacao: imp.observacao || '',
    });
    setEditId(imp.id); setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este imposto?')) return;
    await fetch(`/api/impostos/${id}`, { method: 'DELETE' });
    showToast('Imposto excluído.');
    fetchImpostos();
  };

  const handlePago = async (imp: Imposto) => {
    await fetch(`/api/impostos/${imp.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...imp, status: 'pago', dataPagamento: new Date().toISOString().split('T')[0] }),
    });
    showToast('Marcado como pago!');
    fetchImpostos();
  };

  const handleSaved = () => {
    setShowModal(false);
    showToast(editId ? 'Imposto atualizado!' : 'Imposto adicionado!');
    fetchImpostos();
  };

  // Totais do mês
  const totalPendente = impostos.filter(i => i.status === 'pendente').reduce((s, i) => s + (i.valor || 0), 0);
  const totalPago     = impostos.filter(i => i.status === 'pago').reduce((s, i) => s + (i.valor || 0), 0);
  const totalVencido  = impostos.filter(i => i.status === 'vencido').reduce((s, i) => s + (i.valor || 0), 0);
  const total         = impostos.reduce((s, i) => s + (i.valor || 0), 0);

  // Formata mês para exibição
  const mesBR = (() => {
    if (!filterMes) return '';
    const [y, m] = filterMes.split('-');
    const d = new Date(parseInt(y), parseInt(m) - 1);
    return d.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
  })();

  const statusGroup: Record<string, Imposto[]> = {};
  impostos.forEach(i => {
    const k = i.imposto || 'Outros';
    if (!statusGroup[k]) statusGroup[k] = [];
    statusGroup[k].push(i);
  });

  return (
    <div className="p-5 md:p-8 max-w-lg mx-auto space-y-6">
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      {showModal && (
        <ImpostoModal editId={editId} initial={editForm} onClose={() => setShowModal(false)} onSaved={handleSaved} />
      )}

      {/* Header */}
      <div className="pt-2 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-0.5">
            <div className="w-10 h-10 bg-orange-50 rounded-2xl flex items-center justify-center">
              <Receipt size={18} className="text-orange-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Impostos</h1>
          </div>
          {mesBR && <p className="text-sm text-gray-400 capitalize mt-0.5">{mesBR}</p>}
        </div>
        <button onClick={openNew} className="btn-primary shrink-0">
          <PlusCircle size={15} /> Adicionar
        </button>
      </div>

      {/* Seletor de mês */}
      <div className="card p-4 flex items-center gap-3">
        <Calendar size={16} className="text-gray-400 shrink-0" />
        <div className="flex-1">
          <label className="label mb-0.5">Mês de referência</label>
          <input type="month" className="input py-1.5 text-sm" value={filterMes} onChange={e => setFilterMes(e.target.value)} />
        </div>
      </div>

      {/* Totais */}
      {impostos.length > 0 && (
        <div className="card p-5">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">Total do mês</p>
          <p className="text-3xl font-bold text-gray-900 mb-4">{formatarMoeda(total)}</p>
          <div className="grid grid-cols-3 gap-3">
            {totalPendente > 0 && (
              <div className="text-center">
                <p className="text-sm font-bold text-amber-700">{formatarMoeda(totalPendente)}</p>
                <p className="text-[10px] text-gray-400 font-medium mt-0.5">Pendente</p>
              </div>
            )}
            {totalPago > 0 && (
              <div className="text-center">
                <p className="text-sm font-bold text-green-700">{formatarMoeda(totalPago)}</p>
                <p className="text-[10px] text-gray-400 font-medium mt-0.5">Pago</p>
              </div>
            )}
            {totalVencido > 0 && (
              <div className="text-center">
                <p className="text-sm font-bold text-red-700">{formatarMoeda(totalVencido)}</p>
                <p className="text-[10px] text-gray-400 font-medium mt-0.5">Vencido</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Lista */}
      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 size={24} className="animate-spin text-blue-400" />
        </div>
      ) : impostos.length === 0 ? (
        <div className="card p-12 flex flex-col items-center gap-4 text-center">
          <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center">
            <Receipt size={28} className="text-gray-300" />
          </div>
          <div>
            <p className="font-semibold text-gray-500">Nenhum imposto</p>
            <p className="text-sm text-gray-400 mt-1">Adicione os impostos deste mês</p>
          </div>
          <button onClick={openNew} className="btn-primary">
            <PlusCircle size={15} /> Adicionar Imposto
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {impostos.map(imp => (
            <div key={imp.id} className="card p-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center shrink-0">
                  <Receipt size={16} className="text-orange-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-gray-900">{imp.imposto}</p>
                    <span className={`badge ${STATUS_IMPOSTO_COLORS[imp.status] || 'bg-gray-100 text-gray-500'} text-[10px]`}>
                      {STATUS_IMPOSTO_LABELS[imp.status] || imp.status}
                    </span>
                  </div>
                  <p className="text-xl font-bold text-gray-900 mt-0.5">{formatarMoeda(imp.valor)}</p>
                  <div className="flex gap-3 mt-1 flex-wrap">
                    {imp.dataVencimento && (
                      <p className="text-xs text-gray-400">Vence {formatarData(imp.dataVencimento)}</p>
                    )}
                    {imp.dataPagamento && (
                      <p className="text-xs text-green-600 font-medium">Pago {formatarData(imp.dataPagamento)}</p>
                    )}
                    {imp.observacao && <p className="text-xs text-gray-400 truncate">{imp.observacao}</p>}
                  </div>
                </div>
              </div>

              {/* Ações */}
              <div className="flex gap-2 mt-3 pt-3 border-t border-gray-50">
                {imp.status === 'pendente' && (
                  <button onClick={() => handlePago(imp)}
                    className="btn-secondary btn-sm text-green-700 flex items-center gap-1 text-xs">
                    <CheckCircle size={12} /> Marcar Pago
                  </button>
                )}
                <button onClick={() => openEdit(imp)}
                  className="btn-ghost btn-sm flex items-center gap-1 text-xs text-gray-500">
                  <Edit3 size={12} /> Editar
                </button>
                <button onClick={() => handleDelete(imp.id)}
                  className="btn-ghost btn-sm text-red-400 hover:text-red-600 ml-auto">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Botão flutuante mobile */}
      <div className="h-6" />
    </div>
  );
}
