'use client';

import { useEffect, useState } from 'react';
import { PlusCircle, Receipt, Save, X, Edit3, Trash2, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { formatarMoeda, formatarData } from '@/lib/validators';
import { STATUS_IMPOSTO_LABELS, STATUS_IMPOSTO_COLORS } from '@/types';
import type { Imposto } from '@/types';

const IMPOSTOS_TIPOS = ['ISS', 'IRPJ', 'CSLL', 'PIS', 'COFINS', 'INSS', 'IRRF', 'Simples Nacional', 'Outros'];
const STATUS_OPTIONS = ['pendente', 'pago', 'vencido', 'cancelado'];

const emptyForm = () => ({
  mesReferencia: '',
  dataVencimento: '',
  dataPagamento: '',
  imposto: '',
  valor: '',
  status: 'pendente',
  observacao: '',
  notaFiscalId: '',
});

export default function ImpostosPage() {
  const [impostos, setImpostos] = useState<Imposto[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterMes, setFilterMes] = useState('');

  const fetchImpostos = async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ status: filterStatus, mesReferencia: filterMes });
      const r = await fetch(`/api/impostos?${p}`);
      const d = await r.json();
      setImpostos(Array.isArray(d) ? d : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchImpostos(); }, [filterStatus, filterMes]);

  const startNew = () => { setForm(emptyForm()); setEditId(null); setShowForm(true); setError(''); setSuccess(''); };
  const startEdit = (imp: Imposto) => {
    setForm({
      mesReferencia: imp.mesReferencia || '',
      dataVencimento: imp.dataVencimento ? new Date(imp.dataVencimento).toISOString().split('T')[0] : '',
      dataPagamento: imp.dataPagamento ? new Date(imp.dataPagamento).toISOString().split('T')[0] : '',
      imposto: imp.imposto || '',
      valor: imp.valor != null ? String(imp.valor) : '',
      status: imp.status,
      observacao: imp.observacao || '',
      notaFiscalId: imp.notaFiscalId || '',
    });
    setEditId(imp.id);
    setShowForm(true);
    setError('');
  };

  const handleSubmit = async () => {
    if (!form.imposto || !form.valor) { setError('Imposto e valor são obrigatórios.'); return; }
    setSaving(true); setError(''); setSuccess('');
    try {
      const payload = { ...form, valor: parseFloat(form.valor) || 0 };
      const url = editId ? `/api/impostos/${editId}` : '/api/impostos';
      const method = editId ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Erro.'); return; }
      setSuccess(editId ? 'Atualizado!' : 'Criado!');
      setShowForm(false);
      setEditId(null);
      fetchImpostos();
    } catch {
      setError('Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este imposto?')) return;
    await fetch(`/api/impostos/${id}`, { method: 'DELETE' });
    fetchImpostos();
  };

  const handlePago = async (imp: Imposto) => {
    await fetch(`/api/impostos/${imp.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...imp, status: 'pago', dataPagamento: new Date().toISOString().split('T')[0] }),
    });
    fetchImpostos();
  };

  const f = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  // Totais
  const totalPendente = impostos.filter(i => i.status === 'pendente').reduce((s, i) => s + (i.valor || 0), 0);
  const totalPago = impostos.filter(i => i.status === 'pago').reduce((s, i) => s + (i.valor || 0), 0);
  const totalVencido = impostos.filter(i => i.status === 'vencido').reduce((s, i) => s + (i.valor || 0), 0);

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Impostos e Encargos</h1>
          <p className="text-sm text-gray-500 mt-0.5">Controle de tributos vinculados às notas fiscais</p>
        </div>
        <button onClick={startNew} className="btn-primary"><PlusCircle size={16} /> Novo Imposto</button>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-4">
          <p className="text-xs text-yellow-600 font-semibold uppercase">Pendente</p>
          <p className="text-xl font-bold text-yellow-700 mt-1">{formatarMoeda(totalPendente)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-green-600 font-semibold uppercase">Pago</p>
          <p className="text-xl font-bold text-green-700 mt-1">{formatarMoeda(totalPago)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-red-600 font-semibold uppercase">Vencido</p>
          <p className="text-xl font-bold text-red-700 mt-1">{formatarMoeda(totalVencido)}</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="card p-4 flex gap-3">
        <select className="input w-48" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">Todos os status</option>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_IMPOSTO_LABELS[s]}</option>)}
        </select>
        <input type="month" className="input w-48" value={filterMes} onChange={e => setFilterMes(e.target.value)} title="Mês de referência" />
        {(filterStatus || filterMes) && (
          <button className="btn-ghost btn-sm text-red-500" onClick={() => { setFilterStatus(''); setFilterMes(''); }}>Limpar</button>
        )}
      </div>

      {/* Alertas */}
      {error && <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm"><AlertCircle size={15} />{error}</div>}
      {success && <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 rounded-lg p-3 text-sm"><CheckCircle size={15} />{success}</div>}

      {/* Formulário */}
      {showForm && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-gray-800">{editId ? 'Editar Imposto' : 'Novo Imposto'}</h2>
            <button className="btn-ghost p-1.5" onClick={() => { setShowForm(false); setEditId(null); }}><X size={16} /></button>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="label">Imposto *</label>
              <select className="input" value={form.imposto} onChange={e => f('imposto', e.target.value)}>
                <option value="">Selecione...</option>
                {IMPOSTOS_TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Valor (R$) *</label>
              <input type="number" step="0.01" className="input" value={form.valor} onChange={e => f('valor', e.target.value)} />
            </div>
            <div>
              <label className="label">Mês de Referência</label>
              <input type="month" className="input" value={form.mesReferencia} onChange={e => f('mesReferencia', e.target.value)} />
            </div>
            <div>
              <label className="label">Data de Vencimento</label>
              <input type="date" className="input" value={form.dataVencimento} onChange={e => f('dataVencimento', e.target.value)} />
            </div>
            <div>
              <label className="label">Data de Pagamento</label>
              <input type="date" className="input" value={form.dataPagamento} onChange={e => f('dataPagamento', e.target.value)} />
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input" value={form.status} onChange={e => f('status', e.target.value)}>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_IMPOSTO_LABELS[s]}</option>)}
              </select>
            </div>
            <div className="lg:col-span-3">
              <label className="label">Observação</label>
              <input type="text" className="input" value={form.observacao} onChange={e => f('observacao', e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button className="btn-secondary" onClick={() => { setShowForm(false); setEditId(null); }}>Cancelar</button>
            <button className="btn-primary" onClick={handleSubmit} disabled={saving}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {editId ? 'Atualizar' : 'Salvar'}
            </button>
          </div>
        </div>
      )}

      {/* Tabela */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
          </div>
        ) : impostos.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-gray-400">
            <Receipt size={40} className="mb-3 opacity-30" />
            <p className="font-medium">Nenhum imposto cadastrado</p>
            <button onClick={startNew} className="btn-primary mt-4"><PlusCircle size={14} /> Novo Imposto</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-auto w-full">
              <thead>
                <tr>
                  <th>Imposto</th><th>Mês Ref.</th><th>Vencimento</th><th>Pagamento</th>
                  <th className="text-right">Valor</th><th>Status</th><th>NF Vinculada</th><th>Observação</th><th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {impostos.map(imp => (
                  <tr key={imp.id}>
                    <td className="font-semibold text-gray-800">{imp.imposto}</td>
                    <td className="text-gray-600">{imp.mesReferencia || '—'}</td>
                    <td className={`${!imp.dataPagamento && imp.dataVencimento && new Date(imp.dataVencimento) < new Date() ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>
                      {formatarData(imp.dataVencimento)}
                    </td>
                    <td className="text-gray-600">{formatarData(imp.dataPagamento)}</td>
                    <td className="text-right font-semibold text-gray-900">{formatarMoeda(imp.valor)}</td>
                    <td>
                      <span className={`badge ${STATUS_IMPOSTO_COLORS[imp.status] || 'bg-gray-100'}`}>
                        {STATUS_IMPOSTO_LABELS[imp.status] || imp.status}
                      </span>
                    </td>
                    <td className="text-xs text-gray-500">
                      {imp.notaFiscal ? (imp.notaFiscal.nomeOrganizador || `NF ${imp.notaFiscal.numeroNf}`) : '—'}
                    </td>
                    <td className="text-gray-500 text-xs max-w-[120px] truncate">{imp.observacao || '—'}</td>
                    <td>
                      <div className="flex gap-1">
                        {imp.status !== 'pago' && (
                          <button onClick={() => handlePago(imp)} className="btn-ghost btn-sm p-1.5 text-green-600" title="Marcar como pago">
                            <CheckCircle size={14} />
                          </button>
                        )}
                        <button onClick={() => startEdit(imp)} className="btn-ghost btn-sm p-1.5" title="Editar">
                          <Edit3 size={14} />
                        </button>
                        <button onClick={() => handleDelete(imp.id)} className="btn-ghost btn-sm p-1.5 text-red-400 hover:text-red-600" title="Excluir">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50">
                  <td colSpan={4} className="px-3 py-2 font-bold text-sm text-gray-700">TOTAL GERAL</td>
                  <td className="text-right px-3 py-2 font-bold text-gray-900">{formatarMoeda(impostos.reduce((s, i) => s + (i.valor || 0), 0))}</td>
                  <td colSpan={4} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
