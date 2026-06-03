import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || '';
    const mesReferencia = searchParams.get('mesReferencia') || '';

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (mesReferencia) where.mesReferencia = { contains: mesReferencia };

    const impostos = await prisma.imposto.findMany({
      where,
      include: { notaFiscal: { select: { id: true, numeroNf: true, nomeOrganizador: true } } },
      orderBy: [{ dataVencimento: 'asc' }, { createdAt: 'desc' }],
    });

    return NextResponse.json(impostos);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Erro ao buscar impostos' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parseDate = (d: string | null | undefined) => (d ? new Date(d) : null);

    const imposto = await prisma.imposto.create({
      data: {
        ...body,
        dataVencimento: parseDate(body.dataVencimento),
        dataPagamento: parseDate(body.dataPagamento),
      },
      include: { notaFiscal: { select: { id: true, numeroNf: true, nomeOrganizador: true } } },
    });

    return NextResponse.json(imposto, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Erro ao criar imposto' }, { status: 500 });
  }
}
