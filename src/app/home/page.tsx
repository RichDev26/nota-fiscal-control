'use client';

import Link from 'next/link';
import {
  LayoutDashboard, FileText, Wallet,
  BarChart2, Receipt, UserCheck, Settings,
} from 'lucide-react';
import { useSession } from '@/context/SessionContext';

// ponytail: adicionar módulos futuros aqui — grid se adapta automaticamente
const MODULES = [
  {
    href: '/painel',
    icon: LayoutDashboard,
    label: 'Dashboard',
    description: 'Resumo financeiro e últimas notas.',
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-600',
  },
  {
    href: '/notas',
    icon: FileText,
    label: 'Notas Fiscais',
    description: 'Controle das NFS-e com extração por IA.',
    iconBg: 'bg-indigo-50',
    iconColor: 'text-indigo-600',
  },
  {
    href: '/gastos',
    icon: Wallet,
    label: 'Gastos',
    description: 'Despesas e serviços da empresa.',
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-600',
  },
  {
    href: '/relatorios',
    icon: BarChart2,
    label: 'Relatórios',
    description: 'Relatórios completos de receitas.',
    iconBg: 'bg-violet-50',
    iconColor: 'text-violet-600',
  },
  {
    href: '/impostos',
    icon: Receipt,
    label: 'Impostos',
    description: 'Obrigações fiscais e controle de impostos.',
    iconBg: 'bg-orange-50',
    iconColor: 'text-orange-600',
  },
  {
    href: '/integracao',
    icon: UserCheck,
    label: 'Controle de Integração',
    description: 'Integrações e ASOs dos colaboradores.',
    iconBg: 'bg-rose-50',
    iconColor: 'text-rose-600',
  },
  {
    href: '/configuracoes',
    icon: Settings,
    label: 'Configurações',
    description: 'Preferências da conta e do sistema.',
    iconBg: 'bg-gray-100',
    iconColor: 'text-gray-500',
  },
] as const;

// Timings da sequência animada
const T_QUESTION  = 3.0;   // pergunta aparece
const T_SUBTITLE  = 3.15;  // subtítulo
const T_CARDS     = 3.5;   // primeiro card
const T_STAGGER   = 0.11;  // delay entre cards

export default function HomePage() {
  const { usuario } = useSession();
  const firstName = usuario?.nome?.split(' ')[0] ?? '';

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 py-16"
      style={{ background: 'linear-gradient(135deg, #F4F6FB 0%, #ffffff 50%, #F0F4FF 100%)' }}
    >
      <div className="w-full max-w-3xl">

        {/* ── Saudação ── */}
        <div className="text-center mb-16 home-greet">
          <p className="text-3xl md:text-4xl text-gray-400 font-light tracking-wide">
            Olá, {firstName || 'bem-vindo'} 👋
          </p>
        </div>

        {/* ── Pergunta ── */}
        <div className="text-center mb-10">
          <h1
            className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight home-reveal"
            style={{ animationDelay: `${T_QUESTION}s` }}
          >
            Com o que você quer trabalhar hoje?
          </h1>
          <p
            className="text-gray-400 mt-2.5 text-base home-reveal"
            style={{ animationDelay: `${T_SUBTITLE}s` }}
          >
            Escolha um módulo para começar.
          </p>
        </div>

        {/* ── Grid de módulos ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 md:gap-4">
          {MODULES.map(({ href, icon: Icon, label, description, iconBg, iconColor }, i) => (
            <Link
              key={href}
              href={href}
              className="home-reveal group bg-white rounded-2xl border border-gray-100 shadow-sm
                         hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200
                         p-5 md:p-6 flex flex-col gap-4"
              style={{ animationDelay: `${T_CARDS + i * T_STAGGER}s` }}
            >
              <div
                className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0
                            transition-transform duration-200 group-hover:scale-110
                            ${iconBg} ${iconColor}`}
              >
                <Icon size={22} strokeWidth={1.75} />
              </div>
              <div>
                <p className="font-semibold text-gray-900 text-sm leading-snug">{label}</p>
                <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">{description}</p>
              </div>
            </Link>
          ))}
        </div>

      </div>
    </div>
  );
}
