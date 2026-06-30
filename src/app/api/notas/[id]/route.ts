import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { parseDateBR } from '@/lib/validators';

export const dynamic = 'force-dynamic';

// ── Campos Float (precisam de conversão string→number) ────────────────────────
const FLOAT_FIELDS = new Set([
  'valorBruto', 'valorLiquido', 'aliquota', 'valorIss', 'baseCalculo',
  'valorLiquidoAntecipacao', 'valorTotalTributosAntecipacao',
  'ir', 'pisPasep', 'cofins', 'inss', 'csll', 'outrasRetencoes',
  'valorAproximadoTributos', 'quantidade', 'valorUnitario',
]);

// ── Campos válidos no schema do Prisma ────────────────────────────────────────
const NOTA_FIELDS = new Set([
  'nomeOrganizador', 'tipo', 'numeroNf', 'numeroRps', 'codigoVerificacao', 'of', 'descricao',
  'municipioEmissor', 'codigoServico', 'status',
  'naturezaOperacao', 'situacaoTributariaIssqn', 'localPrestacao', 'situacaoNfse',
  'regimeTributario', 'indicacaoRetencao', 'observacoesFiscais', 'observacoesAutenticidade',
  'observacoes', 'arquivoPdfUrl', 'pdfData', 'tags', 'notaSubstitutivaId',
  'valorBruto', 'valorLiquido', 'aliquota', 'valorIss', 'baseCalculo',
  'valorLiquidoAntecipacao', 'valorTotalTributosAntecipacao',
  'ir', 'pisPasep', 'cofins', 'inss', 'csll', 'outrasRetencoes', 'valorAproximadoTributos',
  'quantidade', 'valorUnitario',
  // datas são tratadas separadamente
  'dataEmissao', 'dataFatoGerador', 'dataVencimento', 'dataRecebimento',
]);

function sanitizeUpdate(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!NOTA_FIELDS.has(k)) continue; // descarta campos desconhecidos
    if (FLOAT_FIELDS.has(k)) {
      // '' | null | undefined → null; strings numéricas → number
      if (v == null || v === '' || v === 'null') {
        out[k] = null;
      } else {
        const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\./g, '').replace(',', '.'));
        out[k] = isNaN(n) ? null : n;
      }
    } else {
      out[k] = (v === '' || v === undefined) ? null : v;
    }
  }
  return out;
}

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  try {
    const nota = await prisma.notaFiscal.findUnique({
      where: { id: params.id },
      include: {
        prestador: true,
        tomador: true,
        historico: { orderBy: { dataAcao: 'desc' }, take: 50 },
        impostos: true,
        notaSubstitutiva: { include: { prestador: true, tomador: true } },
        notasSubstituidas: true,
      },
    });

    if (!nota) return NextResponse.json({ error: 'Nota não encontrada' }, { status: 404 });
    if (nota.usuarioId && nota.usuarioId !== session.sub)
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });

    // Não trafegar pdfData (base64 pode ser vários MB)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { pdfData: _pdf, ...notaSemPdf } = nota as typeof nota & { pdfData?: string };
    return NextResponse.json({ ...notaSemPdf, hasPdf: !!nota.pdfData });
  } catch (err) {
    console.error('[GET /api/notas/[id]]', err);
    return NextResponse.json({ error: 'Erro ao buscar nota' }, { status: 500 });
  }
}

// ── PUT ───────────────────────────────────────────────────────────────────────
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  try {
    const body = await req.json();
    const {
      prestador: prestadorData,
      tomador: tomadorData,
      historico: _h,
      impostos: _i,
      notaSubstitutiva: _ns,
      notasSubstituidas: _nss,
      hasPdf: _hp,
      id: _id,
      createdAt: _ca,
      updatedAt: _ua,
      prestadorId: _pid,
      tomadorId: _tid,
      ...rawNotaData
    } = body;

    const notaAtual = await prisma.notaFiscal.findUnique({ where: { id: params.id } });
    if (!notaAtual) return NextResponse.json({ error: 'Nota não encontrada' }, { status: 404 });
    if (notaAtual.usuarioId && notaAtual.usuarioId !== session.sub)
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });

    // ── Upsert Prestador
    let prestadorId = notaAtual.prestadorId;
    if (prestadorData) {
      const { id: pId, createdAt: _pc, updatedAt: _pu, ...pRest } = prestadorData;
      if (pId) {
        await prisma.pessoaFiscal.update({ where: { id: pId }, data: pRest });
        prestadorId = pId;
      } else if (Object.values(pRest).some(Boolean)) {
        const p = await prisma.pessoaFiscal.create({ data: pRest });
        prestadorId = p.id;
      }
    }

    // ── Upsert Tomador
    let tomadorId = notaAtual.tomadorId;
    if (tomadorData) {
      const { id: tId, createdAt: _tc, updatedAt: _tu, ...tRest } = tomadorData;
      if (tId) {
        await prisma.pessoaFiscal.update({ where: { id: tId }, data: tRest });
        tomadorId = tId;
      } else if (Object.values(tRest).some(Boolean)) {
        const t = await prisma.pessoaFiscal.create({ data: tRest });
        tomadorId = t.id;
      }
    }

    // ── Sanitize data
    const notaData = sanitizeUpdate(rawNotaData);

    // ── Histórico de alterações
    const fieldsToTrack = ['status', 'valorBruto', 'valorLiquido', 'dataRecebimento', 'observacoes'];
    const histEntries = [];
    for (const field of fieldsToTrack) {
      const oldVal = String((notaAtual as Record<string, unknown>)[field] ?? '');
      const newVal = String(notaData[field] ?? rawNotaData[field] ?? '');
      if (oldVal !== newVal) {
        histEntries.push({
          notaFiscalId: params.id,
          campoAlterado: field,
          valorAntigo: oldVal,
          valorNovo: newVal,
          usuario: session.nome,
        });
      }
    }

    // Determinístico (ver parseDateBR): aceita BR "DD/MM/AAAA" e ISO, valida
    // calendário, nunca usa new Date() sobre string ambígua.
    const parseDate = (v: unknown) => parseDateBR(typeof v === 'string' ? v : null);

    const [nota] = await prisma.$transaction([
      prisma.notaFiscal.update({
        where: { id: params.id },
        data: {
          ...notaData,
          ...('dataEmissao'     in rawNotaData ? { dataEmissao:     parseDate(rawNotaData.dataEmissao) }     : {}),
          ...('dataFatoGerador' in rawNotaData ? { dataFatoGerador: parseDate(rawNotaData.dataFatoGerador) } : {}),
          ...('dataVencimento'  in rawNotaData ? { dataVencimento:  parseDate(rawNotaData.dataVencimento) }  : {}),
          ...('dataRecebimento' in rawNotaData ? { dataRecebimento: parseDate(rawNotaData.dataRecebimento) } : {}),
          prestadorId: prestadorId || undefined,
          tomadorId:   tomadorId   || undefined,
        },
        include: {
          prestador: true,
          tomador: true,
          historico: { orderBy: { dataAcao: 'desc' }, take: 20 },
        },
      }),
      ...(histEntries.length > 0
        ? [prisma.historicoAlteracao.createMany({ data: histEntries })]
        : []),
    ]);

    return NextResponse.json(nota);
  } catch (err) {
    console.error('[PUT /api/notas/[id]]', err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'Erro ao atualizar nota', detail }, { status: 500 });
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  try {
    const nota = await prisma.notaFiscal.findUnique({ where: { id: params.id }, select: { usuarioId: true } });
    if (!nota) return NextResponse.json({ error: 'Nota não encontrada' }, { status: 404 });
    if (nota.usuarioId && nota.usuarioId !== session.sub)
      return NextResponse.json({ error: 'Acesso negado' }, { status: 403 });

    await prisma.notaFiscal.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/notas/[id]]', err);
    return NextResponse.json({ error: 'Erro ao excluir nota' }, { status: 500 });
  }
}
