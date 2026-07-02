'use client';

import { useState } from 'react';
import { ChevronRight, Loader2, Check, AlertCircle } from 'lucide-react';
import { Shell } from './WizardShell';
import { criarServico } from '@/lib/servicos-client';
import type { Servico } from '@/types';

type Step = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Wizard de criação de Serviço em 6 etapas (nome → valor → gestor → comprador →
 * OF → orçamento). Só nome e valor são obrigatórios — as demais podem ser
 * puladas a qualquer momento ("Pular e adicionar") sem perder o que já foi
 * digitado. Componente único, reutilizado tanto pela página cheia
 * (/gastos/servicos/novo) quanto pela criação inline dentro de Novo Gasto.
 */
export function ServicoWizard({ onCreated, onCancel }: { onCreated: (s: Servico) => void; onCancel: () => void }) {
  const [step, setStep] = useState<Step>(1);
  const [nome, setNome]           = useState('');
  const [valor, setValor]         = useState('');
  const [gestor, setGestor]       = useState('');
  const [comprador, setComprador] = useState('');
  const [numeroOF, setNumeroOF]   = useState('');
  const [numeroOrcamento, setNumeroOrcamento] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const valorNum = parseFloat(valor.replace(/\./g, '').replace(',', '.'));
  const nomeOk  = nome.trim().length > 0;
  const valorOk = isFinite(valorNum) && valorNum > 0;

  const handleCreate = async () => {
    if (!valorOk) return;
    setSaving(true); setError('');
    const res = await criarServico({
      nome: nome.trim(), valorContratado: valorNum,
      gestor: gestor.trim(), comprador: comprador.trim(),
      numeroOF: numeroOF.trim(), numeroOrcamento: numeroOrcamento.trim(),
    });
    setSaving(false);
    if (!res.ok) { setError(res.error); return; }
    onCreated(res.servico);
  };

  // ── Etapa 1 — Nome (obrigatório) ──────────────────────────────────────────────
  if (step === 1) {
    return (
      <Shell onBack={onCancel}>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Novo Serviço</h1>
          <p className="text-gray-400 text-sm">Etapa 1 de 6 · nome</p>
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

  // ── Etapa 2 — Valor Total (obrigatório) ───────────────────────────────────────
  if (step === 2) {
    return (
      <Shell onBack={() => setStep(1)}>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 truncate">{nome}</h1>
          <p className="text-gray-400 text-sm">Etapa 2 de 6 · valor total</p>
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

        <button onClick={() => setStep(3)} disabled={!valorOk}
          className="btn-primary w-full py-4 rounded-2xl text-base justify-center mt-6 disabled:opacity-50">
          Próximo <ChevronRight size={18} />
        </button>
      </Shell>
    );
  }

  // ── Etapas 3-6 — opcionais (Gestor, Comprador, OF, Orçamento) ─────────────────
  const etapasOpcionais: { titulo: string; label: string; placeholder: string; value: string; set: (v: string) => void }[] = [
    { titulo: 'Gestor',    label: 'Gestor',                       placeholder: 'Nome do gestor responsável', value: gestor,    set: setGestor },
    { titulo: 'Comprador', label: 'Comprador',                    placeholder: 'Nome do comprador',          value: comprador, set: setComprador },
    { titulo: 'Ordem de Fornecimento', label: 'Número da OF',     placeholder: 'Ex: 6866682',                value: numeroOF,  set: setNumeroOF },
    { titulo: 'Orçamento', label: 'Número do Orçamento',          placeholder: 'Ex: 2026-0123',               value: numeroOrcamento, set: setNumeroOrcamento },
  ];
  const idx = step - 3; // 0..3
  const atual = etapasOpcionais[idx];
  const ultima = step === 6;

  return (
    <Shell onBack={() => setStep((step - 1) as Step)}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 truncate">{atual.titulo}</h1>
        <p className="text-gray-400 text-sm">Etapa {step} de 6 · opcional</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 text-red-700 rounded-xl p-3 text-sm mb-4">
          <AlertCircle size={14} />{error}
        </div>
      )}

      <div>
        <label className="label">{atual.label}</label>
        <input
          type="text" className="input text-lg py-3" placeholder={atual.placeholder}
          value={atual.value} onChange={e => atual.set(e.target.value)} autoFocus
        />
      </div>

      <button
        onClick={() => ultima ? handleCreate() : setStep((step + 1) as Step)}
        disabled={saving}
        className="btn-primary w-full py-4 rounded-2xl text-base justify-center mt-6"
      >
        {saving ? <Loader2 size={18} className="animate-spin" /> : ultima ? <Check size={18} /> : <ChevronRight size={18} />}
        {saving ? 'Criando...' : ultima ? 'Adicionar Serviço' : 'Próximo'}
      </button>

      {!ultima && (
        <button onClick={handleCreate} disabled={saving}
          className="w-full text-center text-sm text-gray-400 hover:text-gray-700 mt-3 transition-colors">
          Pular e adicionar serviço
        </button>
      )}
    </Shell>
  );
}
