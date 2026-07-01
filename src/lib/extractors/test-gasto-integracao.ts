/**
 * Fase Gastos+Extrator — verifica que a aba de Gastos usa o MESMO pipeline das
 * Notas e como o extrator atual (NFS-e) se comporta diante do documento de gasto.
 * Execução: npx tsx src/lib/extractors/test-gasto-integracao.ts
 *
 * NÃO altera o extrator. Só roda extractFromPdfBuffer (o mesmo de /api/pdf-extract)
 * e aplica o mesmo mapeamento PdfExtractResult → Gasto usado no /gastos/novo.
 */
import fs   from 'fs';
import path from 'path';
import { extractFromPdfBuffer } from './integrador';
import { parseDateBR } from '@/lib/validators';
import type { PdfExtractResult } from '@/types';

const PDF = path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', 'Downloads', 'MODELO GASTO.pdf');

// Mesmo mapeamento do componente /gastos/novo (aplicarExtracao).
function mapear(d: PdfExtractResult) {
  const forn = d.prestador?.nomeRazaoSocial || d.prestador?.nomeFantasia || null;
  const dt   = d.dataEmissao ? parseDateBR(d.dataEmissao) : null;
  const produtos = (d.descricao || d.valorUnitario != null || d.quantidade != null) ? [{
    descricao: d.descricao ?? null, quantidade: d.quantidade ?? null, unidade: null,
    valorUnitario: d.valorUnitario ?? null, valorTotal: d.valorBruto ?? null,
  }] : [];
  return {
    fornecedor:      forn,
    fornecedorCnpj:  d.prestador?.cpfCnpj ?? null,
    numeroDocumento: d.numeroNf ?? null,
    serieDocumento:  null,                                  // NFS-e não tem série
    data:            dt ? dt.toISOString().split('T')[0] : null,
    valor:           d.valorBruto ?? null,
    descricao:       d.descricao ?? (forn ? `Compra — ${forn}` : null),
    produtos,
  };
}

(async () => {
  if (!fs.existsSync(PDF)) { console.log('PDF modelo não encontrado:', PDF); process.exit(0); }
  const buf = fs.readFileSync(PDF);

  let result: PdfExtractResult;
  try {
    result = await extractFromPdfBuffer(buf) as PdfExtractResult;
  } catch (e) {
    console.log('⚠️  Extrator lançou erro neste documento (comportamento a observar):', (e as Error).message);
    process.exit(0);
  }

  const gasto = mapear(result);
  console.log('── MAPEAMENTO PdfExtractResult → Gasto (extrator atual sobre MODELO GASTO.pdf) ──\n');
  for (const [k, v] of Object.entries(gasto)) {
    if (k === 'produtos') { console.log(`  ${k.padEnd(16)}: ${(v as unknown[]).length} item(ns)`, JSON.stringify(v)); continue; }
    console.log(`  ${k.padEnd(16)}: ${v ?? '—'}`);
  }
  const preenchidos = Object.entries(gasto).filter(([k, v]) => k !== 'produtos' && v).length;
  console.log(`\n  → ${preenchidos} campo(s) de cabeçalho preenchido(s) pelo pipeline existente.`);
  console.log('  (Extrator NFS-e não-ajustado — a evolução p/ DANFE é a próxima fase.)');
})();
