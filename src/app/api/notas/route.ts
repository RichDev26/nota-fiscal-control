import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
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

    const where: Record<string, unknown> = {};

    if (status) where.status = status;

    if (dataInicio || dataFim) {
      where.dataEmissao = {
        ...(dataInicio ? { gte: new Date(dataInicio) } : {}),
        ...(dataFim ? { lte: new Date(dataFim + 'T23:59:59') } : {}),
      };
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { prestador: prestadorData, tomador: tomadorData, ...notaData } = body;

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

    // Parse dates
    const parseDate = (d: string | null | undefined) => (d ? new Date(d) : null);

    const nota = await prisma.notaFiscal.create({
      data: {
        ...notaData,
        dataEmissao: parseDate(notaData.dataEmissao),
        dataFatoGerador: parseDate(notaData.dataFatoGerador),
        dataVencimento: parseDate(notaData.dataVencimento),
        dataRecebimento: parseDate(notaData.dataRecebimento),
        prestadorId: prestadorId || notaData.prestadorId || undefined,
        tomadorId: tomadorId || notaData.tomadorId || undefined,
      },
      include: { prestador: true, tomador: true },
    });

    // Verificar duplicidade de número de NF
    if (nota.numeroNf) {
      const dup = await prisma.notaFiscal.count({
        where: { numeroNf: nota.numeroNf, id: { not: nota.id } },
      });
      if (dup > 0) {
        return NextResponse.json({ nota, aviso: `Atenção: já existe outra nota com o número ${nota.numeroNf}` });
      }
    }

    return NextResponse.json({ nota }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Erro ao criar nota' }, { status: 500 });
  }
}
