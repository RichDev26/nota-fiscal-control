import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const nota = await prisma.notaFiscal.findUnique({
      where: { id: params.id },
      include: {
        prestador: true,
        tomador: true,
        historico: { orderBy: { dataAcao: 'desc' }, take: 50 },
        impostos: true,
        notaSubstitutiva: { include: { prestador: true, tomador: true } },
        notasSubstituidas: true,
      },
    });

    if (!nota) return NextResponse.json({ error: 'Nota não encontrada' }, { status: 404 });
    return NextResponse.json(nota);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Erro ao buscar nota' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { prestador: prestadorData, tomador: tomadorData, historico, impostos, notaSubstitutiva, notasSubstituidas, ...notaData } = body;

    // Buscar nota atual para histórico
    const notaAtual = await prisma.notaFiscal.findUnique({ where: { id: params.id } });
    if (!notaAtual) return NextResponse.json({ error: 'Nota não encontrada' }, { status: 404 });

    let prestadorId = notaAtual.prestadorId;
    let tomadorId = notaAtual.tomadorId;

    if (prestadorData) {
      if (prestadorData.id) {
        const { id: _id, ...rest } = prestadorData;
        await prisma.pessoaFiscal.update({ where: { id: prestadorData.id }, data: rest });
        prestadorId = prestadorData.id;
      } else if (Object.values(prestadorData).some(Boolean)) {
        const p = await prisma.pessoaFiscal.create({ data: prestadorData });
        prestadorId = p.id;
      }
    }

    if (tomadorData) {
      if (tomadorData.id) {
        const { id: _id, ...rest } = tomadorData;
        await prisma.pessoaFiscal.update({ where: { id: tomadorData.id }, data: rest });
        tomadorId = tomadorData.id;
      } else if (Object.values(tomadorData).some(Boolean)) {
        const t = await prisma.pessoaFiscal.create({ data: tomadorData });
        tomadorId = t.id;
      }
    }

    // Registrar histórico de alterações
    const fieldsToTrack = ['status', 'valorBruto', 'valorLiquido', 'dataRecebimento', 'observacoes'];
    const histEntries = [];
    for (const field of fieldsToTrack) {
      const oldVal = String((notaAtual as Record<string, unknown>)[field] ?? '');
      const newVal = String(notaData[field] ?? '');
      if (oldVal !== newVal) {
        histEntries.push({
          notaFiscalId: params.id,
          campoAlterado: field,
          valorAntigo: oldVal,
          valorNovo: newVal,
          usuario: 'Sistema',
        });
      }
    }

    const parseDate = (d: string | null | undefined) => (d ? new Date(d) : null);

    const [nota] = await prisma.$transaction([
      prisma.notaFiscal.update({
        where: { id: params.id },
        data: {
          ...notaData,
          dataEmissao: parseDate(notaData.dataEmissao),
          dataFatoGerador: parseDate(notaData.dataFatoGerador),
          dataVencimento: parseDate(notaData.dataVencimento),
          dataRecebimento: parseDate(notaData.dataRecebimento),
          prestadorId: prestadorId || undefined,
          tomadorId: tomadorId || undefined,
        },
        include: { prestador: true, tomador: true, historico: { orderBy: { dataAcao: 'desc' }, take: 20 } },
      }),
      ...(histEntries.length > 0
        ? [prisma.historicoAlteracao.createMany({ data: histEntries })]
        : []),
    ]);

    return NextResponse.json(nota);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Erro ao atualizar nota' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await prisma.notaFiscal.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Erro ao excluir nota' }, { status: 500 });
  }
}
