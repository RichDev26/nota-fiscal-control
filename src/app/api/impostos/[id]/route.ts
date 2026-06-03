import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
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
  try {
    await prisma.imposto.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Erro ao excluir imposto' }, { status: 500 });
  }
}
