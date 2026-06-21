/**
 * GET /api/fila/metricas — relatório completo da fila: status, throughput, latência, tendências
 */
import { NextResponse } from 'next/server';
import { gerarRelatorioFila, snapshotMetricas } from '@/lib/fila/monitoramento';
import { avaliarAlertas } from '@/lib/fila/alertas';
import { jobsPresosDetectados } from '@/lib/fila/fila-manager';
import { requireFilaAdmin } from '@/lib/fila/auth-admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireFilaAdmin();
  if ('error' in auth) return auth.error;

  try {
    const [relatorio, snapshot, alertasAvaliados, jobsPresos] = await Promise.all([
      gerarRelatorioFila(),
      snapshotMetricas(),
      avaliarAlertas(),
      jobsPresosDetectados(),
    ]);

    return NextResponse.json({
      relatorio,
      snapshot,
      alertas:    alertasAvaliados,
      jobsPresos: jobsPresos.length,
    });
  } catch (err) {
    console.error('[GET /api/fila/metricas]', err);
    return NextResponse.json({ error: 'Erro ao gerar métricas' }, { status: 500 });
  }
}
