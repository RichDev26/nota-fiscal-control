/**
 * POST /api/fila/jobs/[id]/retry — recoloca um job FALHA ou DEAD_LETTER na fila
 */
import { NextRequest, NextResponse } from 'next/server';
import { obterJob, recolocarNaFila } from '@/lib/fila/fila-manager';

export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const job = await obterJob(params.id);
    if (!job) return NextResponse.json({ error: 'Job não encontrado' }, { status: 404 });
    if (!['FALHA', 'DEAD_LETTER', 'CANCELADO'].includes(job.status)) {
      return NextResponse.json(
        { error: `Só é possível retentar jobs com status FALHA, DEAD_LETTER ou CANCELADO (atual: "${job.status}")` },
        { status: 409 },
      );
    }

    const recolocado = await recolocarNaFila(params.id);
    if (!recolocado) return NextResponse.json({ error: 'Falha ao recolocar job na fila' }, { status: 500 });
    return NextResponse.json({ job: recolocado });
  } catch (err) {
    console.error('[POST /api/fila/jobs/[id]/retry]', err);
    return NextResponse.json({ error: 'Erro ao retentar job' }, { status: 500 });
  }
}
