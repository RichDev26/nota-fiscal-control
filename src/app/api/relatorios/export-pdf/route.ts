import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';
import { formatarMoeda, formatarData, formatarAliquota } from '@/lib/validators';
import { STATUS_LABELS } from '@/types';

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

    const totalBruto = notas.reduce((s, n) => s + (n.valorBruto || 0), 0);
    const totalLiquido = notas.reduce((s, n) => s + (n.valorLiquido || 0), 0);
    const totalIss = notas.reduce((s, n) => s + (n.valorIss || 0), 0);

    const periodoLabel = [
      dataInicio ? `De: ${formatarData(dataInicio)}` : '',
      dataFim ? `Até: ${formatarData(dataFim)}` : '',
    ]
      .filter(Boolean)
      .join(' | ') || 'Todo o período';

    const rows = notas
      .map(
        (n, i) => `
      <tr class="${i % 2 === 0 ? '' : 'alt'}">
        <td>${formatarData(n.dataEmissao?.toString())}</td>
        <td>${n.numeroNf || '—'}</td>
        <td>${n.nomeOrganizador || '—'}</td>
        <td>${n.tomador?.nomeRazaoSocial || n.tomador?.nomeFantasia || '—'}</td>
        <td>${n.descricao?.slice(0, 40) || '—'}</td>
        <td class="num">${formatarMoeda(n.valorBruto)}</td>
        <td class="num">${formatarMoeda(n.valorLiquido)}</td>
        <td class="num">${formatarAliquota(n.aliquota)}</td>
        <td class="num">${formatarMoeda(n.valorIss)}</td>
        <td>${STATUS_LABELS[n.status] || n.status}</td>
        <td>${formatarData(n.dataVencimento?.toString())}</td>
      </tr>`
      )
      .join('');

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Relatório de Notas Fiscais</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 10px; color: #1a1a1a; padding: 20px; }
  h1 { font-size: 18px; color: #1d4ed8; margin-bottom: 4px; }
  .sub { color: #6b7280; font-size: 11px; margin-bottom: 16px; }
  .resumo { display: flex; gap: 12px; margin-bottom: 20px; }
  .card { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 10px 16px; flex: 1; }
  .card-label { font-size: 9px; text-transform: uppercase; color: #3b82f6; font-weight: 700; }
  .card-value { font-size: 15px; font-weight: 700; color: #1e3a8a; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: #1d4ed8; color: white; padding: 6px 8px; text-align: left; font-size: 9px; text-transform: uppercase; }
  td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  tr.alt td { background: #f8fafc; }
  td.num { text-align: right; }
  .footer { margin-top: 20px; font-size: 9px; color: #9ca3af; text-align: center; }
  @media print { body { padding: 10px; } }
</style>
</head>
<body>
<h1>Relatório de Notas Fiscais</h1>
<p class="sub">${periodoLabel} | Gerado em: ${new Date().toLocaleString('pt-BR')} | Total: ${notas.length} notas</p>
<div class="resumo">
  <div class="card"><div class="card-label">Total Bruto</div><div class="card-value">${formatarMoeda(totalBruto)}</div></div>
  <div class="card"><div class="card-label">Total Líquido</div><div class="card-value">${formatarMoeda(totalLiquido)}</div></div>
  <div class="card"><div class="card-label">Total ISS</div><div class="card-value">${formatarMoeda(totalIss)}</div></div>
  <div class="card"><div class="card-label">Total Notas</div><div class="card-value">${notas.length}</div></div>
</div>
<table>
  <thead>
    <tr>
      <th>Emissão</th><th>Nº NF</th><th>Nome</th><th>Tomador</th><th>Descrição</th>
      <th>V. Bruto</th><th>V. Líquido</th><th>Alíq.</th><th>ISS</th><th>Status</th><th>Vencimento</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>
<div class="footer">NF Control — Relatório gerado automaticamente</div>
</body>
</html>`;

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="relatorio_nf.html"`,
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Erro ao exportar PDF' }, { status: 500 });
  }
}
