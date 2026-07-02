import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { calcularServico } from '@/lib/servico-calc';

export const dynamic = 'force-dynamic';

async function ownedServico(id: string, userId: string) {
  const s = await prisma.servico.findUnique({ where: { id } });
  if (!s) return { error: NextResponse.json({ error: 'Serviço não encontrado' }, { status: 404 }) };
  if (s.usuarioId && s.usuarioId !== userId)
    return { error: NextResponse.json({ error: 'Acesso negado' }, { status: 403 }) };
  return { servico: s };
}

// ── GET: detalhe do serviço + gastos vinculados ────────────────────────────────
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const owned = await ownedServico(params.id, session.sub);
  if ('error' in owned) return owned.error;

  const servico = await prisma.servico.findUnique({
    where: { id: params.id },
    include: { gastos: { orderBy: { data: 'desc' } } },
  });
  if (!servico) return NextResponse.json({ error: 'Serviço não encontrado' }, { status: 404 });

  const { gastos, ...s } = servico;
  const gastosParsed = gastos.map(g => ({
    ...g,
    anexos:   g.anexos   ? JSON.parse(g.anexos)   : [],
    produtos: g.produtos ? JSON.parse(g.produtos) : [],
  }));

  return NextResponse.json({ ...s, ...calcularServico(s.valorContratado, gastos), gastos: gastosParsed });
}

// ── PUT: editar nome/valor ou mudar status (ex: Marcar como Concluído) ────────
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const owned = await ownedServico(params.id, session.sub);
  if ('error' in owned) return owned.error;

  try {
    const body = await req.json();
    const data: Record<string, unknown> = {};

    if ('nome' in body) data.nome = String(body.nome).trim();
    if ('status' in body && ['em_andamento', 'concluido'].includes(body.status)) data.status = body.status;
    if ('gestor' in body)          data.gestor          = body.gestor          ? String(body.gestor).trim()          : null;
    if ('comprador' in body)       data.comprador       = body.comprador       ? String(body.comprador).trim()       : null;
    if ('numeroOF' in body)        data.numeroOF        = body.numeroOF        ? String(body.numeroOF).trim()        : null;
    if ('numeroOrcamento' in body) data.numeroOrcamento = body.numeroOrcamento ? String(body.numeroOrcamento).trim() : null;
    if ('valorContratado' in body) {
      const v = typeof body.valorContratado === 'number'
        ? body.valorContratado
        : parseFloat(String(body.valorContratado ?? '').replace(/\./g, '').replace(',', '.'));
      if (isFinite(v) && v > 0) data.valorContratado = v;
    }

    const servico = await prisma.servico.update({
      where: { id: params.id },
      data,
      include: { gastos: { select: { valor: true } } },
    });
    const { gastos, ...s } = servico;
    return NextResponse.json({ ...s, ...calcularServico(s.valorContratado, gastos) });
  } catch (err) {
    console.error('[PUT /api/servicos/[id]]', err);
    return NextResponse.json({ error: 'Erro ao atualizar serviço' }, { status: 500 });
  }
}
