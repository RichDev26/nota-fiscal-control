import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import type { ResumoRelatorio } from '@/types';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const dataInicio = searchParams.get('dataInicio') || '';
    const dataFim = searchParams.get('dataFim') || '';
    const status = searchParams.get('status') || '';

    const where: Record<string, unknown> = {};

    if (dataInicio || dataFim) {
      where.dataEmissao = {
        ...(dataInicio ? { gte: new Date(dataInicio) } : {}),
        ...(dataFim ? { lte: new Date(dataFim + 'T23:59:59') } : {}),
      };
    }

    if (status) where.status = status;

    const notas = await prisma.notaFiscal.findMany({
      where,
      include: { prestador: true, tomador: true },
      orderBy: { dataEmissao: 'asc' },
    });

    // Calcular resumo
    const totalBruto = notas.reduce((s, n) => s + (n.valorBruto || 0), 0);
    const totalLiquido = notas.reduce((s, n) => s + (n.valorLiquido || 0), 0);
    const totalIss = notas.reduce((s, n) => s + (n.valorIss || 0), 0);
    const totalTributos = notas.reduce((s, n) => s + (n.valorAproximadoTributos || 0), 0);
    const totalAntecipado = notas.reduce((s, n) => s + (n.valorLiquidoAntecipacao || 0), 0);

    const porStatus: Record<string, number> = {};
    for (const n of notas) {
      porStatus[n.status] = (porStatus[n.status] || 0) + 1;
    }

    const porTomadorMap: Record<string, { total: number; quantidade: number }> = {};
    for (const n of notas) {
      const nome = n.tomador?.nomeRazaoSocial || n.tomador?.nomeFantasia || 'Não informado';
      if (!porTomadorMap[nome]) porTomadorMap[nome] = { total: 0, quantidade: 0 };
      porTomadorMap[nome].total += n.valorBruto || 0;
      porTomadorMap[nome].quantidade += 1;
    }
    const porTomador = Object.entries(porTomadorMap)
      .map(([nome, v]) => ({ nome, ...v }))
      .sort((a, b) => b.total - a.total);

    const porMesMap: Record<string, { total: number; quantidade: number }> = {};
    for (const n of notas) {
      if (n.dataEmissao) {
        const d = new Date(n.dataEmissao);
        const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!porMesMap[mes]) porMesMap[mes] = { total: 0, quantidade: 0 };
        porMesMap[mes].total += n.valorBruto || 0;
        porMesMap[mes].quantidade += 1;
      }
    }
    const porMes = Object.entries(porMesMap)
      .map(([mes, v]) => ({ mes, ...v }))
      .sort((a, b) => a.mes.localeCompare(b.mes));

    const resumo: ResumoRelatorio = {
      periodo: { inicio: dataInicio, fim: dataFim },
      totalNotas: notas.length,
      totalBruto,
      totalLiquido,
      totalIss,
      totalTributos,
      totalAntecipado,
      porStatus,
      porTomador,
      porMes,
    };

    return NextResponse.json({ resumo, notas });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Erro ao gerar relatório' }, { status: 500 });
  }
}
