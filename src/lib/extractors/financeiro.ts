/**
 * Fase 6 — Extrator do BLOCO FINANCEIRO E RETENÇÕES
 *
 * Mapeamento do stream PDF (modelo Dourados/MS, JasperReports + iText 2.1.7):
 *
 * 1. RETENÇÕES FEDERAIS (~idx 61-73)
 *    [61] "IR"                             ← label coluna IR (antes do cabeçalho)
 *    [62] "R$ 0,00"                        ← valor IR
 *    [63] "RETENÇÕES FEDERAIS"             ← âncora da seção
 *    [64] "Valor bruto = R$ 50.000,00"    ← padrão "Valor X = R$ Y" (excluído do parse)
 *    [65] "R$ 0,00R$ 0,00"                ← 2 valores de retenção concatenados
 *    [66] "Valor líquido = R$ 47.500,00"  ← padrão "Valor X = R$ Y" (excluído do parse)
 *    [67] "PIS/PASEPCOFINSINSSCSLL"        ← 4 labels concatenados (sem valores)
 *    [68] "R$ 0,00"                        ← 1 valor
 *    [69] "R$ 0,00R$ 0,00"                ← 2 valores concatenados
 *    [70] "Outras retenções"               ← label (valores já capturados acima)
 *
 *    Atribuição posicional dos 5 valores coletados:
 *      idx 0 → pis_pasep  │ idx 1 → cofins   │ idx 2 → inss
 *      idx 3 → csll        │ idx 4 → outras_retencoes
 *
 * 2. TABELA ISS (~idx 74-77)
 *    [74] "Valor ISS(R$)"                  ← header de coluna
 *    [75] "0,002.500,0050.000,00"          ← 3 valores: Ded | ISS | Base
 *    [76] "Deduções(R$)Base de cálculo(R$)Desc. condicionado(R$)Desc. incondicionado(R$)"
 *    [77] "0,000,00"                        ← DescCond | DescIncond
 *
 *    Atribuição por magnitude (robusta a reordenação):
 *      maior   → base_calculo (50.000,00)
 *      2º      → valor_iss   (2.500,00)
 *      menor   → deduções    (0,00) — interno, não exposto
 *
 * 3. OUTRAS INFORMAÇÕES (~idx 78-87)
 *    [...] "...Alíquota do ISS 5%"          ← alíquota ISS
 *    [...] "Valor aproximado do tributo..."  ← tributos Lei 12.741/2012
 *
 * 4. VALIDAÇÕES MATEMÁTICAS
 *    valor_bruto − valor_iss ≈ valor_liquido    (50.000 − 2.500 = 47.500)
 *    base_calculo × aliquota/100 ≈ valor_iss    (50.000 × 5/100 = 2.500)
 *    Σ retenções federais = total_tributos_encargos  (todos zero → 0,00)
 */

import pdfParse from 'pdf-parse';
import type { ValidationResult, ConfidenceLevel } from './types';

// ─── TIPOS ────────────────────────────────────────────────────────────────────

export interface FinanceiroField {
  valor: string | null;
  confianca: number;
  nivel: ConfidenceLevel;
  metodo: string;
  validacoes: ValidationResult[];
}

export interface FinanceiroResult {
  financeiro: {
    valor_servico:             FinanceiroField;
    valor_bruto:               FinanceiroField;
    valor_liquido:             FinanceiroField;
    base_calculo:              FinanceiroField;
    aliquota_iss:              FinanceiroField;
    valor_iss:                 FinanceiroField;
    ir:                        FinanceiroField;
    pis_pasep:                 FinanceiroField;
    cofins:                    FinanceiroField;
    inss:                      FinanceiroField;
    csll:                      FinanceiroField;
    outras_retencoes:          FinanceiroField;
    valor_aproximado_tributos: FinanceiroField;
    valor_liquido_antecipacao: FinanceiroField;
    total_tributos_encargos:   FinanceiroField;
  };
  zonas: {
    retencao:   { inicio: number; fim: number; anchorIdx: number; irIdx: number; estrategia: string };
    iss:        { inicio: number; fim: number };
    outrasInfo: { inicio: number };
  };
  globalConfidence: number;
  globalLevel:      ConfidenceLevel;
  extractionMs:     number;
  segmentos:        string[];
}

// ─── PADRÕES ──────────────────────────────────────────────────────────────────

const RE_RETENCOES_FED = /reten[çc][oõ]es\s+federais/i;
const RE_IR_LABEL      = /^IR$/;
const RE_BRUTO         = /Valor\s+bruto\s*=\s*R\$\s*([\d.,]+)/i;
const RE_LIQUIDO       = /Valor\s+l[íi]quido\s*=\s*R\$\s*([\d.,]+)/i;
const RE_LABELED_VALOR = /Valor\s+(?:bruto|l[íi]quido)\s*=/i;
const RE_ISS_HEADER    = /Valor\s+ISS\s*\(R\$\)/i;
const RE_OUTRAS_INFO   = /outras\s+informa[çc][oõ]es/i;
const RE_ALIQUOTA      = /Al[íi]quota\s+do\s+ISS\s+(\d+(?:,\d+)?)\s*%/i;
const RE_TRIBUTOS      = /Valor\s+aproximado\s+do\s+tributo/i;
const RE_FED_VAL       = /federal\s*[-–]\s*R\$\s*([\d.,]+)/i;
const RE_EST_VAL       = /estadual\s*[-–]\s*R\$\s*([\d.,]+)/i;
const RE_MUN_VAL       = /municipal\s*[-–]\s*R\$\s*([\d.,]+)/i;

// ─── UTILITÁRIOS ─────────────────────────────────────────────────────────────

function levelFor(score: number): ConfidenceLevel {
  if (score >= 90) return 'alta';
  if (score >= 70) return 'media';
  if (score >= 50) return 'baixa';
  return 'nula';
}

function clamp(n: number): number {
  return Math.min(100, Math.max(0, n));
}

function brToFloat(v: string): number {
  return parseFloat(v.replace(/\./g, '').replace(',', '.'));
}

function toBrFormat(n: number): string {
  const [int, dec] = n.toFixed(2).split('.');
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + dec;
}

function nullField(reason: string, score = 40): FinanceiroField {
  return {
    valor: null,
    confianca: score,
    nivel: levelFor(score),
    metodo: 'campo_ausente',
    validacoes: [{ rule: 'valor_encontrado', passed: false, detail: reason }],
  };
}

function toSegments(raw: string): string[] {
  return raw.split('\n').map(s => s.trim()).filter(s => s.length > 0);
}

/** Extrai todos os valores "R$ X,XX" de uma string concatenada */
function parseRMoneyValues(s: string): string[] {
  const re = /R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/g;
  const results: string[] = [];
  let m;
  while ((m = re.exec(s)) !== null) results.push(m[1]);
  return results;
}

/**
 * Extrai valores monetários brasileiros (2 decimais) sem prefixo "R$".
 * Parsing greedy esquerda→direita: "0,002.500,0050.000,00" → ['0,00','2.500,00','50.000,00']
 */
function parseBrValues(s: string): string[] {
  const results: string[] = [];
  let rem = s;
  while (rem.length > 0) {
    const m = rem.match(/^(\d{1,3}(?:\.\d{3})*,\d{2})/);
    if (m) { results.push(m[1]); rem = rem.slice(m[1].length); }
    else rem = rem.slice(1);
  }
  return results;
}

// ─── DETECÇÃO DE ZONAS ────────────────────────────────────────────────────────

function detectZones(segs: string[]): {
  retAnchorIdx:    number;
  irIdx:           number;
  retStart:        number;
  retEnd:          number;
  issStart:        number;
  issEnd:          number;
  outrasInfoStart: number;
  strategy:        string;
} {
  const retAnchorIdx    = segs.findIndex(s => RE_RETENCOES_FED.test(s));
  const issAnchorIdx    = segs.findIndex(s => RE_ISS_HEADER.test(s));
  const outrasInfoStart = segs.findIndex(s => RE_OUTRAS_INFO.test(s));

  // IR label: nas 3 posições imediatamente antes do cabeçalho RETENÇÕES FEDERAIS
  let irIdx = -1;
  if (retAnchorIdx > 0) {
    for (let i = Math.max(0, retAnchorIdx - 3); i < retAnchorIdx; i++) {
      if (RE_IR_LABEL.test(segs[i])) { irIdx = i; break; }
    }
  }

  const retStart = irIdx !== -1 ? irIdx : (retAnchorIdx !== -1 ? retAnchorIdx : 0);

  const retEnd = issAnchorIdx !== -1
    ? issAnchorIdx - 1
    : outrasInfoStart !== -1
      ? outrasInfoStart - 1
      : Math.min(segs.length - 1, (retAnchorIdx !== -1 ? retAnchorIdx + 20 : 0));

  const issStart = issAnchorIdx;
  const issEnd   = outrasInfoStart !== -1
    ? outrasInfoStart - 1
    : issAnchorIdx !== -1
      ? Math.min(segs.length - 1, issAnchorIdx + 6)
      : -1;

  return {
    retAnchorIdx,
    irIdx,
    retStart,
    retEnd,
    issStart,
    issEnd,
    outrasInfoStart,
    strategy: retAnchorIdx !== -1 ? 'retencoes_federais_anchor' : 'zona_nao_detectada',
  };
}

// ─── EXTRATORES DE CAMPO ──────────────────────────────────────────────────────

function extractValorBruto(segs: string[]): FinanceiroField {
  for (const seg of segs) {
    const m = seg.match(RE_BRUTO);
    if (m) {
      return {
        valor: m[1],
        confianca: 95,
        nivel: 'alta',
        metodo: 'padrao_valor_bruto_igual',
        validacoes: [
          { rule: 'label_valor_bruto_encontrado', passed: true },
          { rule: 'valor_presente', passed: true, detail: m[1] },
        ],
      };
    }
  }
  return nullField('"Valor bruto = R$ ..." não encontrado');
}

function extractValorLiquido(segs: string[]): FinanceiroField {
  for (const seg of segs) {
    const m = seg.match(RE_LIQUIDO);
    if (m) {
      return {
        valor: m[1],
        confianca: 95,
        nivel: 'alta',
        metodo: 'padrao_valor_liquido_igual',
        validacoes: [
          { rule: 'label_valor_liquido_encontrado', passed: true },
          { rule: 'valor_presente', passed: true, detail: m[1] },
        ],
      };
    }
  }
  return nullField('"Valor líquido = R$ ..." não encontrado');
}

function extractValorServico(valorBruto: FinanceiroField): FinanceiroField {
  if (valorBruto.valor !== null) {
    const conf = clamp(valorBruto.confianca - 5);
    return {
      valor: valorBruto.valor,
      confianca: conf,
      nivel: levelFor(conf),
      metodo: 'derivado_valor_bruto',
      validacoes: [
        { rule: 'derivado_de_valor_bruto', passed: true },
        { rule: 'valor_presente', passed: true, detail: valorBruto.valor },
      ],
    };
  }
  return nullField('valor do serviço não derivável (valor bruto ausente)');
}

function extractIR(segs: string[], irIdx: number, retAnchorIdx: number): FinanceiroField {
  const validations: ValidationResult[] = [];

  let labelIdx = irIdx;

  // Fallback: ampliar janela de busca ao redor do cabeçalho
  if (labelIdx === -1 && retAnchorIdx !== -1) {
    for (let i = Math.max(0, retAnchorIdx - 5); i < retAnchorIdx; i++) {
      if (RE_IR_LABEL.test(segs[i])) { labelIdx = i; break; }
    }
  }

  validations.push({ rule: 'label_ir_encontrado', passed: labelIdx !== -1 });
  if (labelIdx === -1) return nullField('label IR não encontrado');

  for (let i = labelIdx + 1; i < Math.min(segs.length, labelIdx + 5); i++) {
    if (RE_RETENCOES_FED.test(segs[i])) break;
    const vals = parseRMoneyValues(segs[i]);
    if (vals.length > 0) {
      return {
        valor: vals[0],
        confianca: 90,
        nivel: 'alta',
        metodo: 'ir_label_proximity',
        validacoes: [
          ...validations,
          { rule: 'valor_presente', passed: true, detail: vals[0] },
        ],
      };
    }
  }

  validations.push({ rule: 'valor_ir_encontrado', passed: false });
  return nullField('valor IR não encontrado após label');
}

/**
 * Coleta todos os valores "R$ X,XX" na zona de retenções (a partir do cabeçalho
 * RETENÇÕES FEDERAIS), excluindo segmentos com label "Valor bruto =" e "Valor líquido =".
 * Os 5 valores resultantes são atribuídos posicionalmente a PIS/PASEP, COFINS, INSS,
 * CSLL e Outras retenções (ordem confirmada pelo modelo Dourados/MS).
 */
function extractRetencoesFederais(segs: string[], retAnchorIdx: number, retEnd: number): {
  pis_pasep:        FinanceiroField;
  cofins:           FinanceiroField;
  inss:             FinanceiroField;
  csll:             FinanceiroField;
  outras_retencoes: FinanceiroField;
} {
  const allValues: string[] = [];
  const start = retAnchorIdx !== -1 ? retAnchorIdx : 0;

  for (let i = start; i <= retEnd; i++) {
    const seg = segs[i];
    if (RE_LABELED_VALOR.test(seg)) continue;
    allValues.push(...parseRMoneyValues(seg));
  }

  const makeField = (val: string | undefined, campo: string): FinanceiroField => {
    if (val === undefined) {
      return nullField(`${campo} ausente (${allValues.length} valores na zona de retenções)`);
    }
    return {
      valor: val,
      confianca: 75,
      nivel: 'media',
      metodo: 'positional_parse_retencoes',
      validacoes: [
        { rule: 'valor_presente', passed: true, detail: val },
        { rule: 'retencao_zero', passed: val === '0,00', detail: val },
      ],
    };
  };

  return {
    pis_pasep:        makeField(allValues[0], 'PIS/PASEP'),
    cofins:           makeField(allValues[1], 'COFINS'),
    inss:             makeField(allValues[2], 'INSS'),
    csll:             makeField(allValues[3], 'CSLL'),
    outras_retencoes: makeField(allValues[4], 'Outras retenções'),
  };
}

/**
 * Extrai Valor ISS e Base de cálculo da tabela ISS.
 * [74] "Valor ISS(R$)"        → header
 * [75] "0,002.500,0050.000,00" → 3 valores: Deduções | ValISS | BaseCalc
 * Atribuição por magnitude: maior = base_calculo, 2º = valor_iss.
 */
function extractISSSubTable(segs: string[], issStart: number): {
  valor_iss:    FinanceiroField;
  base_calculo: FinanceiroField;
} {
  if (issStart === -1) {
    return {
      valor_iss:    nullField('tabela ISS não detectada (Valor ISS(R$) ausente)'),
      base_calculo: nullField('tabela ISS não detectada'),
    };
  }

  const valSeg = segs[issStart + 1] ?? '';
  const vals   = parseBrValues(valSeg);

  if (vals.length < 2) {
    return {
      valor_iss:    nullField(`tabela ISS: ${vals.length} valor(es) em "${valSeg}" (esperado ≥2)`),
      base_calculo: nullField('tabela ISS: base de cálculo ausente'),
    };
  }

  const sorted = [...vals]
    .map(v => ({ raw: v, f: brToFloat(v) }))
    .sort((a, b) => b.f - a.f);

  const baseVal = sorted[0]?.raw;
  const issVal  = sorted[1]?.raw;

  const make = (val: string | undefined, campo: string, conf: number): FinanceiroField => {
    if (!val) return nullField(`${campo} ausente na tabela ISS`);
    return {
      valor: val,
      confianca: conf,
      nivel: levelFor(conf),
      metodo: 'iss_subtable_magnitude',
      validacoes: [
        { rule: 'tabela_iss_encontrada', passed: true },
        { rule: 'valor_presente', passed: true, detail: val },
      ],
    };
  };

  return {
    base_calculo: make(baseVal, 'base de cálculo', 90),
    valor_iss:    make(issVal,  'valor ISS',        88),
  };
}

function extractAliquotaISS(segs: string[], outrasInfoStart: number): FinanceiroField {
  const start = outrasInfoStart !== -1 ? outrasInfoStart : 0;
  for (let i = start; i < segs.length; i++) {
    const m = segs[i].match(RE_ALIQUOTA);
    if (m) {
      const valor = m[1];
      return {
        valor,
        confianca: 88,
        nivel: 'alta',
        metodo: 'aliquota_outras_informacoes',
        validacoes: [
          { rule: 'aliquota_iss_encontrada', passed: true },
          { rule: 'aliquota_percentual_valido', passed: brToFloat(valor) <= 100 },
        ],
      };
    }
  }
  return nullField('alíquota ISS não encontrada em OUTRAS INFORMAÇÕES');
}

/**
 * Extrai tributos aproximados conforme Lei 12.741/2012 e soma federal+estadual+municipal.
 * Ex.: "federal - R$ 6.725,00 ... estadual - R$ 0,00 ... municipal - R$ 2.500,00 ..."
 *      → total = 9.225,00
 */
function extractTributosAproximados(segs: string[]): FinanceiroField {
  const idx = segs.findIndex(s => RE_TRIBUTOS.test(s));
  if (idx === -1) return nullField('"Valor aproximado do tributo" não encontrado');

  const text = segs.slice(idx, Math.min(segs.length, idx + 3)).join(' ');

  const fedM = text.match(RE_FED_VAL);
  const estM = text.match(RE_EST_VAL);
  const munM = text.match(RE_MUN_VAL);

  const validations: ValidationResult[] = [
    { rule: 'federal_encontrado',   passed: fedM !== null },
    { rule: 'estadual_encontrado',  passed: estM !== null },
    { rule: 'municipal_encontrado', passed: munM !== null },
  ];

  if (!fedM && !estM && !munM) {
    return { valor: null, confianca: 30, nivel: 'nula', metodo: 'tributos_lei_12741', validacoes: validations };
  }

  const fed   = fedM ? brToFloat(fedM[1]) : 0;
  const est   = estM ? brToFloat(estM[1]) : 0;
  const mun   = munM ? brToFloat(munM[1]) : 0;
  const total = fed + est + mun;
  const totalBR = toBrFormat(total);

  validations.push({
    rule: 'total_calculado',
    passed: true,
    detail: `fed=${fedM?.[1] ?? '0,00'} + est=${estM?.[1] ?? '0,00'} + mun=${munM?.[1] ?? '0,00'} = ${totalBR}`,
  });

  return {
    valor: totalBR,
    confianca: 85,
    nivel: 'alta',
    metodo: 'tributos_lei_12741_soma',
    validacoes: validations,
  };
}

function extractValorLiquidoAntecipacao(segs: string[]): FinanceiroField {
  const hasAntecipacao = segs.some(s => /antecipa[çc][aã]o/i.test(s));
  return {
    valor: null,
    confianca: hasAntecipacao ? 20 : 92,
    nivel: hasAntecipacao ? 'nula' : 'alta',
    metodo: 'nao_presente',
    validacoes: [{
      rule: 'campo_nao_aplicavel',
      passed: !hasAntecipacao,
      detail: hasAntecipacao
        ? 'antecipação detectada mas extração não implementada'
        : 'antecipação não presente no modelo',
    }],
  };
}

// ─── TOTAL DE RETENÇÕES ───────────────────────────────────────────────────────

function computeTotalRetencoes(
  ir:     FinanceiroField,
  pis:    FinanceiroField,
  cofins: FinanceiroField,
  inss:   FinanceiroField,
  csll:   FinanceiroField,
  outras: FinanceiroField,
): FinanceiroField {
  const fields = [ir, pis, cofins, inss, csll, outras];
  if (fields.some(f => f.valor === null)) {
    return nullField('total não calculável: campo(s) de retenção ausente(s)');
  }

  const total   = fields.reduce((sum, f) => sum + brToFloat(f.valor!), 0);
  const totalBR = toBrFormat(total);

  return {
    valor: totalBR,
    confianca: 85,
    nivel: 'alta',
    metodo: 'soma_retencoes_federais',
    validacoes: [
      { rule: 'total_calculado', passed: true, detail: totalBR },
      { rule: 'total_zero',      passed: total < 0.001 },
    ],
  };
}

// ─── VALIDAÇÃO MATEMÁTICA ─────────────────────────────────────────────────────

function validateFinanceiro(f: FinanceiroResult['financeiro']): ValidationResult[] {
  const results: ValidationResult[] = [];
  const TOL = 0.02;

  if (f.valor_bruto.valor && f.valor_iss.valor && f.valor_liquido.valor) {
    const calc     = brToFloat(f.valor_bruto.valor) - brToFloat(f.valor_iss.valor);
    const expected = brToFloat(f.valor_liquido.valor);
    results.push({
      rule:   'bruto_menos_iss_eq_liquido',
      passed: Math.abs(calc - expected) <= TOL,
      detail: `${toBrFormat(brToFloat(f.valor_bruto.valor))} − ${f.valor_iss.valor} = ${toBrFormat(calc)} ≈ ${f.valor_liquido.valor}`,
    });
  }

  if (f.base_calculo.valor && f.aliquota_iss.valor && f.valor_iss.valor) {
    const calc     = brToFloat(f.base_calculo.valor) * brToFloat(f.aliquota_iss.valor) / 100;
    const expected = brToFloat(f.valor_iss.valor);
    results.push({
      rule:   'base_x_aliquota_eq_valor_iss',
      passed: Math.abs(calc - expected) <= TOL,
      detail: `${f.base_calculo.valor} × ${f.aliquota_iss.valor}% = ${toBrFormat(calc)} ≈ ${f.valor_iss.valor}`,
    });
  }

  return results;
}

// ─── CONFIANÇA GLOBAL ─────────────────────────────────────────────────────────

function calcGlobal(f: FinanceiroResult['financeiro']): { score: number; level: ConfidenceLevel } {
  const weights: Array<[FinanceiroField, number]> = [
    [f.valor_bruto,               15],
    [f.valor_liquido,             15],
    [f.valor_iss,                 15],
    [f.base_calculo,              10],
    [f.aliquota_iss,               8],
    [f.ir,                        10],
    [f.pis_pasep,                  6],
    [f.cofins,                     6],
    [f.inss,                       6],
    [f.csll,                       4],
    [f.outras_retencoes,           3],
    [f.valor_aproximado_tributos,  2],
  ];
  const totalW = weights.reduce((a, [, w]) => a + w, 0);
  const score  = weights.reduce((acc, [field, w]) => acc + field.confianca * w, 0) / totalW;
  return { score: clamp(score), level: levelFor(clamp(score)) };
}

// ─── ENTRY POINT ─────────────────────────────────────────────────────────────

export async function extractFinanceiro(pdfBuffer: Buffer): Promise<FinanceiroResult> {
  const t0   = Date.now();
  const raw  = await pdfParse(pdfBuffer);
  const segs = toSegments(raw.text);

  const {
    retAnchorIdx, irIdx, retStart, retEnd,
    issStart, issEnd, outrasInfoStart, strategy,
  } = detectZones(segs);

  if (retAnchorIdx === -1) {
    const absent = (label: string) => nullField(`zona financeira não detectada — ${label}`, 20);
    const financeiro: FinanceiroResult['financeiro'] = {
      valor_servico:             absent('valor do serviço'),
      valor_bruto:               absent('valor bruto'),
      valor_liquido:             absent('valor líquido'),
      base_calculo:              absent('base de cálculo'),
      aliquota_iss:              absent('alíquota ISS'),
      valor_iss:                 absent('valor ISS'),
      ir:                        absent('IR'),
      pis_pasep:                 absent('PIS/PASEP'),
      cofins:                    absent('COFINS'),
      inss:                      absent('INSS'),
      csll:                      absent('CSLL'),
      outras_retencoes:          absent('outras retenções'),
      valor_aproximado_tributos: absent('tributos aproximados'),
      valor_liquido_antecipacao: absent('antecipação'),
      total_tributos_encargos:   absent('total encargos'),
    };
    return {
      financeiro,
      zonas: {
        retencao:   { inicio: -1, fim: -1, anchorIdx: -1, irIdx: -1, estrategia: strategy },
        iss:        { inicio: -1, fim: -1 },
        outrasInfo: { inicio: -1 },
      },
      globalConfidence: 0,
      globalLevel:      'nula',
      extractionMs:     Date.now() - t0,
      segmentos:        segs,
    };
  }

  // ── Extração ──────────────────────────────────────────────────────────────
  const valor_bruto   = extractValorBruto(segs);
  const valor_liquido = extractValorLiquido(segs);
  const valor_servico = extractValorServico(valor_bruto);
  const ir            = extractIR(segs, irIdx, retAnchorIdx);
  const retencoes     = extractRetencoesFederais(segs, retAnchorIdx, retEnd);
  const issTable      = extractISSSubTable(segs, issStart);
  const aliquota_iss  = extractAliquotaISS(segs, outrasInfoStart);
  const tributosAprox = extractTributosAproximados(segs);
  const antecipacao   = extractValorLiquidoAntecipacao(segs);
  const totalEnc      = computeTotalRetencoes(
    ir, retencoes.pis_pasep, retencoes.cofins,
    retencoes.inss, retencoes.csll, retencoes.outras_retencoes,
  );

  const financeiro: FinanceiroResult['financeiro'] = {
    valor_servico,
    valor_bruto,
    valor_liquido,
    base_calculo:              issTable.base_calculo,
    aliquota_iss,
    valor_iss:                 issTable.valor_iss,
    ir,
    pis_pasep:                 retencoes.pis_pasep,
    cofins:                    retencoes.cofins,
    inss:                      retencoes.inss,
    csll:                      retencoes.csll,
    outras_retencoes:          retencoes.outras_retencoes,
    valor_aproximado_tributos: tributosAprox,
    valor_liquido_antecipacao: antecipacao,
    total_tributos_encargos:   totalEnc,
  };

  // Validações matemáticas anexadas ao campo valor_liquido
  financeiro.valor_liquido.validacoes.push(...validateFinanceiro(financeiro));

  const { score, level } = calcGlobal(financeiro);

  return {
    financeiro,
    zonas: {
      retencao:   { inicio: retStart, fim: retEnd, anchorIdx: retAnchorIdx, irIdx, estrategia: strategy },
      iss:        { inicio: issStart, fim: issEnd },
      outrasInfo: { inicio: outrasInfoStart },
    },
    globalConfidence: score,
    globalLevel:      level,
    extractionMs:     Date.now() - t0,
    segmentos:        segs,
  };
}
