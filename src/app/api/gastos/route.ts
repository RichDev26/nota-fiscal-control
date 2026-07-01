import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { parseDateBR } from '@/lib/validators';

export const dynamic = 'force-dynamic';

// ── GET: lista com busca + filtro de período ──────────────────────────────────
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const busca      = searchParams.get('busca')      || '';
    const dataInicio = searchParams.get('dataInicio') || '';
    const dataFim    = searchParams.get('dataFim')    || '';

    const where: Record<string, unknown> = { usuarioId: session.sub };

    if (dataInicio || dataFim) {
      where.data = {
        ...(dataInicio ? { gte: new Date(dataInicio) } : {}),
        ...(dataFim    ? { lte: new Date(dataFim + 'T23:59:59') } : {}),
      };
    }

    if (busca) {
      where.OR = [
        { descricao:  { contains: busca } },
        { fornecedor: { contains: busca } },
        { categoria:  { contains: busca } },
        { observacoes:{ contains: busca } },
      ];
    }

    const gastos = await prisma.gasto.findMany({ where, orderBy: { data: 'desc' } });
    const parsed = gastos.map(g => ({ ...g, anexos: g.anexos ? JSON.parse(g.anexos) : [] }));

    return NextResponse.json(parsed);
  } catch (err) {
    console.error('[GET /api/gastos]', err);
    return NextResponse.json({ error: 'Erro ao buscar gastos' }, { status: 500 });
  }
}

// ── POST: cria um gasto ────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  try {
    const body = await req.json();

    const valor = typeof body.valor === 'number'
      ? body.valor
      : parseFloat(String(body.valor ?? '').replace(/\./g, '').replace(',', '.'));
    if (!body.descricao || !isFinite(valor) || valor <= 0) {
      return NextResponse.json({ error: 'Descrição e valor são obrigatórios.' }, { status: 400 });
    }

    const data = parseDateBR(body.data) ?? new Date();

    const gasto = await prisma.gasto.create({
      data: {
        descricao:      String(body.descricao).trim(),
        valor,
        data,
        categoria:      body.categoria      || null,
        fornecedor:     body.fornecedor      || null,
        formaPagamento: body.formaPagamento  || null,
        observacoes:    body.observacoes     || null,
        anexos:         Array.isArray(body.anexos) && body.anexos.length ? JSON.stringify(body.anexos) : null,
        usuarioId:      session.sub,
      },
    });

    return NextResponse.json({ ...gasto, anexos: gasto.anexos ? JSON.parse(gasto.anexos) : [] }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/gastos]', err);
    return NextResponse.json({ error: 'Erro ao criar gasto' }, { status: 500 });
  }
}
