import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { calcularServico } from '@/lib/servico-calc';

export const dynamic = 'force-dynamic';

// ── GET: lista de serviços (com totais calculados) ─────────────────────────────
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || '';

    const where: Record<string, unknown> = { usuarioId: session.sub };
    if (status) where.status = status;

    const servicos = await prisma.servico.findMany({
      where,
      include: { gastos: { select: { valor: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const parsed = servicos.map(({ gastos, ...s }) => ({
      ...s,
      ...calcularServico(s.valorContratado, gastos),
    }));

    return NextResponse.json(parsed);
  } catch (err) {
    console.error('[GET /api/servicos]', err);
    return NextResponse.json({ error: 'Erro ao buscar serviços' }, { status: 500 });
  }
}

// ── POST: cria um serviço ───────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  try {
    const body = await req.json();
    const nome = String(body.nome ?? '').trim();
    const valorContratado = typeof body.valorContratado === 'number'
      ? body.valorContratado
      : parseFloat(String(body.valorContratado ?? '').replace(/\./g, '').replace(',', '.'));

    if (!nome) return NextResponse.json({ error: 'Nome do serviço é obrigatório.' }, { status: 400 });
    if (!isFinite(valorContratado) || valorContratado <= 0) {
      return NextResponse.json({ error: 'Valor total do serviço é obrigatório.' }, { status: 400 });
    }

    const servico = await prisma.servico.create({
      data: { nome, valorContratado, usuarioId: session.sub },
    });

    return NextResponse.json({ ...servico, ...calcularServico(valorContratado, []) }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/servicos]', err);
    return NextResponse.json({ error: 'Erro ao criar serviço' }, { status: 500 });
  }
}
