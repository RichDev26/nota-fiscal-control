'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, FileText, BarChart2, Receipt, Wallet, Settings, LogOut } from 'lucide-react';
import { useSession } from '@/context/SessionContext';

const links = [
  { href: '/painel',     label: 'Dashboard',  icon: LayoutDashboard },
  { href: '/notas',      label: 'Notas',       icon: FileText },
  { href: '/gastos',     label: 'Gastos',      icon: Wallet },
  { href: '/relatorios', label: 'Relatórios',  icon: BarChart2 },
  { href: '/impostos',   label: 'Impostos',    icon: Receipt },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router   = useRouter();
  const { usuario } = useSession();

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/auth');
    router.refresh();
  }

  const initials = usuario?.nome
    ?.split(' ')
    .slice(0, 2)
    .map(p => p[0])
    .join('')
    .toUpperCase() ?? '?';

  const firstName = usuario?.nome?.split(' ')[0] ?? '';

  return (
    <aside className="w-52 bg-white border-r border-gray-100 flex flex-col shrink-0 h-full hidden md:flex">
      {/* Logo */}
      <div className="px-5 py-5">
        <div className="flex items-center gap-2.5">
          <img src="/logo.png" alt="WorkPro Control" className="w-8 h-8 shrink-0" />
          <div>
            <p className="font-bold text-gray-900 text-sm leading-tight">NF Control</p>
            <p className="text-[10px] text-gray-400 font-medium">Notas Fiscais</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-2 space-y-0.5">
        {links.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                active
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <Icon size={17} className="shrink-0" />
              <span>{label}</span>
              {active && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-600" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Bottom — usuário + logout */}
      <div className="px-3 py-3 border-t border-gray-50 space-y-1">

        {/* Configurações */}
        <Link href="/configuracoes" className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
          pathname === '/configuracoes'
            ? 'bg-blue-50 text-blue-700'
            : 'text-gray-400 hover:bg-gray-50 hover:text-gray-700'
        }`}>
          <Settings size={16} />
          <span>Configurações</span>
        </Link>

        {/* Perfil do usuário */}
        {usuario && (
          <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-gray-50">
            <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
              <span className="text-white text-[10px] font-bold">{initials}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-800 truncate">{firstName}</p>
              <p className="text-[10px] text-gray-400 truncate">{usuario.email}</p>
            </div>
          </div>
        )}

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2 w-full rounded-xl text-sm text-gray-400
            hover:bg-red-50 hover:text-red-600 transition-all"
        >
          <LogOut size={15} />
          <span>Sair</span>
        </button>

        <p className="text-[10px] text-gray-300 px-3 pt-1">v1.0.0</p>
      </div>
    </aside>
  );
}
