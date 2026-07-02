'use client';

import { ArrowLeft } from 'lucide-react';

// ─── Wrapper centrado (padrão de nova nota / novo gasto) ───────────────────────
// Extraído de gastos/novo para ser reutilizado também pelo wizard de Serviço.
export function Shell({ children, onBack }: { children: React.ReactNode; onBack?: () => void }) {
  return (
    <div className="min-h-full flex flex-col items-center justify-center p-5 py-10">
      {onBack && (
        <div className="w-full max-w-md mb-4">
          <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 font-semibold transition-colors">
            <ArrowLeft size={14} /> Voltar
          </button>
        </div>
      )}
      <div className="w-full max-w-md animate-enter">{children}</div>
    </div>
  );
}
