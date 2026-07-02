'use client';

import { usePathname } from 'next/navigation';
import Sidebar    from './Sidebar';
import MobileNav  from './MobileNav';
import { SessionProvider } from '@/context/SessionContext';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublicRoute = pathname.startsWith('/auth') || pathname === '/';
  // Home é autenticada mas fullscreen — sem sidebar nem nav
  const isFullscreen  = pathname === '/home';

  if (isPublicRoute) {
    return <>{children}</>;
  }

  if (isFullscreen) {
    return (
      <SessionProvider>
        {children}
      </SessionProvider>
    );
  }

  return (
    <SessionProvider>
      <div className="flex h-dvh overflow-hidden bg-[#F4F6FB]">
        <Sidebar />
        <main className="flex-1 overflow-y-auto pb-20 md:pb-0">
          {children}
        </main>
      </div>
      <MobileNav />
    </SessionProvider>
  );
}
