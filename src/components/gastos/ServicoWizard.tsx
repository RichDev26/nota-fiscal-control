'use client';

import { useState } from 'react';
import { ChevronRight, Loader2, Check, AlertCircle } from 'lucide-react';
import { Shell } from './WizardShell';
import { criarServico } from '@/lib/servicos-client';
import type { Servico } from '@/types';

/**
 * Wizard de criação de Serviço em 2 etapas (nome → valor). Componente único,
 * reutilizado tanto pela página cheia (/gastos/servicos/novo) quanto pela
 * criação inline dentro do fluxo de Novo Gasto — mesma lógica, mesmo visual.
 */
export function ServicoWizard({ onCreated, onCancel }: { onCreated: (s: Servico) => void; onCancel: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [nome, setNome] = useState('');
  const [valor, setValor] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const valorNum = parseFloat(valor.replace(/\./g, '').replace(',', '.'));
  const nomeOk  = nome.trim().length > 0;
  const valorOk = isFinite(valorNum) && valorNum > 0;

  const handleCreate = async () => {
    if (!valorOk) return;
    setSaving(true); setError('');
    const res = await criarServico(nome.trim(), valorNum);
    setSaving(false);
    if (!res.ok) { setError(res.error); return; }
    onCreated(res.servico);
  };

  if (step === 1) {
    return (
      <Shell onBack={onCancel}>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Novo Serviço</h1>
          <p className="text-gray-400 text-sm">Etapa 1 de 2 · nome</p>
        </div>
        <div>
          <label className="label">Nome do Serviço</label>
          <input
            type="text" className="input text-lg py-3" placeholder="Ex: Instalação Tanques Seara"
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

  return (
    <Shell onBack={() => setStep(1)}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 truncate">{nome}</h1>
        <p className="text-gray-400 text-sm">Etapa 2 de 2 · valor total</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 text-red-700 rounded-xl p-3 text-sm mb-4">
          <AlertCircle size={14} />{error}
        </div>
      )}

      <div>
        <label className="label">Valor Total do Serviço</label>
        <input
          type="text" inputMode="decimal" className="input text-2xl font-bold text-center py-3" placeholder="0,00"
          value={valor} onChange={e => setValor(e.target.value)} autoFocus
        />
      </div>

      <button onClick={handleCreate} disabled={saving || !valorOk}
        className="btn-primary w-full py-4 rounded-2xl text-base justify-center mt-6">
        {saving ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
        {saving ? 'Criando...' : 'Adicionar'}
      </button>
    </Shell>
  );
}
