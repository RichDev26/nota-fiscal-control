'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  FileText, TrendingUp, DollarSign, AlertCircle,
  PlusCircle, BarChart2, Receipt, Clock, CheckCircle, XCircle
} from 'lucide-react';
import { formatarMoeda } from '@/lib/validators';
import { STATUS_LABELS, STATUS_COLORS } from '@/types';
import type { NotaFiscal } from '@/types';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts';

interface DashStats {
  notas: NotaFiscal[];
  total: number;
}

export default function Dashboard() {
  const [data, setData] = useState<DashStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/notas?por=1000')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const notas = data?.notas || [];

  const totalBruto = notas.reduce((s, n) => s + (n.valorBruto || 0), 0);
  const totalLiquido = notas.reduce((s, n) => s + (n.valorLiquido || 0), 0);
  const totalIss = notas.reduce((s, n) => s + (n.valorIss || 0), 0);
  const totalAntecipado = notas.reduce((s, n) => s + (n.valorLiquidoAntecipacao || 0), 0);

  const porStatus: Record<string, number> = {};
  for (const n of notas) porStatus[n.status] = (porStatus[n.status] || 0) + 1;

  const porMes: Record<string, { total: number; qtd: number }> = {};
  for (const n of notas) {
    if (n.dataEmissao) {
      const d = new Date(n.dataEmissao);
      const mes = `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
      if (!porMes[mes]) porMes[mes] = { total: 0, qtd: 0 };
      porMes[mes].total += n.valorBruto || 0;
      porMes[mes].qtd += 1;
    }
  }
  const chartData = Object.entries(porMes)
    .sort(([a], [b]) => {
      const [am, ay] = a.split('/');
      const [bm, by] = b.split('/');
      return Number(ay + am) - Number(by + bm);
    })
    .slice(-6)
    .map(([mes, v]) => ({ mes, total: v.total, qtd: v.qtd }));

  // Top tomadores
  const tomadorMap: Record<string, { total: number; qtd: number }> = {};
  for (const n of notas) {
    const nome = n.tomador?.nomeRazaoSocial || n.tomador?.nomeFantasia || 'Não informado';
    if (!tomadorMap[nome]) tomadorMap[nome] = { total: 0, qtd: 0 };
    tomadorMap[nome].total += n.valorBruto || 0;
    tomadorMap[nome].qtd += 1;
  }
  const topTomadores = Object.entries(tomadorMap)
    .sort(([, a], [, b]) => b.total - a.total)
    .slice(0, 5);

  const recentes = [...notas]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
    </div>
  );

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">{notas.length} nota{notas.length !== 1 ? 's' : ''} no sistema</p>
        </div>
        <div className="flex gap-2">
          <Link href="/notas/nova" className="btn-primary">
            <PlusCircle size={16} /> Nova Nota
          </Link>
          <Link href="/relatorios" className="btn-secondary">
            <BarChart2 size={16} /> Relatório
          </Link>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<DollarSign size={20} className="text-blue-600" />} label="Total Bruto" value={formatarMoeda(totalBruto)} bg="bg-blue-50" />
        <StatCard icon={<TrendingUp size={20} className="text-green-600" />} label="Total Líquido" value={formatarMoeda(totalLiquido)} bg="bg-green-50" />
        <StatCard icon={<Receipt size={20} className="text-orange-600" />} label="Total ISS" value={formatarMoeda(totalIss)} bg="bg-orange-50" />
        <StatCard icon={<FileText size={20} className="text-purple-600" />} label="Antecipado" value={formatarMoeda(totalAntecipado)} bg="bg-purple-50" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Gráfico Evolução */}
        <div className="card p-5 lg:col-span-2">
          <h2 className="text-sm font-bold text-gray-700 mb-4">Evolução por Mês (Valor Bruto)</h2>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => formatarMoeda(v)} />
                <Bar dataKey="total" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
              Sem dados para exibir
            </div>
          )}
        </div>

        {/* Status */}
        <div className="card p-5">
          <h2 className="text-sm font-bold text-gray-700 mb-4">Por Status</h2>
          <div className="space-y-2">
            {Object.entries(porStatus).length === 0 ? (
              <p className="text-sm text-gray-400">Sem notas</p>
            ) : (
              Object.entries(porStatus).map(([s, q]) => (
                <div key={s} className="flex items-center justify-between">
                  <span className={`badge ${STATUS_COLORS[s] || 'bg-gray-100 text-gray-600'}`}>
                    {STATUS_LABELS[s] || s}
                  </span>
                  <span className="text-sm font-semibold text-gray-700">{q}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Tomadores */}
        <div className="card p-5">
          <h2 className="text-sm font-bold text-gray-700 mb-4">Top Tomadores</h2>
          {topTomadores.length === 0 ? (
            <p className="text-sm text-gray-400">Sem dados</p>
          ) : (
            <div className="space-y-3">
              {topTomadores.map(([nome, v]) => (
                <div key={nome} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{nome}</p>
                    <p className="text-xs text-gray-500">{v.qtd} nota{v.qtd !== 1 ? 's' : ''}</p>
                  </div>
                  <span className="text-sm font-semibold text-gray-900 shrink-0">{formatarMoeda(v.total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Notas Recentes */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-gray-700">Notas Recentes</h2>
            <Link href="/notas" className="text-xs text-blue-600 hover:underline">Ver todas</Link>
          </div>
          {recentes.length === 0 ? (
            <p className="text-sm text-gray-400">Nenhuma nota lançada ainda.</p>
          ) : (
            <div className="space-y-2">
              {recentes.map(n => (
                <Link key={n.id} href={`/notas/${n.id}`} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 transition-colors group">
                  <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center shrink-0">
                    <FileText size={14} className="text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate group-hover:text-blue-600">
                      {n.nomeOrganizador || `NF ${n.numeroNf || 'S/N'}`}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {n.tomador?.nomeRazaoSocial || 'Tomador não informado'}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-gray-900">{formatarMoeda(n.valorBruto)}</p>
                    <span className={`badge ${STATUS_COLORS[n.status] || 'bg-gray-100'} text-xs`}>
                      {STATUS_LABELS[n.status] || n.status}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Atalhos */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { href: '/notas/nova', icon: PlusCircle, label: 'Lançar Nota', color: 'text-blue-600 bg-blue-50' },
          { href: '/relatorios', icon: BarChart2, label: 'Relatório', color: 'text-green-600 bg-green-50' },
          { href: '/impostos', icon: Receipt, label: 'Impostos', color: 'text-orange-600 bg-orange-50' },
          { href: '/notas?status=incompleta', icon: AlertCircle, label: 'Incompletas', color: 'text-yellow-600 bg-yellow-50' },
        ].map(({ href, icon: Icon, label, color }) => (
          <Link key={href} href={href} className="card p-4 flex flex-col items-center gap-2 hover:shadow-md transition-shadow cursor-pointer">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
              <Icon size={20} />
            </div>
            <span className="text-xs font-semibold text-gray-700">{label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, bg }: { icon: React.ReactNode; label: string; value: string; bg: string }) {
  return (
    <div className="card p-4 flex items-center gap-4">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${bg} shrink-0`}>{icon}</div>
      <div>
        <p className="text-xs text-gray-500 font-medium">{label}</p>
        <p className="text-lg font-bold text-gray-900 leading-tight">{value}</p>
      </div>
    </div>
  );
}
