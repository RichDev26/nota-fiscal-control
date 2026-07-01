import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { parseDateBR } from '@/lib/validators';

export const dynamic = 'force-dynamic';

async function ownedGasto(id: string, userId: string) {
  const g = await prisma.gasto.findUnique({ where: { id } });
  if (!g) return { error: NextResponse.json({ error: 'Gasto não encontrado' }, { status: 404 }) };
  if (g.usuarioId && g.usuarioId !== userId)
    return { error: NextResponse.json({ error: 'Acesso negado' }, { status: 403 }) };
  return { gasto: g };
}

// ── GET ─────────────────────────────────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const res = await ownedGasto(params.id, session.sub);
  if ('error' in res) return res.error;
  const g = res.gasto;
  return NextResponse.json({
    ...g,
    anexos:   g.anexos   ? JSON.parse(g.anexos)   : [],
    produtos: g.produtos ? JSON.parse(g.produtos) : [],
  });
}

// ── PUT ─────────────────────────────────────────────────────────────────────────
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const owned = await ownedGasto(params.id, session.sub);
  if ('error' in owned) return owned.error;

  try {
    const body = await req.json();
    const data: Record<string, unknown> = {};

    if ('descricao' in body)       data.descricao = String(body.descricao).trim();
    if ('categoria' in body)       data.categoria = body.categoria || null;
    if ('fornecedor' in body)      data.fornecedor = body.fornecedor || null;
    if ('formaPagamento' in body)  data.formaPagamento = body.formaPagamento || null;
    if ('observacoes' in body)     data.observacoes = body.observacoes || null;
    if ('data' in body)            data.data = parseDateBR(body.data) ?? undefined;
    if ('anexos' in body)          data.anexos = Array.isArray(body.anexos) && body.anexos.length ? JSON.stringify(body.anexos) : null;
    if ('fornecedorCnpj' in body)  data.fornecedorCnpj = body.fornecedorCnpj || null;
    if ('numeroDocumento' in body) data.numeroDocumento = body.numeroDocumento || null;
    if ('serieDocumento' in body)  data.serieDocumento = body.serieDocumento || null;
    if ('produtos' in body)        data.produtos = Array.isArray(body.produtos) && body.produtos.length ? JSON.stringify(body.produtos) : null;
    if ('valor' in body) {
      const v = typeof body.valor === 'number'
        ? body.valor
        : parseFloat(String(body.valor ?? '').replace(/\./g, '').replace(',', '.'));
      if (isFinite(v) && v > 0) data.valor = v;
    }

    const gasto = await prisma.gasto.update({ where: { id: params.id }, data });
    return NextResponse.json({
      ...gasto,
      anexos:   gasto.anexos   ? JSON.parse(gasto.anexos)   : [],
      produtos: gasto.produtos ? JSON.parse(gasto.produtos) : [],
    });
  } catch (err) {
    console.error('[PUT /api/gastos/[id]]', err);
    return NextResponse.json({ error: 'Erro ao atualizar gasto' }, { status: 500 });
  }
}

// ── DELETE ───────────────────────────────────────────────────────────────────────
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const owned = await ownedGasto(params.id, session.sub);
  if ('error' in owned) return owned.error;

  try {
    await prisma.gasto.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/gastos/[id]]', err);
    return NextResponse.json({ error: 'Erro ao excluir gasto' }, { status: 500 });
  }
}
