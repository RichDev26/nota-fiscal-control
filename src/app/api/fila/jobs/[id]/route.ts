/**
 * GET    /api/fila/jobs/[id]  — status de um job específico
 * DELETE /api/fila/jobs/[id]  — cancela um job PENDENTE
 */
import { NextRequest, NextResponse } from 'next/server';
import { obterJob, cancelarJob } from '@/lib/fila/fila-manager';
import { requireFilaAdmin } from '@/lib/fila/auth-admin';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireFilaAdmin();
  if ('error' in auth) return auth.error;

  try {
    const job = await obterJob(params.id);
    if (!job) return NextResponse.json({ error: 'Job não encontrado' }, { status: 404 });
    return NextResponse.json({ job });
  } catch (err) {
    console.error('[GET /api/fila/jobs/[id]]', err);
    return NextResponse.json({ error: 'Erro ao buscar job' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireFilaAdmin();
  if ('error' in auth) return auth.error;

  try {
    const body = await req.json().catch(() => ({}));
    const motivo = typeof body.motivo === 'string' ? body.motivo : 'Cancelado via API';

    const job = await obterJob(params.id);
    if (!job) return NextResponse.json({ error: 'Job não encontrado' }, { status: 404 });
    if (!['PENDENTE', 'FALHA'].includes(job.status)) {
      return NextResponse.json(
        { error: `Job com status "${job.status}" não pode ser cancelado` },
        { status: 409 },
      );
    }

    await cancelarJob(params.id, motivo);
    return NextResponse.json({ ok: true, id: params.id });
  } catch (err) {
    console.error('[DELETE /api/fila/jobs/[id]]', err);
    return NextResponse.json({ error: 'Erro ao cancelar job' }, { status: 500 });
  }
}
