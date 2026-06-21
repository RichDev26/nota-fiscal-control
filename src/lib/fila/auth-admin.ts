import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

export async function requireFilaAdmin(): Promise<{ error: NextResponse } | { ok: true }> {
  const session = await getSession();
  if (!session) {
    return { error: NextResponse.json({ error: 'Não autorizado' }, { status: 401 }) };
  }
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || session.email !== adminEmail) {
    return { error: NextResponse.json({ error: 'Acesso restrito a administradores' }, { status: 403 }) };
  }
  return { ok: true };
}
