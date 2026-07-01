/**
 * Pipeline DANFE (NF-e de mercadorias) — especializado, independente do de NFS-e.
 *
 * NÃO altera nem importa lógica do pipeline de NFS-e. Reutiliza a INFRAESTRUTURA
 * compartilhada do sistema:
 *   - parseDateBR / parseNumeroBR / validarCNPJ / formatarCpfCnpj  (@/lib/validators)
 *   - stripAccents                                                  (ocr-normalizer)
 *   - extrairTabela (parser de tabelas genérico)                   (parser-tabela)
 *   - FieldResult / ConfidenceLevel                                (types)
 *
 * Extrai o cabeçalho necessário ao módulo de Gastos + a tabela de produtos, com
 * score por campo (Fase G), validação e reconciliação de totais (Fase F).
 */
import pdfParse from 'pdf-parse';
import type { PdfExtractResult, ProdutoGasto } from '@/types';
import { parseDateBR, parseNumeroBR, validarCNPJ, formatarCpfCnpj } from '@/lib/validators';
import { stripAccents } from './ocr-normalizer';
import { extrairTabela } from './parser-tabela';

function toSegments(raw: string): string[] {
  return raw.split('\n').map(s => s.trim()).filter(Boolean);
}

const RE_CNPJ = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/;
const RE_DATA = /\d{2}\/\d{2}\/\d{4}/;

/** Índice do 1º segmento cujo texto (sem acento, minúsculo) casa a regex. */
function idxLabel(segs: string[], re: RegExp): number {
  return segs.findIndex(s => re.test(stripAccents(s).toLowerCase()));
}

/** Valor logo após um rótulo: no mesmo segmento (após o rótulo) ou no próximo. */
function valorAposLabel(segs: string[], re: RegExp, valueRe?: RegExp): string | null {
  const i = idxLabel(segs, re);
  if (i === -1) return null;
  for (let j = i + 1; j < Math.min(i + 4, segs.length); j++) {
    const s = segs[j];
    if (!s) continue;
    if (valueRe) { const m = s.match(valueRe); if (m) return (m[1] ?? m[0]).trim(); }
    else return s.trim();
  }
  return null;
}

// ─── FASE C/H — Parser de UMA linha de produto da DANFE ───────────────────────
// Linha concatenada pelo iText:
//   {CÓDIGO}{DESCRIÇÃO}{NCM:8}{CST:3}{CFOP:4}{UN}{QUANT:,4}{VUNIT:,6}{VTOTAL:,2}{…ICMS}
// A descrição pode conter números ("50 X 50"); o bloco de 15 dígitos + unidade
// (letras) é a âncora que separa a descrição dos dados estruturados.
const RE_PRODUTO =
  /^(\d+?)([^\d].*?)(\d{8})(\d{3})(\d{4})([A-Za-z]{1,4})(\d+,\d{4})(\d+,\d{6})(\d+,\d{2})/;

interface ProdutoScored extends ProdutoGasto { confianca: number }

function parseProduto(registro: string): ProdutoScored | null {
  const linha = registro.replace(/\s+/g, ' ').trim();
  const m = linha.match(RE_PRODUTO);
  if (m) {
    const descricao     = m[2].trim();
    const unidade       = m[6].toUpperCase();
    const quantidade    = parseNumeroBR(m[7]);
    const valorUnitario = parseNumeroBR(m[8]);
    const valorTotal    = parseNumeroBR(m[9]);
    // Consistência do item: quant × unit ≈ total
    let confianca = 90;
    if (quantidade != null && valorUnitario != null && valorTotal != null) {
      const esperado = quantidade * valorUnitario;
      if (Math.abs(esperado - valorTotal) <= Math.max(0.05, valorTotal * 0.01)) confianca = 98;
      else confianca = 70;
    }
    return { descricao, quantidade, unidade, valorUnitario, valorTotal, confianca };
  }
  // Fallback robusto: linha de produto que não casa o layout completo →
  // guarda ao menos código + descrição, numéricos nulos (baixa confiança).
  const codeDesc = linha.match(/^(\d{4,})([^\d].{2,})/);
  if (codeDesc) {
    return { descricao: codeDesc[2].trim(), quantidade: null, unidade: null, valorUnitario: null, valorTotal: null, confianca: 40 };
  }
  return null;
}

// ─── EXTRAÇÃO PRINCIPAL ───────────────────────────────────────────────────────
export function extrairDanfeDeTexto(rawText: string): PdfExtractResult {
  const segs = toSegments(rawText);
  const conf: Record<string, number> = {};
  const inconsistencias: string[] = [];
  const baixaConfianca: string[]   = [];
  const naoEncontrados: string[]   = [];

  // ── Fornecedor (Emitente) ──
  let fornecedor = valorAposLabel(segs, /identificacao do emitente/);
  if (fornecedor) conf.fornecedor = 90;
  else { naoEncontrados.push('fornecedor'); conf.fornecedor = 0; }

  // ── CNPJ do fornecedor: 1º CNPJ ANTES do bloco "DESTINATÁRIO / REMETENTE" ──
  const idxDest = idxLabel(segs, /destinatario\s*\/?\s*remetente/);
  const limite  = idxDest === -1 ? segs.length : idxDest;
  let fornecedorCnpj: string | null = null;
  for (let i = 0; i < limite; i++) {
    const m = segs[i].match(RE_CNPJ);
    if (m) { fornecedorCnpj = m[0]; break; }
  }
  if (fornecedorCnpj) {
    conf.fornecedorCnpj = validarCNPJ(fornecedorCnpj) ? 95 : 55;
    if (!validarCNPJ(fornecedorCnpj)) { inconsistencias.push('CNPJ do fornecedor não passou na validação de dígito verificador'); baixaConfianca.push('fornecedorCnpj'); }
    fornecedorCnpj = formatarCpfCnpj(fornecedorCnpj);
  } else { naoEncontrados.push('fornecedorCnpj'); conf.fornecedorCnpj = 0; }

  // ── Destinatário (opcional — estrutura preparada, não obrigatório) ──
  let destinatarioNome: string | null = null;
  let destinatarioCnpj: string | null = null;
  if (idxDest !== -1) {
    destinatarioNome = valorAposLabel(segs.slice(idxDest), /nome\s*\/?\s*razao social/) ?? null;
    for (let i = idxDest; i < segs.length; i++) {
      const m = segs[i].match(RE_CNPJ);
      if (m && m[0] !== (fornecedorCnpj ? fornecedorCnpj.replace(/\D/g, '') : '') && formatarCpfCnpj(m[0]) !== fornecedorCnpj) { destinatarioCnpj = formatarCpfCnpj(m[0]); break; }
    }
  }

  // ── Número da nota ── "Nº. 000.370.825"
  const numeroRaw = valorAposLabel(segs, /^n[ºo°]\.?\s*[\d.]/, /([\d.]{5,})/)
    ?? (segs.join('\n').match(/n[ºo°]\.?\s*([\d.]{5,})/i)?.[1] ?? null);
  const numeroDocumento = numeroRaw ? String(parseInt(numeroRaw.replace(/\D/g, ''), 10) || '') || null : null;
  if (numeroDocumento) conf.numeroDocumento = 90; else { naoEncontrados.push('numeroDocumento'); conf.numeroDocumento = 0; }

  // ── Série ── "Série 001"
  const serieM = segs.join('\n').match(/s[ée]rie\s*:?\s*(\d{1,3})/i);
  const serieDocumento = serieM ? String(parseInt(serieM[1], 10)) : null;
  if (serieDocumento) conf.serie = 85; else { naoEncontrados.push('serie'); conf.serie = 0; }

  // ── Data de emissão ──
  const dataRaw = valorAposLabel(segs, /data da emissao/, RE_DATA)
    ?? (segs.join('\n').match(/emiss[aã]o:?\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1] ?? null);
  const dataEmissao = dataRaw && parseDateBR(dataRaw) ? dataRaw : null;
  if (dataEmissao) conf.dataEmissao = 90; else { naoEncontrados.push('dataEmissao'); conf.dataEmissao = 0; }

  // ── Valor total da nota ──
  const valorRaw = valorAposLabel(segs, /valor total da nota/, /([\d.]+,\d{2})/)
    ?? valorAposLabel(segs, /valor total dos produtos/, /([\d.]+,\d{2})/);
  const valorTotal = parseNumeroBR(valorRaw);
  if (valorTotal != null) conf.valorTotal = 95; else { naoEncontrados.push('valorTotal'); conf.valorTotal = 0; }

  // ── Produtos (Fase C — parser de tabela genérico) ──
  const tabela = extrairTabela<ProdutoScored>(segs, {
    inicioMarcadores: [/dados dos produtos/i],
    fimMarcadores:    [/dados adicionais/i, /informacoes complementares/i, /reservado ao fisco/i],
    isNovoRegistro:   s => /^\d{6,}/.test(s),
    parseLinha:       parseProduto,
  });
  const produtos: ProdutoGasto[] = tabela.itens.map(({ confianca: _c, ...p }) => p);
  conf.produtos = tabela.itens.length
    ? Math.round(tabela.itens.reduce((s, p) => s + p.confianca, 0) / tabela.itens.length)
    : 0;
  if (!produtos.length) naoEncontrados.push('produtos');

  // ── Fase F — Reconciliação: Σ(produtos.valorTotal) vs valorTotal da nota ──
  const somaProdutos = produtos.reduce((s, p) => s + (p.valorTotal ?? 0), 0);
  let confReconc = 100;
  if (valorTotal != null && produtos.length && somaProdutos > 0) {
    const diff = Math.abs(somaProdutos - valorTotal);
    if (diff > Math.max(0.10, valorTotal * 0.02)) {
      confReconc = 55;
      inconsistencias.push(
        `Soma dos produtos (R$ ${somaProdutos.toFixed(2)}) diverge do valor total da nota (R$ ${valorTotal.toFixed(2)}).`,
      );
    }
  }

  // ── Confiança global (média ponderada dos campos + reconciliação) ──
  const pesos: Record<string, number> = { fornecedor: 2, fornecedorCnpj: 2, numeroDocumento: 1, serie: 1, dataEmissao: 1, valorTotal: 2, produtos: 2 };
  let somaP = 0, somaW = 0;
  for (const [k, w] of Object.entries(pesos)) { somaP += (conf[k] ?? 0) * w; somaW += w; }
  const confGlobal = Math.round((somaW ? somaP / somaW : 0) * (confReconc / 100));

  for (const [k, v] of Object.entries(conf)) if (v > 0 && v < 60 && !baixaConfianca.includes(k)) baixaConfianca.push(k);

  const descricao = produtos[0]?.descricao || (fornecedor ? `Compra — ${fornecedor}` : 'Compra');

  return {
    tipo:            'NF-e',
    numeroNf:        numeroDocumento ?? undefined,
    serie:           serieDocumento ?? undefined,
    dataEmissao:     dataEmissao ?? undefined,
    valorBruto:      valorTotal ?? undefined,
    descricao,
    prestador: {
      nomeRazaoSocial: fornecedor ?? undefined,
      cpfCnpj:         fornecedorCnpj ?? undefined,
    },
    tomador: destinatarioNome || destinatarioCnpj ? {
      nomeRazaoSocial: destinatarioNome ?? undefined,
      cpfCnpj:         destinatarioCnpj ?? undefined,
    } : undefined,
    produtos,
    camposConfianca:      conf,
    camposNaoEncontrados: naoEncontrados.length ? naoEncontrados : undefined,
    camposBaixaConfianca: baixaConfianca.length ? baixaConfianca : undefined,
    inconsistencias:      inconsistencias.length ? inconsistencias : undefined,
    fontesExtracao:       ['danfe-pipeline'],
    resumo:               `DANFE — ${produtos.length} produto(s) | confiança ${confGlobal}%` + (inconsistencias.length ? ' | verificar inconsistências' : ''),
  };
}

/** Entrada por Buffer (paridade com extractFromPdfBuffer). */
export async function extrairDanfe(pdfBuffer: Buffer): Promise<PdfExtractResult> {
  const parsed = await pdfParse(pdfBuffer);
  return extrairDanfeDeTexto(parsed.text);
}
