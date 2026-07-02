'use client';

import Link from 'next/link';
import {
  LayoutDashboard, FileText, Wallet,
  BarChart2, Receipt, UserCheck, Settings,
} from 'lucide-react';
import { useSession } from '@/context/SessionContext';

// ponytail: array central — para adicionar módulo no futuro, só inserir um objeto aqui
const MODULES = [
  {
    href: '/painel',
    icon: LayoutDashboard,
    label: 'Dashboard',
    description: 'Resumo financeiro e últimas notas do mês.',
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-600',
  },
  {
    href: '/notas',
    icon: FileText,
    label: 'Notas Fiscais',
    description: 'Controle completo das suas NFS-e com extração por IA.',
    iconBg: 'bg-indigo-50',
    iconColor: 'text-indigo-600',
  },
  {
    href: '/gastos',
    icon: Wallet,
    label: 'Gastos',
    description: 'Gerencie despesas e serviços da empresa.',
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-600',
  },
  {
    href: '/relatorios',
    icon: BarChart2,
    label: 'Relatórios',
    description: 'Visualize relatórios completos de receitas.',
    iconBg: 'bg-violet-50',
    iconColor: 'text-violet-600',
  },
  {
    href: '/impostos',
    icon: Receipt,
    label: 'Impostos',
    description: 'Controle dos impostos e obrigações fiscais.',
    iconBg: 'bg-orange-50',
    iconColor: 'text-orange-600',
  },
  {
    href: '/integracao',
    icon: UserCheck,
    label: 'Controle de Integração',
    description: 'Gerencie integrações e ASOs dos colaboradores.',
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

export default function HomePage() {
  const { usuario } = useSession();
  const firstName = usuario?.nome?.split(' ')[0] ?? '';

  return (
    <div className="p-5 md:p-8 max-w-4xl mx-auto">

      {/* Cabeçalho */}
      <div className="pt-2 pb-8 animate-enter">
        <p className="text-sm font-medium text-gray-400 mb-1">
          {firstName ? `Olá, ${firstName} 👋` : 'Olá 👋'}
        </p>
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
          Com o que você quer trabalhar hoje?
        </h1>
        <p className="text-sm text-gray-400 mt-1.5">
          Escolha um módulo para começar.
        </p>
      </div>

      {/* Grid de módulos */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 md:gap-4">
        {MODULES.map(({ href, icon: Icon, label, description, iconBg, iconColor }, i) => (
          <Link
            key={href}
            href={href}
            className="card-hover p-5 flex flex-col gap-3.5 group animate-enter"
            style={{ animationDelay: `${0.05 + i * 0.05}s`, animationFillMode: 'both' }}
          >
            <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-110 ${iconBg} ${iconColor}`}>
              <Icon size={20} />
            </div>
            <div>
              <p className="font-semibold text-gray-900 text-sm leading-snug">{label}</p>
              <p className="text-xs text-gray-400 mt-1 leading-relaxed">{description}</p>
            </div>
          </Link>
        ))}
      </div>

    </div>
  );
}
