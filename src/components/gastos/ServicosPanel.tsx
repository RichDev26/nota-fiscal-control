'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PlusCircle, Loader2, Briefcase } from 'lucide-react';
import { formatarMoeda } from '@/lib/validators';
import { STATUS_SERVICO_LABELS, STATUS_SERVICO_COLORS } from '@/types';
import type { Servico } from '@/types';

/**
 * Card de serviço — segue o mesmo DNA visual do card "Total no Período" da
 * tela principal de Gastos: hierarquia label-pequeno → valor-grande-em-negrito,
 * layout horizontal balanceado (info principal à esquerda, contador à direita),
 * bastante respiro. Não é o mesmo componente (aqui é um card claro, com nome e
 * status por item), mas reaproveita espaçamento, alinhamento e proporções.
 */
function ServicoCard({ s }: { s: Servico }) {
  const lucroPositivo = s.lucro >= 0;
  return (
    <Link href={`/gastos/servicos/${s.id}`}
      className="block p-4 rounded-2xl border border-gray-100 hover:border-gray-200 hover:bg-gray-50/40 transition-colors">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 bg-purple-50 rounded-lg flex items-center justify-center shrink-0">
            <Briefcase size={13} className="text-purple-500" />
          </div>
          <p className="font-semibold text-gray-900 text-sm truncate">{s.nome}</p>
        </div>
        <span className={`badge ${STATUS_SERVICO_COLORS[s.status]} text-[10px] shrink-0`}>
          {STATUS_SERVICO_LABELS[s.status]}
        </span>
      </div>

      <div className="flex items-end justify-between gap-3 mb-3">
        <div>
          <p className="text-xs text-gray-400 font-medium">Lucro atual</p>
          <p className={`text-xl font-bold ${lucroPositivo ? 'text-green-600' : 'text-red-500'}`}>
            {formatarMoeda(s.lucro)}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xl font-bold text-gray-900">{s.quantidadeGastos}</p>
          <p className="text-xs text-gray-400 font-medium">gasto{s.quantidadeGastos !== 1 ? 's' : ''}</p>
        </div>
      </div>

      <div className="h-px bg-gray-100 mb-3" />

      <div className="flex items-center justify-between text-xs">
        <div className="min-w-0">
          <span className="text-gray-400">Contratado </span>
          <span className="font-semibold text-gray-700">{formatarMoeda(s.valorContratado)}</span>
        </div>
        <div className="min-w-0 text-right">
          <span className="text-gray-400">Gasto </span>
          <span className="font-semibold text-gray-700">{formatarMoeda(s.totalGastos)}</span>
        </div>
      </div>
    </Link>
  );
}

/** Painel lateral "Serviços" da tela principal de Gastos. */
export function ServicosPanel() {
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/servicos')
      .then(r => r.json())
      .then(d => setServicos(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="card p-5 space-y-4 lg:sticky lg:top-6">
      <div className="flex items-center gap-2">
        <Briefcase size={16} className="text-purple-500" />
        <p className="font-bold text-gray-900">Serviços</p>
      </div>

      <Link href="/gastos/servicos/novo" className="btn-primary w-full justify-center py-2.5 rounded-xl text-sm">
        <PlusCircle size={15} /> Novo Serviço
      </Link>

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 size={20} className="animate-spin text-blue-400" /></div>
      ) : servicos.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">Nenhum serviço ainda</p>
      ) : (
        <div className="space-y-2">
          {servicos.map(s => <ServicoCard key={s.id} s={s} />)}
        </div>
      )}
    </div>
  );
}
