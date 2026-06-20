/**
 * POST /api/fila/admin — operações administrativas da fila
 *
 * Body: { acao: 'recovery' | 'purgar' | 'status_recovery', diasRetencao?: number }
 *
 * recovery        — detecta e recupera jobs presos/trabalhadores mortos
 * purgar          — remove jobs CONCLUIDO/CANCELADO mais antigos que diasRetencao dias
 * status_recovery — retorna diagnóstico sem executar recovery
 */
import { NextRequest, NextResponse } from 'next/server';
import { executarRecovery, statusRecovery } from '@/lib/fila/recovery';
import { purgarJobsConcluidos } from '@/lib/fila/fila-manager';
import { purgarMetricasAntigas } from '@/lib/fila/monitoramento';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { acao, diasRetencao = 30 } = body;

    switch (acao) {
      case 'recovery': {
        const resultado = await executarRecovery();
        return NextResponse.json({ acao, resultado });
      }

      case 'purgar': {
        const [jobsPurgados, metricasPurgadas] = await Promise.all([
          purgarJobsConcluidos(diasRetencao),
          purgarMetricasAntigas(diasRetencao),
        ]);
        return NextResponse.json({ acao, jobsPurgados, metricasPurgadas, diasRetencao });
      }

      case 'status_recovery': {
        const status = await statusRecovery();
        return NextResponse.json({ acao, status });
      }

      default:
        return NextResponse.json(
          { error: `Ação inválida. Use: recovery | purgar | status_recovery` },
          { status: 400 },
        );
    }
  } catch (err) {
    console.error('[POST /api/fila/admin]', err);
    return NextResponse.json({ error: 'Erro na operação administrativa' }, { status: 500 });
  }
}
