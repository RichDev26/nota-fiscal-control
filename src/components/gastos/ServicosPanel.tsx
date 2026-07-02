'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PlusCircle, Loader2, Briefcase } from 'lucide-react';
import { formatarMoeda } from '@/lib/validators';
import { STATUS_SERVICO_LABELS, STATUS_SERVICO_COLORS } from '@/types';
import type { Servico } from '@/types';

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
          {servicos.map(s => (
            <Link key={s.id} href={`/gastos/servicos/${s.id}`}
              className="block p-3 rounded-xl border border-gray-100 hover:border-gray-200 hover:bg-gray-50/50 transition-colors">
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="font-semibold text-gray-900 text-sm truncate">{s.nome}</p>
                <span className={`badge ${STATUS_SERVICO_COLORS[s.status]} text-[10px] shrink-0`}>
                  {STATUS_SERVICO_LABELS[s.status]}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">{s.quantidadeGastos} gasto{s.quantidadeGastos !== 1 ? 's' : ''}</span>
                <span className={`font-bold ${s.lucro >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {formatarMoeda(s.lucro)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
