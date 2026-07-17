import { headers } from 'next/headers';
import { getSession } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { temAcessoAtivo } from '@/lib/assinatura/acesso';
import { isPublicPage } from '@/lib/route-access';
import TelaBloqueio from './TelaBloqueio';

export default async function AssinaturaGate({ children }: { children: React.ReactNode }) {
  const pathname = headers().get('x-pathname') ?? '';
  if (isPublicPage(pathname)) return <>{children}</>;

  const session = await getSession();
  if (!session) return <>{children}</>; // sem sessão: o middleware já redirecionou para /auth

  const assinatura = await prisma.assinatura.findUnique({ where: { usuarioId: session.sub } });
  if (temAcessoAtivo(assinatura)) return <>{children}</>;

  const motivo = !assinatura?.periodoFimEm ? 'trial_expirado' as const : 'assinatura_vencida' as const;
  return <TelaBloqueio motivo={motivo} />;
}
