'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, UserCheck, Loader2, Check, X, Edit3, Trash2,
  AlertCircle, Calendar, ShieldCheck,
} from 'lucide-react';
import { formatarData } from '@/lib/validators';
import { AtalhosData } from '@/components/colaboradores/AtalhosData';
import { STATUS_DOCUMENTO_LABELS, STATUS_DOCUMENTO_COLORS } from '@/types';
import type { Colaborador } from '@/types';

function DocumentoInfo({ icone: Icon, titulo, doc }: {
  icone: React.ElementType; titulo: string;
  doc?: { dataInicio: string; dataFim: string; status: string; diasRestantes: number };
}) {
  if (!doc) return null;
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="w-9 h-9 bg-gray-50 rounded-xl flex items-center justify-center shrink-0">
        <Icon size={16} className="text-gray-500" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <p className="font-semibold text-gray-900 text-sm">{titulo}</p>
          <span className={`badge ${STATUS_DOCUMENTO_COLORS[doc.status]} text-[10px]`}>
            {STATUS_DOCUMENTO_LABELS[doc.status]}
          </span>
        </div>
        <p className="text-xs text-gray-400">
          {formatarData(doc.dataInicio)} até <strong className="text-gray-600">{formatarData(doc.dataFim)}</strong>
          {doc.diasRestantes >= 0
            ? ` · faltam ${doc.diasRestantes} dia${doc.diasRestantes !== 1 ? 's' : ''}`
            : ` · venceu há ${Math.abs(doc.diasRestantes)} dia${Math.abs(doc.diasRestantes) !== 1 ? 's' : ''}`}
        </p>
      </div>
    </div>
  );
}

export default function ColaboradorDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [colaborador, setColaborador] = useState<Colaborador | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  const [nome, setNome] = useState('');
  const [integracaoInicio, setIntegracaoInicio] = useState('');
  const [integracaoFim, setIntegracaoFim]       = useState('');
  const [asoInicio, setAsoInicio] = useState('');
  const [asoFim, setAsoFim]       = useState('');

  const fetchColaborador = async () => {
    const r = await fetch(`/api/colaboradores/${params.id}`);
    if (r.ok) {
      const d: Colaborador = await r.json();
      setColaborador(d);
      setNome(d.nome);
      const integracao = d.documentos.find(doc => doc.tipo === 'INTEGRACAO');
      const aso         = d.documentos.find(doc => doc.tipo === 'ASO');
      setIntegracaoInicio(integracao ? integracao.dataInicio.split('T')[0] : '');
      setIntegracaoFim(integracao ? integracao.dataFim.split('T')[0] : '');
      setAsoInicio(aso ? aso.dataInicio.split('T')[0] : '');
      setAsoFim(aso ? aso.dataFim.split('T')[0] : '');
    }
    setLoading(false);
  };

  useEffect(() => { fetchColaborador(); }, [params.id]);

  const integracaoOk = !!integracaoInicio && !!integracaoFim && integracaoFim >= integracaoInicio;
  const asoOk         = !!asoInicio && !!asoFim && asoFim >= asoInicio;

  const handleSaveEdit = async () => {
    setSaving(true); setError('');
    try {
      const r = await fetch(`/api/colaboradores/${params.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, integracaoInicio, integracaoFim, asoInicio, asoFim }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Erro ao salvar.'); return; }
      setColaborador(d);
      setEditing(false);
    } catch { setError('Erro de conexão.'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!confirm(`Excluir "${colaborador?.nome}"? Esta ação não pode ser desfeita.`)) return;
    const r = await fetch(`/api/colaboradores/${params.id}`, { method: 'DELETE' });
    if (r.ok) router.push('/integracao');
  };

  if (loading)        return <div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-blue-400" /></div>;
  if (!colaborador)   return <div className="p-8 text-center text-gray-400">Colaborador não encontrado.</div>;

  const integracao = colaborador.documentos.find(d => d.tipo === 'INTEGRACAO');
  const aso         = colaborador.documentos.find(d => d.tipo === 'ASO');

  return (
    <div className="p-5 md:p-8 max-w-lg mx-auto space-y-5">
      <button onClick={() => router.push('/integracao')} className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 font-semibold">
        <ArrowLeft size={14} /> Integração
      </button>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 text-red-700 rounded-xl p-3 text-sm">
          <AlertCircle size={14} />{error}
        </div>
      )}

      {editing ? (
        <div className="card p-6 space-y-4">
          <h2 className="font-bold text-gray-900 text-lg">Editar Colaborador</h2>
          <div>
            <label className="label">Nome do Colaborador</label>
            <input type="text" className="input text-lg" value={nome} onChange={e => setNome(e.target.value)} />
          </div>

          <div className="pt-2 border-t border-gray-50">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">Integração</p>
            <div className="space-y-3">
              <div>
                <label className="label">Data de início</label>
                <input type="date" className="input" value={integracaoInicio} onChange={e => setIntegracaoInicio(e.target.value)} />
              </div>
              <div>
                <label className="label">Data final</label>
                <input type="date" className="input" value={integracaoFim} onChange={e => setIntegracaoFim(e.target.value)} />
                <AtalhosData dataInicio={integracaoInicio} onSet={setIntegracaoFim} />
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-gray-50">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">ASO</p>
            <div className="space-y-3">
              <div>
                <label className="label">Data de início</label>
                <input type="date" className="input" value={asoInicio} onChange={e => setAsoInicio(e.target.value)} />
              </div>
              <div>
                <label className="label">Data final</label>
                <input type="date" className="input" value={asoFim} onChange={e => setAsoFim(e.target.value)} />
                <AtalhosData dataInicio={asoInicio} onSet={setAsoFim} />
              </div>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button onClick={() => setEditing(false)} className="btn-secondary flex-1 justify-center py-3 rounded-2xl">
              <X size={16} /> Cancelar
            </button>
            <button onClick={handleSaveEdit} disabled={saving || !integracaoOk || !asoOk} className="btn-primary flex-1 justify-center py-3 rounded-2xl">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Salvar
            </button>
          </div>
        </div>
      ) : (
        <div className="card p-6">
          <div className="flex items-start gap-3 mb-2">
            <div className="w-11 h-11 bg-blue-50 rounded-2xl flex items-center justify-center shrink-0">
              <UserCheck size={20} className="text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-bold text-gray-900 text-lg leading-tight">{colaborador.nome}</p>
                <span className={`badge ${STATUS_DOCUMENTO_COLORS[colaborador.statusGeral]} text-[10px]`}>
                  {colaborador.statusLabel}
                </span>
              </div>
            </div>
            <button onClick={() => setEditing(true)} className="btn-ghost p-1.5 text-gray-400 hover:text-gray-700 shrink-0">
              <Edit3 size={15} />
            </button>
          </div>

          <div className="divide-y divide-gray-50">
            <DocumentoInfo icone={Calendar}     titulo="Integração" doc={integracao} />
            <DocumentoInfo icone={ShieldCheck}  titulo="ASO"        doc={aso} />
          </div>
        </div>
      )}

      {!editing && (
        <button onClick={handleDelete} className="btn-secondary w-full justify-center py-3 rounded-2xl text-red-500 hover:bg-red-50 hover:border-red-200">
          <Trash2 size={16} /> Excluir Colaborador
        </button>
      )}
    </div>
  );
}
