import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { parseDateBR } from '@/lib/validators';
import { verificarAcessoAssinatura } from '@/lib/assinatura/acesso';

export const dynamic = 'force-dynamic';

// ── GET: lista com busca + filtro de período ──────────────────────────────────
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  try {
    await verificarAcessoAssinatura(session.sub);
  } catch {
    return NextResponse.json({ error: 'Assinatura inativa ou trial expirado.' }, { status: 402 });
  }

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
    const parsed = gastos.map(g => ({
      ...g,
      anexos:   g.anexos   ? JSON.parse(g.anexos)   : [],
      produtos: g.produtos ? JSON.parse(g.produtos) : [],
    }));

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
    await verificarAcessoAssinatura(session.sub);
  } catch {
    return NextResponse.json({ error: 'Assinatura inativa ou trial expirado.' }, { status: 402 });
  }

  try {
    const body = await req.json();

    const valor = typeof body.valor === 'number'
      ? body.valor
      : parseFloat(String(body.valor ?? '').replace(/\./g, '').replace(',', '.'));
    if (!body.descricao || !isFinite(valor) || valor <= 0) {
      return NextResponse.json({ error: 'Descrição e valor são obrigatórios.' }, { status: 400 });
    }

    // Todo gasto pertence obrigatoriamente a um serviço em andamento.
    const servicoId = body.servicoId ? String(body.servicoId) : null;
    if (!servicoId) {
      return NextResponse.json({ error: 'Selecione um serviço para este gasto.' }, { status: 400 });
    }
    const servico = await prisma.servico.findUnique({ where: { id: servicoId } });
    if (!servico || (servico.usuarioId && servico.usuarioId !== session.sub)) {
      return NextResponse.json({ error: 'Serviço inválido.' }, { status: 400 });
    }
    if (servico.status === 'concluido') {
      return NextResponse.json({ error: 'Este serviço já foi concluído e não aceita novos gastos.' }, { status: 400 });
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
        fornecedorCnpj:  body.fornecedorCnpj  || null,
        numeroDocumento: body.numeroDocumento || null,
        serieDocumento:  body.serieDocumento  || null,
        produtos:        Array.isArray(body.produtos) && body.produtos.length ? JSON.stringify(body.produtos) : null,
        servicoId,
        usuarioId:      session.sub,
      },
    });

    return NextResponse.json({
      ...gasto,
      anexos:   gasto.anexos   ? JSON.parse(gasto.anexos)   : [],
      produtos: gasto.produtos ? JSON.parse(gasto.produtos) : [],
    }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/gastos]', err);
    return NextResponse.json({ error: 'Erro ao criar gasto' }, { status: 500 });
  }
}
