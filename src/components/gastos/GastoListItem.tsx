'use client';

import Link from 'next/link';
import { Eye, Trash2, Tag } from 'lucide-react';
import { formatarMoeda, formatarData } from '@/lib/validators';
import type { Gasto } from '@/types';

/**
 * Card de gasto — extraído de /gastos para ser reutilizado também na lista de
 * gastos vinculados dentro do detalhe de um Serviço. Mesma aparência, mesmas ações.
 */
export function GastoListItem({ gasto: g, onDelete }: { gasto: Gasto; onDelete?: (g: Gasto) => void }) {
  return (
    <div className="card overflow-hidden">
      <Link href={`/gastos/${g.id}`} className="block p-4 hover:bg-gray-50/50 transition-colors">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-900 truncate text-[15px]">{g.descricao}</p>
            <p className="text-sm text-gray-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
              <span>{formatarData(g.data)}</span>
              {g.categoria && <><span>·</span><span className="flex items-center gap-1"><Tag size={11} />{g.categoria}</span></>}
              {g.fornecedor && <><span>·</span><span className="truncate">{g.fornecedor}</span></>}
            </p>
          </div>
          <p className="font-bold text-gray-900 text-[15px] shrink-0">{formatarMoeda(g.valor)}</p>
        </div>
      </Link>
      <div className="flex items-center gap-2 px-4 pb-3 pt-0">
        <Link href={`/gastos/${g.id}`} className="btn-ghost btn-sm py-1.5 flex items-center gap-1 text-gray-500">
          <Eye size={13} /> Ver
        </Link>
        {g.anexos && g.anexos.length > 0 && (
          <span className="text-xs text-gray-400">{g.anexos.length} anexo{g.anexos.length !== 1 ? 's' : ''}</span>
        )}
        {onDelete && (
          <button onClick={() => onDelete(g)} className="btn-ghost btn-sm py-1.5 text-red-400 hover:text-red-600 ml-auto">
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
