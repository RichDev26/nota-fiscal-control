import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';
import { exportarRelatorioExcel } from '@/lib/excel-export';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const dataInicio = searchParams.get('dataInicio') || '';
    const dataFim = searchParams.get('dataFim') || '';
    const status = searchParams.get('status') || '';

    const where: Record<string, unknown> = {};
    if (dataInicio || dataFim) {
      where.dataEmissao = {
        ...(dataInicio ? { gte: new Date(dataInicio) } : {}),
        ...(dataFim ? { lte: new Date(dataFim + 'T23:59:59') } : {}),
      };
    }
    if (status) where.status = status;

    const notas = await prisma.notaFiscal.findMany({
      where,
      include: { prestador: true, tomador: true },
      orderBy: { dataEmissao: 'asc' },
    });

    const buffer = exportarRelatorioExcel(
      notas as unknown as Parameters<typeof exportarRelatorioExcel>[0],
      { inicio: dataInicio, fim: dataFim }
    );

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="relatorio_nf_${dataInicio || 'todos'}_${dataFim || 'todos'}.xlsx"`,
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Erro ao exportar Excel' }, { status: 500 });
  }
}
