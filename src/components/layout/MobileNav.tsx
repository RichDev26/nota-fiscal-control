'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, FileText, BarChart2, Receipt, PlusCircle, Settings } from 'lucide-react';

const links = [
  { href: '/',              label: 'Início',     icon: LayoutDashboard },
  { href: '/notas',         label: 'Notas',      icon: FileText },
  { href: '/notas/nova',    label: 'Nova',       icon: PlusCircle, highlight: true },
  { href: '/impostos',      label: 'Impostos',   icon: Receipt },
  { href: '/configuracoes', label: 'Config',     icon: Settings },
];

export default function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 bg-white border-t border-gray-100 flex md:hidden safe-bottom"
         style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {links.map(({ href, label, icon: Icon, highlight }) => {
        const active = href === '/'
          ? pathname === '/'
          : pathname === href || pathname.startsWith(href + '/');

        if (highlight) {
          return (
            <Link key={href} href={href} className="flex-1 flex flex-col items-center justify-center py-2 -mt-4">
              <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200">
                <Icon size={22} className="text-white" />
              </div>
            </Link>
          );
        }

        return (
          <Link
            key={href}
            href={href}
            className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors ${
              active ? 'text-blue-600' : 'text-gray-400'
            }`}
          >
            <Icon size={20} strokeWidth={active ? 2.5 : 2} />
            <span className={`text-[10px] font-semibold ${active ? 'text-blue-600' : 'text-gray-400'}`}>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
