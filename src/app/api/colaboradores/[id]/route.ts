import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { parseDateBR } from '@/lib/validators';
import { serializarColaborador } from '@/lib/colaboradores/serializar';

export const dynamic = 'force-dynamic';

async function ownedColaborador(id: string, userId: string) {
  const c = await prisma.colaborador.findUnique({ where: { id }, include: { documentos: true } });
  if (!c) return { error: NextResponse.json({ error: 'Colaborador não encontrado' }, { status: 404 }) };
  if (c.usuarioId && c.usuarioId !== userId)
    return { error: NextResponse.json({ error: 'Acesso negado' }, { status: 403 }) };
  return { colaborador: c };
}

// ── GET ─────────────────────────────────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const owned = await ownedColaborador(params.id, session.sub);
  if ('error' in owned) return owned.error;

  return NextResponse.json(serializarColaborador(owned.colaborador));
}

// ── PUT: edita nome e/ou datas — datas alteradas resetam notificações já enviadas
//         daquele documento, para que o sweep as recalcule contra a nova data ───
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const owned = await ownedColaborador(params.id, session.sub);
  if ('error' in owned) return owned.error;
  const atual = owned.colaborador;

  try {
    const body = await req.json();
    const dataColaborador: Record<string, unknown> = {};
    if ('nome' in body) {
      const nome = String(body.nome).trim();
      if (!nome) return NextResponse.json({ error: 'Nome do colaborador é obrigatório.' }, { status: 400 });
      dataColaborador.nome = nome;
    }

    const CAMPOS_POR_TIPO: Record<string, { inicio: string; fim: string }> = {
      INTEGRACAO: { inicio: 'integracaoInicio', fim: 'integracaoFim' },
      ASO:        { inicio: 'asoInicio',        fim: 'asoFim' },
    };

    const docUpdates: { id: string; dataInicio: Date; dataFim: Date; mudou: boolean }[] = [];

    for (const [tipo, campos] of Object.entries(CAMPOS_POR_TIPO)) {
      if (!(campos.inicio in body) && !(campos.fim in body)) continue;
      const doc = atual.documentos.find(d => d.tipo === tipo);
      if (!doc) continue;

      const novoInicio = campos.inicio in body ? parseDateBR(body[campos.inicio]) : doc.dataInicio;
      const novoFim     = campos.fim    in body ? parseDateBR(body[campos.fim])    : doc.dataFim;
      if (!novoInicio || !novoFim) {
        return NextResponse.json({ error: `Datas inválidas para ${tipo === 'INTEGRACAO' ? 'Integração' : 'ASO'}.` }, { status: 400 });
      }
      if (novoFim < novoInicio) {
        return NextResponse.json({ error: `A data final ${tipo === 'INTEGRACAO' ? 'da Integração' : 'do ASO'} não pode ser anterior à data inicial.` }, { status: 400 });
      }

      const mudou = novoInicio.getTime() !== doc.dataInicio.getTime() || novoFim.getTime() !== doc.dataFim.getTime();
      docUpdates.push({ id: doc.id, dataInicio: novoInicio, dataFim: novoFim, mudou });
    }

    await prisma.$transaction([
      ...(Object.keys(dataColaborador).length
        ? [prisma.colaborador.update({ where: { id: params.id }, data: dataColaborador })]
        : []),
      ...docUpdates.map(u =>
        prisma.documentoColaborador.update({ where: { id: u.id }, data: { dataInicio: u.dataInicio, dataFim: u.dataFim } }),
      ),
      // Datas mudaram → limpa o histórico de envio; o sweep recalcula do zero contra a nova data.
      ...docUpdates.filter(u => u.mudou).map(u =>
        prisma.notificacaoDocumento.deleteMany({ where: { documentoColaboradorId: u.id } }),
      ),
    ]);

    const atualizado = await prisma.colaborador.findUnique({ where: { id: params.id }, include: { documentos: true } });
    return NextResponse.json(serializarColaborador(atualizado!));
  } catch (err) {
    console.error('[PUT /api/colaboradores/[id]]', err);
    return NextResponse.json({ error: 'Erro ao atualizar colaborador' }, { status: 500 });
  }
}

// ── DELETE — cascade no schema remove documentos + notificações automaticamente ─
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const owned = await ownedColaborador(params.id, session.sub);
  if ('error' in owned) return owned.error;

  try {
    await prisma.colaborador.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/colaboradores/[id]]', err);
    return NextResponse.json({ error: 'Erro ao excluir colaborador' }, { status: 500 });
  }
}
