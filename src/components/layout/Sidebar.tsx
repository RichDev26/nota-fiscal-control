'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, FileText, BarChart2, Receipt, Settings } from 'lucide-react';

const links = [
  { href: '/',           label: 'Dashboard',  icon: LayoutDashboard },
  { href: '/notas',      label: 'Notas',       icon: FileText },
  { href: '/relatorios', label: 'Relatórios',  icon: BarChart2 },
  { href: '/impostos',   label: 'Impostos',    icon: Receipt },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-52 bg-white border-r border-gray-100 flex flex-col shrink-0 h-full hidden md:flex">
      {/* Logo */}
      <div className="px-5 py-5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center shrink-0 shadow-sm shadow-blue-200">
            <FileText size={15} className="text-white" />
          </div>
          <div>
            <p className="font-bold text-gray-900 text-sm leading-tight">NF Control</p>
            <p className="text-[10px] text-gray-400 font-medium">Notas Fiscais</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-2 space-y-0.5">
        {links.map(({ href, label, icon: Icon }) => {
          const active =
            href === '/'
              ? pathname === '/'
              : pathname === href || pathname.startsWith(href + '/');
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

      {/* Bottom */}
      <div className="px-3 py-3 border-t border-gray-50">
        <button className="flex items-center gap-3 px-3 py-2.5 w-full rounded-xl text-sm font-semibold text-gray-400 hover:bg-gray-50 hover:text-gray-700 transition-all">
          <Settings size={16} />
          <span>Configurações</span>
        </button>
        <p className="text-[10px] text-gray-300 px-3 mt-2">v1.0.0</p>
      </div>
    </aside>
  );
}
