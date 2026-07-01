'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Wallet, Loader2, Trash2, Edit3, Check, X,
  FileText, Tag, Calendar, CreditCard, Building2, AlertCircle,
} from 'lucide-react';
import { formatarMoeda, formatarData } from '@/lib/validators';
import { CATEGORIAS_GASTO, FORMAS_PAGAMENTO } from '@/types';
import type { Gasto } from '@/types';

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="w-8 h-8 bg-gray-50 rounded-lg flex items-center justify-center shrink-0">
        <Icon size={15} className="text-gray-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-gray-400 font-medium">{label}</p>
        <p className="text-sm font-semibold text-gray-800 truncate">{value}</p>
      </div>
    </div>
  );
}

export default function GastoDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [gasto, setGasto]     = useState<Gasto | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  // form (modo edição)
  const [f, setF] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const r = await fetch(`/api/gastos/${params.id}`);
      if (r.ok) {
        const d: Gasto = await r.json();
        setGasto(d);
        setF({
          descricao: d.descricao, valor: String(d.valor),
          data: d.data ? new Date(d.data).toISOString().split('T')[0] : '',
          categoria: d.categoria || '', fornecedor: d.fornecedor || '',
          formaPagamento: d.formaPagamento || '', observacoes: d.observacoes || '',
        });
      }
      setLoading(false);
    })();
  }, [params.id]);

  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      const valorNum = parseFloat(f.valor.replace(/\./g, '').replace(',', '.'));
      const r = await fetch(`/api/gastos/${params.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, valor: valorNum }),
      });
      if (!r.ok) { const d = await r.json(); setError(d.error || 'Erro ao salvar.'); return; }
      const updated = await r.json();
      setGasto(updated);
      setEditing(false);
    } catch { setError('Erro de conexão.'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!confirm('Excluir este gasto? Esta ação não pode ser desfeita.')) return;
    const r = await fetch(`/api/gastos/${params.id}`, { method: 'DELETE' });
    if (r.ok) router.push('/gastos');
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-blue-400" /></div>;
  if (!gasto)  return <div className="p-8 text-center text-gray-400">Gasto não encontrado.</div>;

  return (
    <div className="p-5 md:p-8 max-w-lg mx-auto space-y-5">
      <button onClick={() => router.push('/gastos')} className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 font-semibold">
        <ArrowLeft size={14} /> Gastos
      </button>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 text-red-700 rounded-xl p-3 text-sm">
          <AlertCircle size={14} />{error}
        </div>
      )}

      {editing ? (
        /* ── Edição ── */
        <div className="card p-6 space-y-4">
          <h2 className="font-bold text-gray-900 text-lg">Editar Gasto</h2>
          <div>
            <label className="label">Valor *</label>
            <input type="text" inputMode="decimal" className="input text-xl font-bold" value={f.valor} onChange={e => set('valor', e.target.value)} />
          </div>
          <div>
            <label className="label">Descrição *</label>
            <input type="text" className="input" value={f.descricao} onChange={e => set('descricao', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Data</label>
              <input type="date" className="input" value={f.data} onChange={e => set('data', e.target.value)} />
            </div>
            <div>
              <label className="label">Categoria</label>
              <select className="input" value={f.categoria} onChange={e => set('categoria', e.target.value)}>
                <option value="">—</option>
                {CATEGORIAS_GASTO.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Fornecedor</label>
              <input type="text" className="input" value={f.fornecedor} onChange={e => set('fornecedor', e.target.value)} />
            </div>
            <div>
              <label className="label">Pagamento</label>
              <select className="input" value={f.formaPagamento} onChange={e => set('formaPagamento', e.target.value)}>
                <option value="">—</option>
                {FORMAS_PAGAMENTO.map(x => <option key={x} value={x}>{x}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Observações</label>
            <input type="text" className="input" value={f.observacoes} onChange={e => set('observacoes', e.target.value)} />
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={() => setEditing(false)} className="btn-secondary flex-1 justify-center py-3 rounded-2xl">
              <X size={16} /> Cancelar
            </button>
            <button onClick={handleSave} disabled={saving} className="btn-primary flex-1 justify-center py-3 rounded-2xl">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Salvar
            </button>
          </div>
        </div>
      ) : (
        /* ── Visualização ── */
        <>
          <div className="card p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-11 h-11 bg-purple-50 rounded-2xl flex items-center justify-center shrink-0">
                <Wallet size={20} className="text-purple-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-gray-900 text-lg leading-tight">{gasto.descricao}</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{formatarMoeda(gasto.valor)}</p>
              </div>
            </div>
            <div className="divide-y divide-gray-50">
              <InfoRow icon={Calendar} label="Data" value={formatarData(gasto.data)} />
              {gasto.categoria     && <InfoRow icon={Tag}        label="Categoria"  value={gasto.categoria} />}
              {gasto.fornecedor    && <InfoRow icon={Building2}  label="Fornecedor" value={gasto.fornecedor} />}
              {gasto.formaPagamento && <InfoRow icon={CreditCard} label="Pagamento"  value={gasto.formaPagamento} />}
              {gasto.observacoes   && <InfoRow icon={FileText}   label="Observações" value={gasto.observacoes} />}
            </div>
          </div>

          {/* Anexos */}
          {gasto.anexos && gasto.anexos.length > 0 && (
            <div className="card p-5">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Anexos ({gasto.anexos.length})</p>
              <div className="space-y-2">
                {gasto.anexos.map((a, i) => (
                  <a key={i} href={a.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5 hover:bg-gray-100 transition-colors">
                    <FileText size={16} className="text-blue-500 shrink-0" />
                    <span className="text-sm text-gray-700 truncate flex-1">{a.nome}</span>
                    <span className="text-xs text-blue-600 font-semibold">Abrir</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Ações */}
          <div className="flex gap-2">
            <button onClick={() => setEditing(true)} className="btn-secondary flex-1 justify-center py-3 rounded-2xl">
              <Edit3 size={16} /> Editar
            </button>
            <button onClick={handleDelete} className="btn-secondary px-4 py-3 rounded-2xl text-red-500 hover:bg-red-50 hover:border-red-200">
              <Trash2 size={16} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
