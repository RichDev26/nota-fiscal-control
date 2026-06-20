import { NextRequest, NextResponse } from 'next/server';
import { compare, hash } from 'bcryptjs';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';

const schema = z.object({
  senhaAtual: z.string().min(1, 'Informe a senha atual'),
  novaSenha:  z.string().min(8, 'Mínimo 8 caracteres').max(128),
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

  const usuario = await prisma.usuario.findUnique({
    where:  { id: session.sub },
    select: { senhaHash: true },
  });
  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });

  const senhaOk = await compare(body.senhaAtual, usuario.senhaHash);
  if (!senhaOk) return NextResponse.json({ error: 'Senha atual incorreta' }, { status: 400 });

  const novaHash = await hash(body.novaSenha, 12);
  await prisma.usuario.update({ where: { id: session.sub }, data: { senhaHash: novaHash } });

  return NextResponse.json({ ok: true });
}
