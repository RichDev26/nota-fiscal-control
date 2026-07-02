'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Briefcase, Loader2, Check, X, Edit3,
  CheckCircle2, PlusCircle, AlertCircle, Wallet, TrendingUp, TrendingDown,
} from 'lucide-react';
import { formatarMoeda } from '@/lib/validators';
import { GastoListItem } from '@/components/gastos/GastoListItem';
import { STATUS_SERVICO_LABELS, STATUS_SERVICO_COLORS } from '@/types';
import type { Servico } from '@/types';

export default function ServicoDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [servico, setServico] = useState<Servico | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [nome, setNome]       = useState('');
  const [valor, setValor]     = useState('');
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  const fetchServico = async () => {
    const r = await fetch(`/api/servicos/${params.id}`);
    if (r.ok) {
      const d: Servico = await r.json();
      setServico(d);
      setNome(d.nome);
      setValor(String(d.valorContratado));
    }
    setLoading(false);
  };

  useEffect(() => { fetchServico(); }, [params.id]);

  const handleSaveEdit = async () => {
    setSaving(true); setError('');
    try {
      const valorNum = parseFloat(valor.replace(/\./g, '').replace(',', '.'));
      const r = await fetch(`/api/servicos/${params.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, valorContratado: valorNum }),
      });
      if (!r.ok) { const d = await r.json(); setError(d.error || 'Erro ao salvar.'); return; }
      const updated: Servico = await r.json();
      setServico(updated);
      setEditing(false);
    } catch { setError('Erro de conexão.'); }
    finally { setSaving(false); }
  };

  const handleConcluir = async () => {
    if (!confirm('Marcar este serviço como concluído? Ele deixará de aceitar novos gastos, mas nenhum dado será alterado ou excluído.')) return;
    const r = await fetch(`/api/servicos/${params.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'concluido' }),
    });
    if (r.ok) { const updated: Servico = await r.json(); setServico(updated); }
  };

  const handleDeleteGasto = async (g: { id: string; descricao: string }) => {
    if (!confirm(`Excluir "${g.descricao}"?`)) return;
    const r = await fetch(`/api/gastos/${g.id}`, { method: 'DELETE' });
    if (r.ok) fetchServico(); // recalcula total/lucro automaticamente (fonte única de verdade)
  };

  if (loading)  return <div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-blue-400" /></div>;
  if (!servico) return <div className="p-8 text-center text-gray-400">Serviço não encontrado.</div>;

  const emAndamento = servico.status === 'em_andamento';

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
        <div className="card p-6 space-y-4">
          <h2 className="font-bold text-gray-900 text-lg">Editar Serviço</h2>
          <div>
            <label className="label">Nome do Serviço</label>
            <input type="text" className="input text-lg" value={nome} onChange={e => setNome(e.target.value)} />
          </div>
          <div>
            <label className="label">Valor Total do Serviço</label>
            <input type="text" inputMode="decimal" className="input text-xl font-bold" value={valor} onChange={e => setValor(e.target.value)} />
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={() => setEditing(false)} className="btn-secondary flex-1 justify-center py-3 rounded-2xl">
              <X size={16} /> Cancelar
            </button>
            <button onClick={handleSaveEdit} disabled={saving} className="btn-primary flex-1 justify-center py-3 rounded-2xl">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Salvar
            </button>
          </div>
        </div>
      ) : (
        <div className="card p-6">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-11 h-11 bg-purple-50 rounded-2xl flex items-center justify-center shrink-0">
              <Briefcase size={20} className="text-purple-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-bold text-gray-900 text-lg leading-tight">{servico.nome}</p>
                <span className={`badge ${STATUS_SERVICO_COLORS[servico.status]} text-[10px]`}>
                  {STATUS_SERVICO_LABELS[servico.status]}
                </span>
              </div>
            </div>
            {emAndamento && (
              <button onClick={() => setEditing(true)} className="btn-ghost p-1.5 text-gray-400 hover:text-gray-700 shrink-0">
                <Edit3 size={15} />
              </button>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Contratado</p>
              <p className="font-bold text-gray-900 text-sm">{formatarMoeda(servico.valorContratado)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Gasto ({servico.quantidadeGastos})</p>
              <p className="font-bold text-gray-900 text-sm">{formatarMoeda(servico.totalGastos)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Lucro</p>
              <p className={`font-bold text-sm flex items-center justify-center gap-1 ${servico.lucro >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                {servico.lucro >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                {formatarMoeda(servico.lucro)}
              </p>
            </div>
          </div>

          {emAndamento && (
            <button onClick={handleConcluir} className="btn-secondary w-full justify-center py-3 rounded-2xl mt-5 text-green-700 hover:bg-green-50 hover:border-green-200">
              <CheckCircle2 size={16} /> Marcar como Concluído
            </button>
          )}
        </div>
      )}

      {/* Gastos vinculados */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
            Gastos ({servico.gastos?.length ?? 0})
          </p>
          {emAndamento && (
            <Link href={`/gastos/novo?servico=${servico.id}`} className="text-sm text-blue-600 font-semibold hover:underline flex items-center gap-1">
              <PlusCircle size={14} /> Adicionar
            </Link>
          )}
        </div>

        {!servico.gastos || servico.gastos.length === 0 ? (
          <div className="card p-8 flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center">
              <Wallet size={22} className="text-gray-300" />
            </div>
            <p className="text-sm text-gray-400">Nenhum gasto lançado neste serviço ainda</p>
            {emAndamento && (
              <Link href={`/gastos/novo?servico=${servico.id}`} className="btn-primary btn-sm">
                <PlusCircle size={14} /> Adicionar Gasto
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {servico.gastos.map(g => <GastoListItem key={g.id} gasto={g} onDelete={handleDeleteGasto} />)}
          </div>
        )}
      </div>
    </div>
  );
}
