'use client';

import { usePathname } from 'next/navigation';
import Sidebar    from './Sidebar';
import MobileNav  from './MobileNav';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthRoute = pathname.startsWith('/auth');

  // Rotas de autenticação: sem sidebar nem nav — tela cheia para o wizard
  if (isAuthRoute) {
    return <>{children}</>;
  }

  return (
    <>
      <div className="flex h-dvh overflow-hidden bg-[#F4F6FB]">
        <Sidebar />
        <main className="flex-1 overflow-y-auto pb-20 md:pb-0">
          {children}
        </main>
      </div>
      <MobileNav />
    </>
  );
}
