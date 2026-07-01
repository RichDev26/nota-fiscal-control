'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  BarChart2, Printer, Loader2, AlertCircle, TrendingUp, Wallet, ArrowLeft,
} from 'lucide-react';
import { formatarMoeda, formatarData } from '@/lib/validators';
import type { Gasto } from '@/types';

export default function GastosRelatoriosPage() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');

  const [dataInicio, setDataInicio] = useState(`${y}-${m}-01`);
  const [dataFim, setDataFim]       = useState(`${y}-${m}-${new Date(y, now.getMonth() + 1, 0).getDate()}`);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [gastos, setGastos]         = useState<Gasto[]>([]);
  const [gerado, setGerado]         = useState(false);

  const handleGerar = async () => {
    setLoading(true); setError(''); setGastos([]);
    try {
      const p = new URLSearchParams({ dataInicio, dataFim, busca: '' });
      const res = await fetch(`/api/gastos?${p}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Erro ao gerar relatório.'); return; }
      setGastos(Array.isArray(data) ? data : []);
      setGerado(true);
    } catch { setError('Erro ao gerar relatório.'); }
    finally { setLoading(false); }
  };

  const params = new URLSearchParams({ dataInicio, dataFim }).toString();
  const total  = gastos.reduce((s, g) => s + (g.valor || 0), 0);
  const dataBR = (iso: string) => { if (!iso) return ''; const [a, b, c] = iso.split('-'); return `${c}/${b}/${a}`; };

  return (
    <div className="p-5 md:p-8 max-w-lg mx-auto space-y-6">
      <Link href="/gastos" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 font-semibold">
        <ArrowLeft size={14} /> Gastos
      </Link>

      {/* Header */}
      <div className="pt-1">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 bg-blue-50 rounded-2xl flex items-center justify-center">
            <BarChart2 size={18} className="text-blue-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Relatório de Gastos</h1>
        </div>
        <p className="text-sm text-gray-400 mt-1">Selecione o período e gere o resumo</p>
      </div>

      {/* Período */}
      <div className="card p-6 space-y-4">
        <p className="font-bold text-gray-900">Período</p>
        <div>
          <label className="label">Data inicial</label>
          <input type="date" className="input text-base" value={dataInicio} onChange={e => { setDataInicio(e.target.value); setGerado(false); }} />
        </div>
        <div>
          <label className="label">Data final</label>
          <input type="date" className="input text-base" value={dataFim} onChange={e => { setDataFim(e.target.value); setGerado(false); }} />
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl p-3.5 text-sm">
            <AlertCircle size={15} className="shrink-0" /> {error}
          </div>
        )}

        <button onClick={handleGerar} disabled={loading || !dataInicio || !dataFim}
          className="btn-primary w-full py-4 rounded-2xl text-base justify-center">
          {loading ? <><Loader2 size={18} className="animate-spin" /> Gerando...</> : <><TrendingUp size={18} /> Gerar Relatório</>}
        </button>
      </div>

      {/* Resultado */}
      {gerado && (
        <>
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">
              Resumo · {dataBR(dataInicio)} até {dataBR(dataFim)}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="card p-5">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3 bg-purple-50 text-purple-600"><Wallet size={18} /></div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">Total Gasto</p>
                <p className="text-base sm:text-xl font-bold text-gray-900 leading-tight tabular-nums">{formatarMoeda(total)}</p>
              </div>
              <div className="card p-5">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3 bg-blue-50 text-blue-600"><BarChart2 size={18} /></div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">Qtd. Gastos</p>
                <p className="text-base sm:text-xl font-bold text-gray-900 leading-tight tabular-nums">{gastos.length}</p>
              </div>
            </div>
          </div>

          <button onClick={() => window.open(`/api/gastos/export-pdf?${params}`, '_blank')}
            className="btn-secondary w-full py-3.5 rounded-2xl text-sm justify-center font-bold">
            <Printer size={16} className="text-red-500" /> Imprimir Relatório
          </button>

          {gastos.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Gastos do período ({gastos.length})</p>
              <div className="space-y-2">
                {gastos.map(g => (
                  <Link key={g.id} href={`/gastos/${g.id}`} className="card-hover flex items-center gap-4 p-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 truncate text-sm">{g.descricao}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {formatarData(g.data)}{g.categoria ? ` · ${g.categoria}` : ''}
                      </p>
                    </div>
                    <p className="font-bold text-gray-900 text-sm shrink-0">{formatarMoeda(g.valor)}</p>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
