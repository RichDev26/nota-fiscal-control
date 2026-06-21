/**
 * GET  /api/fila/alertas         — lista alertas ativos
 * POST /api/fila/alertas         — resolve um alerta  { tipo: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { alertasAtivos, resolverAlerta, historicoAlertas, contarAlertasPorSeveridade } from '@/lib/fila/alertas';
import { requireFilaAdmin } from '@/lib/fila/auth-admin';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireFilaAdmin();
  if ('error' in auth) return auth.error;

  try {
    const p = new URL(req.url).searchParams;
    const incluirHistorico = p.get('historico') === 'true';
    const limiteHistorico  = Math.min(parseInt(p.get('limite') ?? '50', 10), 500);

    const [ativos, porSeveridade, historico] = await Promise.all([
      alertasAtivos(),
      contarAlertasPorSeveridade(),
      incluirHistorico ? historicoAlertas(limiteHistorico) : Promise.resolve(undefined),
    ]);

    return NextResponse.json({ ativos, porSeveridade, historico });
  } catch (err) {
    console.error('[GET /api/fila/alertas]', err);
    return NextResponse.json({ error: 'Erro ao buscar alertas' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireFilaAdmin();
  if ('error' in auth) return auth.error;

  try {
    const body = await req.json();
    const { tipo } = body;
    if (!tipo || typeof tipo !== 'string') {
      return NextResponse.json({ error: 'Campo "tipo" obrigatório' }, { status: 400 });
    }

    await resolverAlerta(tipo);
    return NextResponse.json({ ok: true, tipo });
  } catch (err) {
    console.error('[POST /api/fila/alertas]', err);
    return NextResponse.json({ error: 'Erro ao resolver alerta' }, { status: 500 });
  }
}
