import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { parseDateBR } from '@/lib/validators';
import { serializarColaborador } from '@/lib/colaboradores/serializar';

export const dynamic = 'force-dynamic';

// ── GET: lista de colaboradores (com status calculado) ─────────────────────────
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  try {
    const colaboradores = await prisma.colaborador.findMany({
      where: { usuarioId: session.sub },
      include: { documentos: true },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(colaboradores.map(serializarColaborador));
  } catch (err) {
    console.error('[GET /api/colaboradores]', err);
    return NextResponse.json({ error: 'Erro ao buscar colaboradores' }, { status: 500 });
  }
}

// ── POST: cria um colaborador com Integração e ASO ──────────────────────────────
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  try {
    const body = await req.json();
    const nome = String(body.nome ?? '').trim();
    if (!nome) return NextResponse.json({ error: 'Nome do colaborador é obrigatório.' }, { status: 400 });

    const integracaoInicio = parseDateBR(body.integracaoInicio);
    const integracaoFim    = parseDateBR(body.integracaoFim);
    const asoInicio        = parseDateBR(body.asoInicio);
    const asoFim           = parseDateBR(body.asoFim);

    if (!integracaoInicio || !integracaoFim) {
      return NextResponse.json({ error: 'Datas de início e fim da Integração são obrigatórias.' }, { status: 400 });
    }
    if (!asoInicio || !asoFim) {
      return NextResponse.json({ error: 'Datas de início e fim do ASO são obrigatórias.' }, { status: 400 });
    }
    if (integracaoFim < integracaoInicio) {
      return NextResponse.json({ error: 'A data final da Integração não pode ser anterior à data inicial.' }, { status: 400 });
    }
    if (asoFim < asoInicio) {
      return NextResponse.json({ error: 'A data final do ASO não pode ser anterior à data inicial.' }, { status: 400 });
    }

    const colaborador = await prisma.colaborador.create({
      data: {
        nome,
        usuarioId: session.sub,
        documentos: {
          create: [
            { tipo: 'INTEGRACAO', dataInicio: integracaoInicio, dataFim: integracaoFim },
            { tipo: 'ASO',        dataInicio: asoInicio,        dataFim: asoFim },
          ],
        },
      },
      include: { documentos: true },
    });

    return NextResponse.json(serializarColaborador(colaborador), { status: 201 });
  } catch (err) {
    console.error('[POST /api/colaboradores]', err);
    return NextResponse.json({ error: 'Erro ao criar colaborador' }, { status: 500 });
  }
}
