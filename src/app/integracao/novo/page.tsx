'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, Check, Loader2, AlertCircle, UserCheck } from 'lucide-react';
import { Shell } from '@/components/gastos/WizardShell';
import { AtalhosData } from '@/components/colaboradores/AtalhosData';

type Step = 1 | 2 | 3;

export default function NovoColaboradorPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);

  const [nome, setNome] = useState('');
  const [integracaoInicio, setIntegracaoInicio] = useState('');
  const [integracaoFim, setIntegracaoFim]       = useState('');
  const [asoInicio, setAsoInicio] = useState('');
  const [asoFim, setAsoFim]       = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const nomeOk       = nome.trim().length > 0;
  const integracaoOk = !!integracaoInicio && !!integracaoFim && integracaoFim >= integracaoInicio;
  const asoOk         = !!asoInicio && !!asoFim && asoFim >= asoInicio;

  const handleSave = async () => {
    if (!asoOk) return;
    setSaving(true); setError('');
    try {
      const r = await fetch('/api/colaboradores', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: nome.trim(), integracaoInicio, integracaoFim, asoInicio, asoFim }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Erro ao salvar.'); return; }
      router.push(`/integracao/${d.id}`);
    } catch { setError('Erro de conexão.'); }
    finally { setSaving(false); }
  };

  // ── Etapa 1 — Nome (obrigatório) ──────────────────────────────────────────────
  if (step === 1) {
    return (
      <Shell onBack={() => router.push('/integracao')}>
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 bg-blue-50 rounded-2xl flex items-center justify-center">
              <UserCheck size={18} className="text-blue-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Adicionar Colaborador</h1>
          </div>
          <p className="text-gray-400 text-sm">Etapa 1 de 3 · nome</p>
        </div>
        <div>
          <label className="label">Nome do Colaborador</label>
          <input
            type="text" className="input text-lg py-3" placeholder="Ex: João da Silva"
            value={nome} onChange={e => setNome(e.target.value)} autoFocus
          />
        </div>
        <button onClick={() => setStep(2)} disabled={!nomeOk}
          className="btn-primary w-full py-4 rounded-2xl text-base justify-center mt-6 disabled:opacity-50">
          Próximo <ChevronRight size={18} />
        </button>
      </Shell>
    );
  }

  // ── Etapa 2 — Período de Integração (obrigatório) ─────────────────────────────
  if (step === 2) {
    return (
      <Shell onBack={() => setStep(1)}>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 truncate">{nome}</h1>
          <p className="text-gray-400 text-sm">Etapa 2 de 3 · período de integração</p>
        </div>
        <div className="space-y-4">
          <div>
            <label className="label">Data de início da integração</label>
            <input type="date" className="input" value={integracaoInicio}
              onChange={e => setIntegracaoInicio(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="label">Data final da integração</label>
            <input type="date" className="input" value={integracaoFim}
              onChange={e => setIntegracaoFim(e.target.value)} />
            <AtalhosData dataInicio={integracaoInicio} onSet={setIntegracaoFim} />
          </div>
        </div>
        <button onClick={() => setStep(3)} disabled={!integracaoOk}
          className="btn-primary w-full py-4 rounded-2xl text-base justify-center mt-6 disabled:opacity-50">
          Próximo <ChevronRight size={18} />
        </button>
      </Shell>
    );
  }

  // ── Etapa 3 — ASO (obrigatório) + salvar ──────────────────────────────────────
  return (
    <Shell onBack={() => setStep(2)}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">ASO</h1>
        <p className="text-gray-400 text-sm">Etapa 3 de 3 · atestado de saúde ocupacional</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 text-red-700 rounded-xl p-3 text-sm mb-4">
          <AlertCircle size={14} />{error}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="label">Data de início do ASO</label>
          <input type="date" className="input" value={asoInicio}
            onChange={e => setAsoInicio(e.target.value)} autoFocus />
        </div>
        <div>
          <label className="label">Data final do ASO</label>
          <input type="date" className="input" value={asoFim} onChange={e => setAsoFim(e.target.value)} />
          <AtalhosData dataInicio={asoInicio} onSet={setAsoFim} />
        </div>
      </div>

      <button onClick={handleSave} disabled={saving || !asoOk}
        className="btn-primary w-full py-4 rounded-2xl text-base justify-center mt-6">
        {saving ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
        {saving ? 'Salvando...' : 'Adicionar Colaborador'}
      </button>
    </Shell>
  );
}
