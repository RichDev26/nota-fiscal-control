import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { movePdf, getPdf } from '@/lib/pdf-storage';
import { getSession } from '@/lib/auth';
import { parseDateBR } from '@/lib/validators';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const busca = searchParams.get('busca') || '';
    const status = searchParams.get('status') || '';
    const dataInicio = searchParams.get('dataInicio') || '';
    const dataFim = searchParams.get('dataFim') || '';
    const pagina = parseInt(searchParams.get('pagina') || '1');
    const por = parseInt(searchParams.get('por') || '20');
    const ordenarPor = searchParams.get('ordenarPor') || 'createdAt';
    const ordem = (searchParams.get('ordem') || 'desc') as 'asc' | 'desc';

    const where: Record<string, unknown> = { usuarioId: session.sub };

    if (status) where.status = status;

    if (dataInicio || dataFim) {
      const dateFilter = {
        ...(dataInicio ? { gte: new Date(dataInicio) } : {}),
        ...(dataFim    ? { lte: new Date(dataFim + 'T23:59:59') } : {}),
      };
      where.AND = [{ OR: [{ dataEmissao: dateFilter }, { dataEmissao: null, createdAt: dateFilter }] }];
    }

    if (busca) {
      where.OR = [
        { numeroNf: { contains: busca } },
        { nomeOrganizador: { contains: busca } },
        { descricao: { contains: busca } },
        { of: { contains: busca } },
        { codigoVerificacao: { contains: busca } },
        { tomador: { nomeRazaoSocial: { contains: busca } } },
        { tomador: { cpfCnpj: { contains: busca } } },
        { prestador: { nomeRazaoSocial: { contains: busca } } },
      ];
    }

    const validOrder = ['createdAt', 'dataEmissao', 'dataVencimento', 'valorBruto', 'numeroNf'];
    const orderField = validOrder.includes(ordenarPor) ? ordenarPor : 'createdAt';

    const [notas, total] = await Promise.all([
      prisma.notaFiscal.findMany({
        where,
        include: {
          prestador: true,
          tomador: true,
        },
        orderBy: { [orderField]: ordem },
        skip: (pagina - 1) * por,
        take: por,
      }),
      prisma.notaFiscal.count({ where }),
    ]);

    return NextResponse.json({ notas, total, pagina, totalPaginas: Math.ceil(total / por) });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Erro ao buscar notas' }, { status: 500 });
  }
}

// Campos válidos no modelo NotaFiscal do Prisma
const NOTA_FIELDS = new Set([
  'nomeOrganizador','tipo','numeroNf','numeroRps','codigoVerificacao','of','descricao',
  'dataEmissao','dataFatoGerador','dataVencimento','dataRecebimento','status',
  'valorBruto','valorLiquido','aliquota','valorIss','baseCalculo',
  'valorLiquidoAntecipacao','valorTotalTributosAntecipacao',
  'ir','pisPasep','cofins','inss','csll','outrasRetencoes','valorAproximadoTributos',
  'naturezaOperacao','situacaoTributariaIssqn','localPrestacao','situacaoNfse',
  'observacoesFiscais','regimeTributario','indicacaoRetencao','observacoesAutenticidade',
  'municipioEmissor','codigoServico','quantidade','valorUnitario',
  'observacoes','arquivoPdfUrl','tags','prestadorId','tomadorId','notaSubstitutivaId','pdfTempId',
]);

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  try {
    const body = await req.json();
    const { prestador: prestadorData, tomador: tomadorData, ...rawData } = body;

    // Extrai pdfTempId antes de filtrar — não vai para o Prisma
    const pdfTempId = typeof rawData.pdfTempId === 'string' ? rawData.pdfTempId : null;

    // Remove campos desconhecidos para evitar erros do Prisma
    const notaData: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawData)) {
      if (NOTA_FIELDS.has(k) && k !== 'pdfTempId') notaData[k] = v;
    }

    let prestadorId: string | undefined;
    let tomadorId: string | undefined;

    if (prestadorData) {
      if (prestadorData.id) {
        await prisma.pessoaFiscal.update({ where: { id: prestadorData.id }, data: prestadorData });
        prestadorId = prestadorData.id;
      } else if (Object.values(prestadorData).some(Boolean)) {
        const p = await prisma.pessoaFiscal.create({ data: prestadorData });
        prestadorId = p.id;
      }
    }

    if (tomadorData) {
      if (tomadorData.id) {
        await prisma.pessoaFiscal.update({ where: { id: tomadorData.id }, data: tomadorData });
        tomadorId = tomadorData.id;
      } else if (Object.values(tomadorData).some(Boolean)) {
        const t = await prisma.pessoaFiscal.create({ data: tomadorData });
        tomadorId = t.id;
      }
    }

    // Campos numéricos — o formulário envia strings; Prisma exige Float
    const FLOAT_FIELDS = [
      'valorBruto', 'valorLiquido', 'aliquota', 'valorIss', 'baseCalculo',
      'valorLiquidoAntecipacao', 'valorTotalTributosAntecipacao',
      'ir', 'pisPasep', 'cofins', 'inss', 'csll', 'outrasRetencoes',
      'valorAproximadoTributos', 'quantidade', 'valorUnitario',
    ];
    for (const f of FLOAT_FIELDS) {
      if (f in notaData) {
        const v = notaData[f];
        if (v === '' || v == null) {
          notaData[f] = null;
        } else {
          const n = Number(v);
          notaData[f] = isNaN(n) ? null : n;  // 0 é válido — não usar || null
        }
      }
    }

    // Parse dates — notaData is Record<string, unknown>, cast para string
    const str = (v: unknown) => (v && typeof v === 'string' ? v : null);
    // Determinístico: aceita BR "DD/MM/AAAA [HH:MM:SS]" (extração) e ISO (inputs).
    // Substitui new Date(), que corrompia "09/06/2025"→set/06 e perdia "19/05/2026".
    const parseDate = (v: unknown) => parseDateBR(str(v));

    // 5.4 — Verificar duplicidade ANTES de criar (numeroNf + prestador + dataEmissao)
    const resolvedPrestadorId = prestadorId || (str(notaData.prestadorId) ?? undefined);
    const resolvedEmissao     = parseDate(notaData.dataEmissao);
    if (notaData.numeroNf && resolvedPrestadorId && resolvedEmissao) {
      const dup = await prisma.notaFiscal.findFirst({
        where: {
          numeroNf:    String(notaData.numeroNf),
          prestadorId: resolvedPrestadorId,
          dataEmissao: resolvedEmissao,
        },
        select: { id: true, numeroNf: true },
      });
      if (dup) {
        return NextResponse.json(
          { error: `Nota duplicada: NF ${dup.numeroNf} deste prestador já existe (id: ${dup.id})`, duplicadaId: dup.id },
          { status: 409 },
        );
      }
    }

    const nota = await prisma.notaFiscal.create({
      data: {
        ...notaData,
        dataEmissao:     resolvedEmissao,
        dataFatoGerador: parseDate(notaData.dataFatoGerador),
        dataVencimento:  parseDate(notaData.dataVencimento),
        dataRecebimento: parseDate(notaData.dataRecebimento),
        prestadorId: resolvedPrestadorId,
        tomadorId:   tomadorId || (str(notaData.tomadorId) ?? undefined),
        usuarioId:   session.sub,
      },
      include: { prestador: true, tomador: true },
    });

    // 4.1 — Finalizar PDF: mover de temp-{uuid} para {notaId} e persistir no DB
    if (pdfTempId) {
      const moved = movePdf(pdfTempId, nota.id);
      if (moved) {
        // Ler do disco e salvar como base64 no DB — garante acesso mesmo se o volume for resetado
        const pdfBuf = getPdf(nota.id);
        await prisma.notaFiscal.update({
          where: { id: nota.id },
          data:  {
            arquivoPdfUrl: `/api/notas/${nota.id}/pdf`,
            pdfData:       pdfBuf ? pdfBuf.toString('base64') : undefined,
          },
        });
        (nota as Record<string, unknown>).arquivoPdfUrl = `/api/notas/${nota.id}/pdf`;
      }
    }

    return NextResponse.json({ nota }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/notas]', err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'Erro ao criar nota', detail }, { status: 500 });
  }
}
