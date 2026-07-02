'use client';

import { usePathname } from 'next/navigation';
import MobileNav from './MobileNav';
import { SessionProvider } from '@/context/SessionContext';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublicRoute = pathname.startsWith('/auth') || pathname === '/';
  const isFullscreen  = pathname === '/home';

  if (isPublicRoute) return <>{children}</>;

  if (isFullscreen) {
    return (
      <SessionProvider>
        {children}
      </SessionProvider>
    );
  }

  return (
    <SessionProvider>
      {/* pb-24 garante que o conteúdo nunca fica atrás da nav flutuante */}
      <div className="min-h-dvh bg-[#F4F6FB] pb-24">
        {children}
      </div>
      <MobileNav />
    </SessionProvider>
  );
}
