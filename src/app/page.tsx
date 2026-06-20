'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PlusCircle, FileText, ChevronRight, TrendingUp, DollarSign, Receipt } from 'lucide-react';
import { formatarMoeda, formatarData } from '@/lib/validators';
import { STATUS_LABELS, STATUS_COLORS } from '@/types';
import type { NotaFiscal } from '@/types';
import { useSession } from '@/context/SessionContext';

interface Resumo {
  countMes:   number;
  brutoBruto: number;
  brutoLiq:   number;
  totalGeral: number;
  totalNotas: number;
}

export default function Dashboard() {
  const { usuario } = useSession();
  const [resumo,   setResumo]   = useState<Resumo | null>(null);
  const [recentes, setRecentes] = useState<NotaFiscal[]>([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/notas/resumo').then(r => r.ok ? r.json() : null),
      fetch('/api/notas?por=5&ordenarPor=createdAt&ordem=desc').then(r => r.json()),
    ]).then(([res, notas]) => {
      setResumo(res);
      setRecentes(notas.notas || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const now       = new Date();
  const userName  = usuario?.nome?.split(' ')[0] ?? '';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-5 md:p-8 max-w-2xl mx-auto space-y-8">

      {/* ── Saudação ── */}
      <div className="flex items-start justify-between gap-4 pt-2">
        <div>
          <p className="text-gray-400 text-sm font-medium">Bem-vindo de volta</p>
          <h1 className="text-3xl font-bold text-gray-900 mt-0.5">
            Olá, {userName || 'Bem-vindo'} 👋
          </h1>
        </div>
        <Link href="/notas/nova" className="btn-primary btn-lg shrink-0 hidden sm:flex">
          <PlusCircle size={18} /> Nova Nota
        </Link>
      </div>

      {/* ── Botão mobile ── */}
      <Link href="/notas/nova" className="btn-primary w-full justify-center py-4 rounded-2xl text-base sm:hidden">
        <PlusCircle size={20} /> + Nova Nota
      </Link>

      {/* ── Stats deste mês ── */}
      <div>
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">
          Notas deste mês — {now.toLocaleString('pt-BR', { month: 'long', year: 'numeric' })}
        </p>
        <div className="grid grid-cols-3 gap-3">
          <div className="card p-3 sm:p-4 text-center">
            <p className="text-xl sm:text-2xl font-bold text-gray-900">{resumo?.countMes ?? 0}</p>
            <p className="text-xs text-gray-400 mt-1 font-medium">Notas</p>
          </div>
          <div className="card p-3 sm:p-4 text-center">
            <p className="text-sm sm:text-lg font-bold text-gray-900 leading-tight tabular-nums">{formatarMoeda(resumo?.brutoBruto ?? 0)}</p>
            <p className="text-xs text-gray-400 mt-1 font-medium">Bruto</p>
          </div>
          <div className="card p-3 sm:p-4 text-center">
            <p className="text-sm sm:text-lg font-bold text-green-700 leading-tight tabular-nums">{formatarMoeda(resumo?.brutoLiq ?? 0)}</p>
            <p className="text-xs text-gray-400 mt-1 font-medium">Líquido</p>
          </div>
        </div>
      </div>

      {/* ── Atalhos rápidos ── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { href: '/relatorios', icon: TrendingUp, label: 'Relatório',  color: 'text-blue-600 bg-blue-50' },
          { href: '/impostos',   icon: Receipt,    label: 'Impostos',   color: 'text-orange-600 bg-orange-50' },
          { href: '/notas?status=incompleta', icon: FileText, label: 'Incompletas', color: 'text-amber-600 bg-amber-50' },
        ].map(({ href, icon: Icon, label, color }) => (
          <Link key={href} href={href}
            className="card-hover p-4 flex flex-col items-center gap-2 text-center">
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${color}`}>
              <Icon size={18} />
            </div>
            <span className="text-xs font-semibold text-gray-600">{label}</span>
          </Link>
        ))}
      </div>

      {/* ── Últimas notas ── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <p className="font-bold text-gray-900">Últimas Notas</p>
          <Link href="/notas" className="text-sm text-blue-600 font-semibold hover:underline flex items-center gap-0.5">
            Ver todas <ChevronRight size={14} />
          </Link>
        </div>

        {recentes.length === 0 ? (
          <div className="card p-10 flex flex-col items-center gap-4 text-center">
            <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center">
              <FileText size={28} className="text-gray-300" />
            </div>
            <div>
              <p className="font-semibold text-gray-500">Nenhuma nota ainda</p>
              <p className="text-sm text-gray-400 mt-1">Lance sua primeira nota fiscal agora</p>
            </div>
            <Link href="/notas/nova" className="btn-primary">
              <PlusCircle size={16} /> Lançar Nota
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {recentes.map(n => {
              const tomador = n.tomador?.nomeRazaoSocial || n.tomador?.nomeFantasia || '';
              const nomeCurto = tomador.replace(/\s+(Ltda\.?|S\.A\.?|ME\.?|EIRELI)\.?$/i, '').slice(0, 22);
              return (
                <Link key={n.id} href={`/notas/${n.id}`}
                  className="card-hover flex items-center gap-4 p-4">
                  <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
                    <FileText size={17} className="text-blue-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 truncate">
                      {n.nomeOrganizador || `NF ${n.numeroNf || 'S/N'}`}
                    </p>
                    <p className="text-sm text-gray-400 truncate">
                      {nomeCurto || 'Sem tomador'}{n.dataEmissao ? ` · ${formatarData(n.dataEmissao)}` : ''}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-gray-900">{formatarMoeda(n.valorBruto)}</p>
                    <span className={`badge ${STATUS_COLORS[n.status] || 'bg-gray-100 text-gray-500'} text-[10px] mt-0.5`}>
                      {STATUS_LABELS[n.status] || n.status}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Total geral ── */}
      {(resumo?.totalNotas ?? 0) > 0 && (
        <div className="card p-5 flex items-center gap-4 bg-gradient-to-r from-blue-600 to-blue-700 border-0">
          <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center shrink-0">
            <DollarSign size={22} className="text-white" />
          </div>
          <div>
            <p className="text-blue-100 text-sm font-medium">Total geral em notas</p>
            <p className="text-white text-2xl font-bold">{formatarMoeda(resumo?.totalGeral ?? 0)}</p>
          </div>
        </div>
      )}
    </div>
  );
}
