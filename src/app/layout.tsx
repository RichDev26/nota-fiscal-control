import type { Metadata } from 'next';
import './globals.css';
import AppShell from '@/components/layout/AppShell';
import AssinaturaGate from '@/components/assinatura/AssinaturaGate';

export const metadata: Metadata = {
  title: 'NF Control',
  description: 'Controle de notas fiscais simplificado',
  viewport: 'width=device-width, initial-scale=1, viewport-fit=cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <AssinaturaGate>
          <AppShell>{children}</AppShell>
        </AssinaturaGate>
      </body>
    </html>
  );
}
