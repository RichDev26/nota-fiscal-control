'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Home, LayoutDashboard, FileText, Wallet,
  UserCheck, BarChart2, Receipt, Settings, LogOut,
} from 'lucide-react';

// Mesmos links + ícones da Sidebar — ordem igual para familiaridade
const LINKS = [
  { href: '/home',          label: 'Início',     icon: Home },
  { href: '/painel',        label: 'Dashboard',  icon: LayoutDashboard },
  { href: '/notas',         label: 'Notas',       icon: FileText },
  { href: '/gastos',        label: 'Gastos',      icon: Wallet },
  { href: '/integracao',    label: 'Integração',  icon: UserCheck },
  { href: '/relatorios',    label: 'Relatórios',  icon: BarChart2 },
  { href: '/impostos',      label: 'Impostos',    icon: Receipt },
  { href: '/configuracoes', label: 'Config',      icon: Settings },
];

export default function MobileNav() {
  const pathname = usePathname();
  const router   = useRouter();

  // Mesma lógica de logout da Sidebar
  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/auth');
    router.refresh();
  }

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-50 flex justify-center items-end px-4"
      style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
    >
      {/* Degradê que separa a nav do conteúdo abaixo */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'linear-gradient(to top, #F4F6FB 55%, transparent)' }}
      />

      {/* Pill flutuante */}
      <div
        className="relative flex items-center gap-1 bg-white/90 backdrop-blur-xl rounded-[28px] border border-gray-100/80 px-2 py-2 overflow-x-auto scroll-x-hidden max-w-full"
        style={{ boxShadow: '0 8px 32px -8px rgba(0,0,0,0.12), 0 2px 8px -2px rgba(0,0,0,0.06)' }}
      >
        {LINKS.map(({ href, label, icon: Icon }) => {
          // /home só marca ativo em match exato; demais marcam também em sub-rotas
          const active = pathname === href ||
            (href !== '/home' && pathname.startsWith(href + '/'));

          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-2xl text-[11.5px] font-semibold
                          shrink-0 whitespace-nowrap select-none transition-all duration-200
                          ${active
                            ? 'bg-blue-600 text-white'
                            : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800 active:scale-95'
                          }`}
              style={active ? { boxShadow: '0 2px 12px -2px rgba(37,99,235,0.50)' } : undefined}
            >
              <Icon size={14} strokeWidth={active ? 2.5 : 2} />
              <span>{label}</span>
            </Link>
          );
        })}

        {/* Separador + botão Sair (preservado da Sidebar) */}
        <div className="w-px h-5 bg-gray-100 mx-1 shrink-0" />
        <button
          onClick={handleLogout}
          className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-[11.5px] font-semibold
                     shrink-0 whitespace-nowrap select-none transition-all duration-200
                     text-gray-400 hover:bg-red-50 hover:text-red-500 active:scale-95"
        >
          <LogOut size={13} />
          <span>Sair</span>
        </button>
      </div>
    </nav>
  );
}
