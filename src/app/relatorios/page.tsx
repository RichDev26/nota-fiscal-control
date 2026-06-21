'use client';

import { useState } from 'react';
import {
  BarChart2, Download, FileSpreadsheet, FileText, Printer,
  Loader2, AlertCircle, TrendingUp, Receipt, DollarSign,
} from 'lucide-react';
import { formatarMoeda } from '@/lib/validators';
import type { ResumoRelatorio, NotaFiscal } from '@/types';
import { STATUS_LABELS, STATUS_COLORS } from '@/types';

// ─── helpers ──────────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, iconColor, label, value, sub }: {
  icon: React.ElementType; iconColor: string;
  label: string; value: string; sub?: string;
}) {
  return (
    <div className="card p-5">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${iconColor}`}>
        <Icon size={18} />
      </div>
      <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-base sm:text-xl font-bold text-gray-900 leading-tight tabular-nums">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function RelatoriosPage() {
  // Pega mês atual como padrão
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');

  const [dataInicio, setDataInicio] = useState(`${y}-${m}-01`);
  const [dataFim, setDataFim]       = useState(`${y}-${m}-${new Date(y, now.getMonth() + 1, 0).getDate()}`);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [resumo, setResumo]         = useState<ResumoRelatorio | null>(null);
  const [notas, setNotas]           = useState<NotaFiscal[]>([]);
  const [gerado, setGerado]         = useState(false);

  const handleGerar = async () => {
    setLoading(true); setError(''); setResumo(null); setNotas([]);
    try {
      const p = new URLSearchParams({ dataInicio, dataFim });
      const res = await fetch(`/api/relatorios?${p}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Erro ao gerar relatório.'); return; }
      setResumo(data.resumo);
      setNotas(data.notas || []);
      setGerado(true);
    } catch {
      setError('Erro ao gerar relatório.');
    } finally {
      setLoading(false);
    }
  };

  const params = new URLSearchParams({ dataInicio, dataFim }).toString();

  const dataBR = (iso: string) => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };

  return (
    <div className="p-5 md:p-8 max-w-lg mx-auto space-y-6">
      {/* Header */}
      <div className="pt-2">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 bg-blue-50 rounded-2xl flex items-center justify-center">
            <BarChart2 size={18} className="text-blue-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Relatórios</h1>
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

        <button
          onClick={handleGerar}
          disabled={loading || !dataInicio || !dataFim}
          className="btn-primary w-full py-4 rounded-2xl text-base justify-center"
        >
          {loading ? <><Loader2 size={18} className="animate-spin" /> Gerando...</> : <><TrendingUp size={18} /> Gerar Relatório</>}
        </button>
      </div>

      {/* Resultado */}
      {gerado && resumo && (
        <>
          {/* Resumo */}
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">
              Resumo · {dataBR(dataInicio)} até {dataBR(dataFim)}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <StatCard icon={FileText} iconColor="bg-blue-50 text-blue-600"
                label="Notas" value={String(resumo.totalNotas)}
                sub={`${resumo.totalNotas} nota${resumo.totalNotas !== 1 ? 's' : ''}`} />
              <StatCard icon={DollarSign} iconColor="bg-gray-50 text-gray-600"
                label="Valor Bruto" value={formatarMoeda(resumo.totalBruto)} />
              <StatCard icon={TrendingUp} iconColor="bg-green-50 text-green-600"
                label="Valor Líquido" value={formatarMoeda(resumo.totalLiquido)} />
              <StatCard icon={Receipt} iconColor="bg-orange-50 text-orange-600"
                label="ISS" value={formatarMoeda(resumo.totalIss)} />
            </div>
          </div>

          {/* Exportar */}
          <div className="space-y-3">
            <button
              onClick={() => window.open(`/api/relatorios/export-pdf?${params}`, '_blank')}
              className="btn-secondary w-full py-3.5 rounded-2xl text-sm justify-center font-bold"
            >
              <Printer size={16} className="text-red-500" /> Imprimir Relatório
            </button>
            <button
              onClick={() => window.open(`/api/relatorios/export-excel?${params}`, '_blank')}
              className="btn-secondary w-full py-3.5 rounded-2xl text-sm justify-center font-bold"
            >
              <FileSpreadsheet size={16} className="text-green-600" /> Exportar Excel
            </button>
          </div>

          {/* Lista de notas */}
          {notas.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">
                Notas do período ({notas.length})
              </p>
              <div className="space-y-2">
                {notas.map(n => {
                  const tomador = n.tomador?.nomeRazaoSocial || n.tomador?.nomeFantasia || '';
                  const nomeCurto = tomador.replace(/\s+(Ltda\.?|S\.A\.?|ME\.?|EIRELI)\.?$/i, '').slice(0, 22);
                  return (
                    <a key={n.id} href={`/notas/${n.id}`}
                      className="card-hover flex items-center gap-4 p-4">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900 truncate text-sm">
                          {n.nomeOrganizador || `NF ${n.numeroNf || 'S/N'}`}
                        </p>
                        <p className="text-xs text-gray-400 truncate mt-0.5">
                          {nomeCurto || 'Sem tomador'}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-bold text-gray-900 text-sm">{formatarMoeda(n.valorBruto)}</p>
                        <span className={`badge ${STATUS_COLORS[n.status] || 'bg-gray-100 text-gray-500'} text-[10px] mt-0.5`}>
                          {STATUS_LABELS[n.status] || n.status}
                        </span>
                      </div>
                    </a>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
