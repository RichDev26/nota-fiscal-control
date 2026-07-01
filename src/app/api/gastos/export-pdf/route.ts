import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { formatarMoeda, formatarData } from '@/lib/validators';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const dataInicio = searchParams.get('dataInicio') || '';
    const dataFim    = searchParams.get('dataFim')    || '';

    const where: Record<string, unknown> = { usuarioId: session.sub };
    if (dataInicio || dataFim) {
      where.data = {
        ...(dataInicio ? { gte: new Date(dataInicio) } : {}),
        ...(dataFim    ? { lte: new Date(dataFim + 'T23:59:59') } : {}),
      };
    }

    const gastos = await prisma.gasto.findMany({ where, orderBy: { data: 'asc' } });
    const total  = gastos.reduce((s, g) => s + (g.valor || 0), 0);

    const periodoLabel = [
      dataInicio ? `De: ${formatarData(dataInicio)}` : '',
      dataFim ? `Até: ${formatarData(dataFim)}` : '',
    ].filter(Boolean).join(' | ') || 'Todo o período';

    const rows = gastos.map((g, i) => `
      <tr class="${i % 2 === 0 ? '' : 'alt'}">
        <td>${formatarData(g.data?.toString())}</td>
        <td>${g.descricao || '—'}</td>
        <td>${g.categoria || '—'}</td>
        <td>${g.fornecedor || '—'}</td>
        <td>${g.formaPagamento || '—'}</td>
        <td class="num">${formatarMoeda(g.valor)}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Relatório de Gastos</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #1a1a1a; padding: 20px; }
  h1 { font-size: 18px; color: #1d4ed8; margin-bottom: 4px; }
  .sub { color: #6b7280; font-size: 11px; margin-bottom: 16px; }
  .resumo { display: flex; gap: 12px; margin-bottom: 20px; }
  .card { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 10px 16px; flex: 1; }
  .card-label { font-size: 9px; text-transform: uppercase; color: #3b82f6; font-weight: 700; }
  .card-value { font-size: 15px; font-weight: 700; color: #1e3a8a; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: #1d4ed8; color: white; padding: 6px 8px; text-align: left; font-size: 10px; text-transform: uppercase; }
  td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  tr.alt td { background: #f8fafc; }
  td.num { text-align: right; }
  tfoot td { font-weight: 700; font-size: 13px; border-top: 2px solid #1d4ed8; padding-top: 8px; }
  .footer { margin-top: 20px; font-size: 9px; color: #9ca3af; text-align: center; }
  @media print { body { padding: 10px; } }
</style>
</head>
<body>
<h1>Relatório de Gastos</h1>
<p class="sub">${periodoLabel} | Gerado em: ${new Date().toLocaleString('pt-BR')} | Total: ${gastos.length} gasto(s)</p>
<div class="resumo">
  <div class="card"><div class="card-label">Total Gasto</div><div class="card-value">${formatarMoeda(total)}</div></div>
  <div class="card"><div class="card-label">Qtd. Gastos</div><div class="card-value">${gastos.length}</div></div>
</div>
<table>
  <thead>
    <tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Fornecedor</th><th>Pagamento</th><th>Valor</th></tr>
  </thead>
  <tbody>${rows}</tbody>
  <tfoot>
    <tr><td colspan="5">TOTAL DO PERÍODO</td><td class="num">${formatarMoeda(total)}</td></tr>
  </tfoot>
</table>
<div class="footer">NF Control — Relatório de gastos gerado automaticamente</div>
</body>
</html>`;

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="relatorio_gastos.html"`,
      },
    });
  } catch (err) {
    console.error('[GET /api/gastos/export-pdf]', err);
    return NextResponse.json({ error: 'Erro ao exportar relatório' }, { status: 500 });
  }
}
