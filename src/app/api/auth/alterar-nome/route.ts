import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { getSession, signToken, setSessionCookie } from '@/lib/auth';

const schema = z.object({
  nome: z.string().min(2, 'Nome muito curto').max(100).trim(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0].message : 'Dados inválidos';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const usuario = await prisma.usuario.update({
    where:  { id: session.sub },
    data:   { nome: body.nome.trim() },
    select: { id: true, email: true, nome: true },
  });

  // Reemitir token com nome atualizado
  const newToken = await signToken({ sub: usuario.id, email: usuario.email, nome: usuario.nome });
  const res = NextResponse.json({ ok: true, usuario: { nome: usuario.nome } });
  return setSessionCookie(res, newToken);
}
