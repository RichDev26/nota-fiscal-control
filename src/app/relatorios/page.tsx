'use client';

import { useState } from 'react';
import { BarChart2, Download, FileSpreadsheet, FileText, Loader2, Search, AlertCircle } from 'lucide-react';
import { formatarMoeda, formatarData } from '@/lib/validators';
import { STATUS_LABELS, STATUS_COLORS } from '@/types';
import type { NotaFiscal, ResumoRelatorio } from '@/types';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend
} from 'recharts';

const STATUS_OPTIONS = ['', 'rascunho', 'lancada', 'recebida', 'antecipada', 'incompleta', 'invalida', 'substitutiva', 'substituida', 'cancelada'];
const PIE_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#64748b', '#ec4899'];

export default function RelatoriosPage() {
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resumo, setResumo] = useState<ResumoRelatorio | null>(null);
  const [notas, setNotas] = useState<NotaFiscal[]>([]);

  const handleGerar = async () => {
    setLoading(true); setError(''); setResumo(null); setNotas([]);
    try {
      const p = new URLSearchParams({ dataInicio, dataFim, status });
      const res = await fetch(`/api/relatorios?${p}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Erro ao gerar relatório.'); return; }
      setResumo(data.resumo);
      setNotas(data.notas);
    } catch {
      setError('Erro ao gerar relatório.');
    } finally {
      setLoading(false);
    }
  };

  const buildExportParams = () => {
    const p = new URLSearchParams({ dataInicio, dataFim, status });
    return p.toString();
  };

  const handleExportExcel = () => {
    window.open(`/api/relatorios/export-excel?${buildExportParams()}`, '_blank');
  };

  const handleExportPdf = () => {
    window.open(`/api/relatorios/export-pdf?${buildExportParams()}`, '_blank');
  };

  const chartMes = resumo?.porMes.map(m => ({
    mes: m.mes.replace('-', '/'),
    total: m.total,
    qtd: m.quantidade,
  })) || [];

  const pieData = Object.entries(resumo?.porStatus || {}).map(([s, q]) => ({
    name: STATUS_LABELS[s] || s,
    value: q,
    status: s,
  }));

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Relatórios</h1>
        <p className="text-sm text-gray-500 mt-0.5">Gere relatórios financeiros por período</p>
      </div>

      {/* Filtros */}
      <div className="card p-5">
        <h2 className="text-sm font-bold text-gray-700 mb-4">Filtros do Relatório</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="label">Data Início</label>
            <input type="date" className="input" value={dataInicio} onChange={e => setDataInicio(e.target.value)} />
          </div>
          <div>
            <label className="label">Data Fim</label>
            <input type="date" className="input" value={dataFim} onChange={e => setDataFim(e.target.value)} />
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">Todos</option>
              {STATUS_OPTIONS.slice(1).map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={handleGerar} disabled={loading} className="btn-primary">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
            Gerar Relatório
          </button>
          {resumo && (
            <>
              <button onClick={handleExportExcel} className="btn-secondary">
                <FileSpreadsheet size={15} className="text-green-600" /> Exportar Excel
              </button>
              <button onClick={handleExportPdf} className="btn-secondary">
                <FileText size={15} className="text-red-500" /> Exportar PDF
              </button>
            </>
          )}
        </div>
      </div>

      {error && <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm"><AlertCircle size={15} />{error}</div>}

      {resumo && (
        <>
          {/* Cards Resumo */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Total de Notas', value: String(resumo.totalNotas), color: 'text-blue-600 bg-blue-50' },
              { label: 'Total Bruto', value: formatarMoeda(resumo.totalBruto), color: 'text-green-600 bg-green-50' },
              { label: 'Total Líquido', value: formatarMoeda(resumo.totalLiquido), color: 'text-emerald-600 bg-emerald-50' },
              { label: 'Total ISS', value: formatarMoeda(resumo.totalIss), color: 'text-orange-600 bg-orange-50' },
              { label: 'Total Tributos', value: formatarMoeda(resumo.totalTributos), color: 'text-red-600 bg-red-50' },
              { label: 'Total Antecipado', value: formatarMoeda(resumo.totalAntecipado), color: 'text-purple-600 bg-purple-50' },
            ].map(c => (
              <div key={c.label} className="card p-4">
                <p className="text-xs text-gray-500 font-medium">{c.label}</p>
                <p className={`text-lg font-bold mt-1 ${c.color.split(' ')[0]}`}>{c.value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Gráfico Evolução */}
            {chartMes.length > 0 && (
              <div className="card p-5 lg:col-span-2">
                <h2 className="text-sm font-bold text-gray-700 mb-4">Evolução por Mês</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartMes}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => formatarMoeda(v)} />
                    <Bar dataKey="total" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Valor Bruto" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Gráfico Status */}
            {pieData.length > 0 && (
              <div className="card p-5">
                <h2 className="text-sm font-bold text-gray-700 mb-4">Por Status</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                      {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                    <Legend iconSize={10} iconType="circle" />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Por Tomador */}
          {resumo.porTomador.length > 0 && (
            <div className="card p-5">
              <h2 className="text-sm font-bold text-gray-700 mb-4">Por Tomador</h2>
              <div className="overflow-x-auto">
                <table className="table-auto w-full">
                  <thead>
                    <tr><th>Tomador</th><th className="text-right">Notas</th><th className="text-right">Total Bruto</th></tr>
                  </thead>
                  <tbody>
                    {resumo.porTomador.map(t => (
                      <tr key={t.nome}>
                        <td className="font-medium text-gray-800">{t.nome}</td>
                        <td className="text-right text-gray-600">{t.quantidade}</td>
                        <td className="text-right font-semibold text-gray-900">{formatarMoeda(t.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tabela de Notas */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-700">Notas do Período ({notas.length})</h2>
              <button onClick={handleExportExcel} className="btn-ghost btn-sm text-green-700">
                <Download size={13} /> Excel
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="table-auto w-full">
                <thead>
                  <tr>
                    <th>Data</th><th>Nº NF</th><th>Nome</th><th>Tomador</th><th>CNPJ/CPF</th>
                    <th className="text-right">V. Bruto</th><th className="text-right">V. Líquido</th>
                    <th className="text-right">ISS</th><th>Alíq.</th><th>Vencimento</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {notas.map(n => (
                    <tr key={n.id}>
                      <td className="text-gray-600">{formatarData(n.dataEmissao)}</td>
                      <td className="text-gray-700">{n.numeroNf || '—'}</td>
                      <td className="font-medium text-gray-800 max-w-[140px] truncate">{n.nomeOrganizador || '—'}</td>
                      <td className="text-gray-700 max-w-[140px] truncate">{n.tomador?.nomeRazaoSocial || n.tomador?.nomeFantasia || '—'}</td>
                      <td className="text-gray-500 text-xs">{n.tomador?.cpfCnpj || '—'}</td>
                      <td className="text-right font-semibold text-gray-900">{formatarMoeda(n.valorBruto)}</td>
                      <td className="text-right text-gray-700">{formatarMoeda(n.valorLiquido)}</td>
                      <td className="text-right text-gray-700">{formatarMoeda(n.valorIss)}</td>
                      <td className="text-gray-600">{n.aliquota != null ? `${n.aliquota}%` : '—'}</td>
                      <td className="text-gray-600">{formatarData(n.dataVencimento)}</td>
                      <td><span className={`badge ${STATUS_COLORS[n.status] || 'bg-gray-100'}`}>{STATUS_LABELS[n.status] || n.status}</span></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-blue-50">
                    <td colSpan={5} className="px-3 py-2.5 font-bold text-sm text-gray-700">TOTAIS</td>
                    <td className="text-right px-3 py-2.5 font-bold text-gray-900">{formatarMoeda(notas.reduce((s, n) => s + (n.valorBruto || 0), 0))}</td>
                    <td className="text-right px-3 py-2.5 font-bold text-gray-900">{formatarMoeda(notas.reduce((s, n) => s + (n.valorLiquido || 0), 0))}</td>
                    <td className="text-right px-3 py-2.5 font-bold text-gray-900">{formatarMoeda(notas.reduce((s, n) => s + (n.valorIss || 0), 0))}</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}

      {!resumo && !loading && (
        <div className="card p-12 flex flex-col items-center text-gray-400">
          <BarChart2 size={48} className="mb-3 opacity-30" />
          <p className="font-medium">Selecione um período e clique em Gerar Relatório</p>
        </div>
      )}
    </div>
  );
}
