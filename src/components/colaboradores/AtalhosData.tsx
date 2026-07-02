'use client';

import { adicionarMeses } from '@/lib/colaboradores/datas';

/**
 * Atalhos +6 meses / +1 ano / +2 anos — calculam a data final a partir da data
 * inicial. Usado tanto no wizard de criação (Integração e ASO) quanto na edição.
 */
export function AtalhosData({ dataInicio, onSet }: { dataInicio: string; onSet: (iso: string) => void }) {
  if (!dataInicio) return null;
  return (
    <div className="flex gap-2 mt-2">
      {([['+6 meses', 6], ['+1 ano', 12], ['+2 anos', 24]] as const).map(([label, meses]) => (
        <button
          key={label} type="button"
          onClick={() => onSet(adicionarMeses(dataInicio, meses))}
          className="flex-1 px-2 py-2 rounded-xl border border-gray-200 text-xs font-semibold text-gray-600 hover:border-blue-300 hover:bg-blue-50/50 hover:text-blue-700 transition-colors"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
