import type { Metadata } from 'next';
import './globals.css';
import Sidebar from '@/components/layout/Sidebar';
import MobileNav from '@/components/layout/MobileNav';

export const metadata: Metadata = {
  title: 'NF Control',
  description: 'Controle de notas fiscais simplificado',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <div className="flex h-dvh overflow-hidden bg-[#F4F6FB]">
          {/* Sidebar — apenas desktop */}
          <Sidebar />

          {/* Conteúdo principal */}
          <main className="flex-1 overflow-y-auto pb-20 md:pb-0">
            {children}
          </main>
        </div>

        {/* Nav inferior — apenas mobile */}
        <MobileNav />
      </body>
    </html>
  );
}
