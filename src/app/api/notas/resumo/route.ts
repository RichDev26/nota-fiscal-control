import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  try {
    const now = new Date();
    const mesInicio = new Date(now.getFullYear(), now.getMonth(), 1);
    const mesFim    = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const [todasNotas, notasMes] = await Promise.all([
      prisma.notaFiscal.findMany({
        where: { usuarioId: session.sub },
        select: { valorBruto: true },
      }),
      prisma.notaFiscal.findMany({
        where: {
          usuarioId: session.sub,
          OR: [
            { dataEmissao: { gte: mesInicio, lte: mesFim } },
            { dataEmissao: null, createdAt: { gte: mesInicio, lte: mesFim } },
          ],
        },
        select: { valorBruto: true, valorLiquido: true },
      }),
    ]);

    return NextResponse.json({
      countMes:   notasMes.length,
      brutoBruto: notasMes.reduce((s, n) => s + (n.valorBruto  ?? 0), 0),
      brutoLiq:   notasMes.reduce((s, n) => s + (n.valorLiquido ?? 0), 0),
      totalGeral: todasNotas.reduce((s, n) => s + (n.valorBruto ?? 0), 0),
      totalNotas: todasNotas.length,
    });
  } catch (err) {
    console.error('[GET /api/notas/resumo]', err);
    return NextResponse.json({ error: 'Erro ao buscar resumo' }, { status: 500 });
  }
}
