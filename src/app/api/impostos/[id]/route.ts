import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { verificarAcessoAssinatura } from '@/lib/assinatura/acesso';

export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  try {
    await verificarAcessoAssinatura(session.sub);
  } catch {
    return NextResponse.json({ error: 'Assinatura inativa ou trial expirado.' }, { status: 402 });
  }

  try {
    const existing = await prisma.imposto.findUnique({ where: { id: params.id }, select: { usuarioId: true } });
    if (!existing) return NextResponse.json({ error: 'Imposto não encontrado' }, { status: 404 });
    if (existing.usuarioId && existing.usuarioId !== session.sub)
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });

    const body = await req.json();
    const parseDate = (d: string | null | undefined) => (d ? new Date(d) : null);

    const imposto = await prisma.imposto.update({
      where: { id: params.id },
      data: {
        ...body,
        dataVencimento: parseDate(body.dataVencimento),
        dataPagamento: parseDate(body.dataPagamento),
      },
      include: { notaFiscal: { select: { id: true, numeroNf: true, nomeOrganizador: true } } },
    });

    return NextResponse.json(imposto);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Erro ao atualizar imposto' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  try {
    await verificarAcessoAssinatura(session.sub);
  } catch {
    return NextResponse.json({ error: 'Assinatura inativa ou trial expirado.' }, { status: 402 });
  }

  try {
    const existing = await prisma.imposto.findUnique({ where: { id: params.id }, select: { usuarioId: true } });
    if (!existing) return NextResponse.json({ error: 'Imposto não encontrado' }, { status: 404 });
    if (existing.usuarioId && existing.usuarioId !== session.sub)
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });

    await prisma.imposto.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Erro ao excluir imposto' }, { status: 500 });
  }
}
