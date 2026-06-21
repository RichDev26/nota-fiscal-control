/**
 * GET  /api/fila/jobs   — lista jobs com filtro opcional de status/tipo
 * POST /api/fila/jobs   — enfileira um novo job
 */
import { NextRequest, NextResponse } from 'next/server';
import { criarJob, listarJobs, contarPorStatus } from '@/lib/fila/fila-manager';
import type { TipoJob, StatusJob } from '@/lib/fila/tipos-fila';
import { requireFilaAdmin } from '@/lib/fila/auth-admin';

export const dynamic = 'force-dynamic';

const TIPOS_VALIDOS = new Set<TipoJob>([
  'UPLOAD','PRE_PROCESSAMENTO','OCR_LEITURA','EXTRACAO','VALIDACAO',
  'CONFIANCA_CONFLITO','CORRECAO_REPROCESSAMENTO','AUDITORIA','EXPORTACAO','LIMPEZA',
]);
const STATUS_VALIDOS = new Set<StatusJob>([
  'PENDENTE','EM_PROCESSAMENTO','CONCLUIDO','FALHA','CANCELADO','DEAD_LETTER',
]);

export async function GET(req: NextRequest) {
  const auth = await requireFilaAdmin();
  if ('error' in auth) return auth.error;

  try {
    const p = new URL(req.url).searchParams;
    const status   = p.get('status') as StatusJob | null;
    const tipo     = p.get('tipo') as TipoJob | null;
    const limite   = Math.min(parseInt(p.get('limite') ?? '50', 10), 200);
    const pagina   = Math.max(1, parseInt(p.get('pagina') ?? '1', 10));

    if (status && !STATUS_VALIDOS.has(status)) {
      return NextResponse.json({ error: `Status inválido: ${status}` }, { status: 400 });
    }
    if (tipo && !TIPOS_VALIDOS.has(tipo)) {
      return NextResponse.json({ error: `Tipo inválido: ${tipo}` }, { status: 400 });
    }

    const [jobs, totais] = await Promise.all([
      listarJobs({ status: status ?? undefined, tipo: tipo ?? undefined, limite, offset: (pagina - 1) * limite }),
      contarPorStatus(),
    ]);

    return NextResponse.json({ jobs, totais, pagina, limite });
  } catch (err) {
    console.error('[GET /api/fila/jobs]', err);
    return NextResponse.json({ error: 'Erro ao listar jobs' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireFilaAdmin();
  if ('error' in auth) return auth.error;

  try {
    const body = await req.json();
    const { tipo, payload, prioridade, documentoId, arquivoHash, usuarioId, maxTentativas } = body;

    if (!tipo || !TIPOS_VALIDOS.has(tipo)) {
      return NextResponse.json({ error: `Campo "tipo" obrigatório. Valores válidos: ${Array.from(TIPOS_VALIDOS).join(', ')}` }, { status: 400 });
    }

    const job = await criarJob(
      tipo as TipoJob,
      payload ?? {},
      { prioridade, documentoId, arquivoHash, usuarioId, maxTentativas },
    );

    return NextResponse.json({ job }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/fila/jobs]', err);
    return NextResponse.json({ error: 'Erro ao criar job' }, { status: 500 });
  }
}
