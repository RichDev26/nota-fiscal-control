'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { UserCheck, PlusCircle, Loader2, Calendar, ShieldCheck } from 'lucide-react';
import { formatarData } from '@/lib/validators';
import { STATUS_DOCUMENTO_COLORS, STATUS_DOCUMENTO_LABELS } from '@/types';
import type { Colaborador } from '@/types';

const CORES_STATUS_TEXTO: Record<string, string> = {
  em_dia:              'text-gray-700',
  proximo_vencimento:  'text-amber-600',
  vencido:             'text-red-600',
};

/** Card do colaborador — mesma filosofia visual de GastoListItem/ServicoCard. */
function ColaboradorCard({ c }: { c: Colaborador }) {
  const integracao = c.documentos.find(d => d.tipo === 'INTEGRACAO');
  const aso         = c.documentos.find(d => d.tipo === 'ASO');

  return (
    <Link href={`/integracao/${c.id}`}
      className="block p-4 rounded-2xl border border-gray-100 hover:border-gray-200 hover:bg-gray-50/40 transition-colors bg-white">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center shrink-0">
            <UserCheck size={15} className="text-blue-600" />
          </div>
          <p className="font-semibold text-gray-900 text-sm truncate">{c.nome}</p>
        </div>
        <span className={`badge ${STATUS_DOCUMENTO_COLORS[c.statusGeral]} text-[10px] shrink-0`}>
          {c.statusLabel}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="flex items-start gap-1.5">
          <Calendar size={13} className="text-gray-300 mt-0.5 shrink-0" />
          <div>
            <p className="text-gray-400">Integração</p>
            <p className={`font-semibold ${integracao ? CORES_STATUS_TEXTO[integracao.status] : 'text-gray-400'}`}>
              {integracao ? formatarData(integracao.dataFim) : '—'}
            </p>
          </div>
        </div>
        <div className="flex items-start gap-1.5">
          <ShieldCheck size={13} className="text-gray-300 mt-0.5 shrink-0" />
          <div>
            <p className="text-gray-400">ASO</p>
            <p className={`font-semibold ${aso ? CORES_STATUS_TEXTO[aso.status] : 'text-gray-400'}`}>
              {aso ? formatarData(aso.dataFim) : '—'}
            </p>
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function IntegracaoPage() {
  const [colaboradores, setColaboradores] = useState<Colaborador[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/colaboradores')
      .then(r => r.json())
      .then(d => setColaboradores(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }, []);

  const vencendoEmBreve = colaboradores.filter(c => c.statusGeral === 'proximo_vencimento').length;

  return (
    <div className="p-5 md:p-8 max-w-2xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between pt-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-50 rounded-2xl flex items-center justify-center">
            <UserCheck size={18} className="text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Controle de Integração</h1>
            <p className="text-sm text-gray-400 mt-0.5">Integração e ASO dos colaboradores</p>
          </div>
        </div>
        <Link href="/integracao/novo" className="btn-primary hidden sm:flex">
          <PlusCircle size={16} /> Adicionar Colaborador
        </Link>
      </div>

      {/* Resumo */}
      <div className="card p-5 flex items-center gap-4 bg-gradient-to-r from-blue-600 to-blue-700 border-0">
        <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center shrink-0">
          <UserCheck size={22} className="text-white" />
        </div>
        <div className="flex-1">
          <p className="text-blue-100 text-sm font-medium">Colaboradores em integração</p>
          <p className="text-white text-2xl font-bold">{colaboradores.length}</p>
        </div>
        {vencendoEmBreve > 0 && (
          <div className="text-right">
            <p className="text-white text-2xl font-bold">{vencendoEmBreve}</p>
            <p className="text-blue-100 text-xs font-medium">vencendo em breve</p>
          </div>
        )}
      </div>

      {/* Botão mobile */}
      <Link href="/integracao/novo" className="btn-primary w-full justify-center py-4 rounded-2xl text-base sm:hidden">
        <PlusCircle size={20} /> Adicionar Colaborador
      </Link>

      {/* Lista */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-blue-400" /></div>
      ) : colaboradores.length === 0 ? (
        <div className="card p-12 flex flex-col items-center gap-4 text-center">
          <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center">
            <UserCheck size={28} className="text-gray-300" />
          </div>
          <div>
            <p className="font-semibold text-gray-500">Nenhum colaborador cadastrado</p>
            <p className="text-sm text-gray-400 mt-1">Adicione o primeiro colaborador em integração</p>
          </div>
          <Link href="/integracao/novo" className="btn-primary"><PlusCircle size={15} /> Adicionar Colaborador</Link>
        </div>
      ) : (
        <div className="space-y-2">
          {colaboradores.map(c => <ColaboradorCard key={c.id} c={c} />)}
        </div>
      )}
    </div>
  );
}
