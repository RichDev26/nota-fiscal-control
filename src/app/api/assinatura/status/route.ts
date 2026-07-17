import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { obterStatusParaCliente } from '@/lib/assinatura/servico';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const status = await obterStatusParaCliente(session.sub);
  return NextResponse.json(status);
}
