/**
 * Fase 5 — Extrator do Bloco DISCRIMINAÇÃO DOS SERVIÇOS
 *
 * Descobertas estruturais desta fase (confirmadas pelo PDF modelo):
 *
 * 1. ORDEM NO STREAM
 *    A seção de serviços aparece APÓS as zonas Prestador/Tomador no stream.
 *    Segmentos [51-57] (no modelo) formam a zona de serviços:
 *      [52] Headers de colunas direita: "Valor do serviçoBase de cálculo(%)ISS"
 *      [53] Âncora: "DISCRIMINAÇÃO DOS SERVIÇOS"
 *      [54] Headers de colunas esquerda: "QtdValor unitário"
 *      [55] Descrição: texto corrido da prestação
 *      [56] OF: "OF: NNNNNN ."
 *      [57] Valores concatenados: "x=VServico_BaseCal_Aliq_ValISS_Qtd_ValUnit"
 *      [58] Início da tabela de pagamento → fim da zona
 *
 * 2. ANOMALIA DO STREAM DE VALORES
 *    O JasperReports grava as colunas em dois grupos:
 *      GRUPO DIREITA (stream primeiro): Valor serviço → Base cálculo → (%)ISS → Valor ISS
 *      GRUPO ESQUERDA (stream depois): Qtd → Valor unitário
 *    Prefixo "x=" representa o símbolo "×" (multiplicação) exibido na célula
 *    de fórmula Qtd × Valor unit = Valor serviço.
 *    Valores monetários usam 4 casas decimais (50.000,0000) ou 2 (50.000,00).
 *
 * 3. CÓDIGO DO SERVIÇO
 *    Aparece em segmentos muito DEPOIS da zona de valores (~idx 71-73),
 *    após retenções federais e pagamento. É procurado em toda a lista de
 *    segmentos, não apenas na zona de serviços.
 *
 * 4. VALIDAÇÃO MATEMÁTICA
 *    Qtd × Valor unitário ≈ Valor do serviço (tolerância R$ 0,02)
 *    Valor do serviço × (%ISS / 100) ≈ Valor ISS (tolerância R$ 0,02)
 *    Base de cálculo ≈ Valor do serviço (neste modelo, são iguais)
 */

import pdfParse from 'pdf-parse';
import type { ValidationResult, ConfidenceLevel } from './types';

// ─── TIPOS ────────────────────────────────────────────────────────────────────

export interface ServicoField {
  valor: string | null;
  confianca: number;
  nivel: ConfidenceLevel;
  metodo: string;
  validacoes: ValidationResult[];
}

export interface ServicoResult {
  servico: {
    descricao:      ServicoField;
    of:             ServicoField;
    quantidade:     ServicoField;
    valor_unitario: ServicoField;
    valor_servico:  ServicoField;
    base_calculo:   ServicoField;
    aliquota_iss:   ServicoField;
    valor_iss:      ServicoField;
    codigo_servico: ServicoField;
  };
  zona: {
    inicio:     number;
    fim:        number;
    segmentos:  string[];
    estrategia: string;
  };
  globalConfidence: number;
  globalLevel:      ConfidenceLevel;
  extractionMs:     number;
}

// ─── PADRÕES ──────────────────────────────────────────────────────────────────

/** Âncora principal da seção de serviços */
const RE_DISCRIM = /discrimina[çc][aã]o dos servi[çc]os/i;

/** Linha da OF: "OF: 6866682 ." */
const RE_OF = /^OF:\s*(\d+)/i;

/** Segmento de valores concatenados: começa com "x=" seguido de um número */
const RE_VALUES_ROW = /^x=\d/;

/** Header de coluna a ignorar na busca de descrição */
const RE_COL_HEADER = /^(Qtd|Valor unit[aá]rio|Valor do servi[çc]o|Base de c[aá]lculo|\(%\)ISS|ISS)/i;

/** Fim da zona de serviços: início da seção de pagamento */
const RE_PAGAMENTO = /^(Forma de Pagamento$|Parcela\s*Vencimento)/i;
const RE_PARCELA   = /ParcelaVencimento/i;

/** Código de serviço LC 116/2003: "14.01", "17.05", "7.02", etc. */
const RE_SERVICE_CODE = /^(\d{1,2}\.\d{2,4})(?:\s*[-–]|\s*$)/;
const RE_CODIGO_LABEL = /c[oó]digos?\s+dos?\s+servi[çc]os?/i;

/** Valor monetário brasileiro: 2 ou 4 casas decimais (greedy: tenta 4 antes de 2) */
const RE_MONEY_GREEDY = /\d{1,3}(?:\.\d{3})*,\d{4}|\d{1,3}(?:\.\d{3})*,\d{2}/;

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

function nullField(reason: string, score = 40): ServicoField {
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

/**
 * Converte valor monetário brasileiro para float.
 * "50.000,0000" → 50000.0
 * "5,00" → 5.0
 */
function brToFloat(v: string): number {
  return parseFloat(v.replace(/\./g, '').replace(',', '.'));
}

/**
 * Extrai todos os valores numéricos brasileiros de uma string, na ordem de aparecimento.
 * Usa parsing greedy esquerda→direita, tentando 4-decimal antes de 2-decimal.
 * Isso é necessário porque valores de 4 decimais (50.000,0000) se sobrepõem
 * com valores de 2 decimais (50.000,00) nos mesmos caracteres.
 */
function parseAllBrValues(s: string): string[] {
  // Remove o prefixo "x=" antes de parsear
  let remaining = s.replace(/^x=/, '');
  const values: string[] = [];

  while (remaining.length > 0) {
    const m = remaining.match(new RegExp(`^(${RE_MONEY_GREEDY.source})`));
    if (m) {
      values.push(m[1]);
      remaining = remaining.slice(m[1].length);
    } else {
      remaining = remaining.slice(1);
    }
  }

  return values;
}

// ─── DETECÇÃO DE ZONA ─────────────────────────────────────────────────────────

function detectServicoZone(segs: string[]): {
  start: number; end: number; strategy: string;
} {
  // Âncora: DISCRIMINAÇÃO DOS SERVIÇOS
  const anchorIdx = segs.findIndex(s => RE_DISCRIM.test(s));
  if (anchorIdx === -1) {
    return { start: -1, end: -1, strategy: 'zona_nao_detectada' };
  }

  // Início: inclui os headers de coluna que aparecem ANTES da âncora no stream
  // (normalmente 1-2 segmentos atrás)
  const start = Math.max(0, anchorIdx - 2);

  // Fim: primeiro marcador de Forma de Pagamento ou tabela de parcelas após a âncora
  const endIdx = segs.findIndex((s, i) =>
    i > anchorIdx && (RE_PAGAMENTO.test(s) || RE_PARCELA.test(s))
  );
  const end = endIdx !== -1
    ? endIdx - 1
    : Math.min(segs.length - 1, anchorIdx + 15);

  return { start, end, strategy: 'discriminacao_dos_servicos' };
}

// ─── EXTRATORES DE CAMPO ──────────────────────────────────────────────────────

function extractDescricao(segs: string[], anchorIdx: number, zoneEnd: number): ServicoField {
  const validations: ValidationResult[] = [];

  validations.push({ rule: 'ancora_encontrada', passed: anchorIdx !== -1 });
  if (anchorIdx === -1) return nullField('âncora DISCRIMINAÇÃO não encontrada');

  const textLines: string[] = [];

  for (let i = anchorIdx + 1; i <= zoneEnd; i++) {
    const s = segs[i];
    if (RE_COL_HEADER.test(s)) continue;   // pula headers de coluna
    if (RE_OF.test(s)) continue;           // pula linha OF
    if (RE_VALUES_ROW.test(s)) break;      // para na linha de valores
    if (s.length < 4) continue;            // pula fragmentos muito curtos
    // Segmento de cabeçalho concatenado de colunas (ex: "QtdValor unitário")
    if (/^(Qtd|Valor)\w+/i.test(s) && s.length > 20) continue;
    textLines.push(s);
  }

  validations.push({
    rule: 'linhas_descricao_encontradas',
    passed: textLines.length > 0,
    detail: `${textLines.length} linha(s)`,
  });

  if (textLines.length === 0) return nullField('texto de descrição não encontrado');

  const valor = textLines.join(' ').trim();
  const score = clamp(
    70
    + (valor.length >= 10 ? 15 : 0)  // texto substancial
    + (textLines.length === 1 ? 5 : 10)  // bônus por completude
  );

  validations.push({ rule: 'comprimento_adequado', passed: valor.length >= 5, detail: `${valor.length} chars` });

  return {
    valor,
    confianca: clamp(score),
    nivel: levelFor(clamp(score)),
    metodo: 'text_after_anchor',
    validacoes: validations,
  };
}

function extractOF(segs: string[], anchorIdx: number, zoneEnd: number): ServicoField {
  const validations: ValidationResult[] = [];

  for (let i = anchorIdx + 1; i <= zoneEnd; i++) {
    const m = segs[i].match(RE_OF);
    if (m) {
      const valor = m[1].trim();
      validations.push({ rule: 'padrao_of_encontrado', passed: true });
      validations.push({ rule: 'apenas_digitos', passed: /^\d+$/.test(valor) });
      return {
        valor,
        confianca: 95,
        nivel: 'alta',
        metodo: 'pattern_OF',
        validacoes: validations,
      };
    }
  }

  validations.push({ rule: 'padrao_of_encontrado', passed: false });
  return nullField('OF não encontrada na zona de serviços');
}

/**
 * Extrai e mapeia os valores do segmento de valores concatenados.
 *
 * Estrutura do segmento (confirmada pelo PDF modelo):
 *   "x=" + [ValServiço 4dec] + [BaseCalc 2dec] + [AliqISS 2dec] + [ValISS 2dec]
 *        + [Qtd 4dec] + [ValUnit 4dec]
 *
 * Os grupos de colunas são gravados em ordem invertida (direita→esquerda):
 *   DIREITA: Valor serviço, Base cálculo, (%)ISS, Valor ISS
 *   ESQUERDA: Qtd, Valor unitário
 */
function extractValores(segs: string[], anchorIdx: number, zoneEnd: number): {
  quantidade:     ServicoField;
  valor_unitario: ServicoField;
  valor_servico:  ServicoField;
  base_calculo:   ServicoField;
  aliquota_iss:   ServicoField;
  valor_iss:      ServicoField;
} {
  // Localiza a linha de valores concatenados
  let rowSeg: string | null = null;
  for (let i = anchorIdx + 1; i <= zoneEnd; i++) {
    if (RE_VALUES_ROW.test(segs[i])) { rowSeg = segs[i]; break; }
  }

  const foundRow = rowSeg !== null;

  if (!foundRow) {
    const absent = (label: string) => nullField(`linha de valores não encontrada — ${label}`);
    return {
      quantidade:     absent('quantidade'),
      valor_unitario: absent('valor unitário'),
      valor_servico:  absent('valor do serviço'),
      base_calculo:   absent('base de cálculo'),
      aliquota_iss:   absent('alíquota ISS'),
      valor_iss:      absent('valor ISS'),
    };
  }

  // Extrai todos os valores em ordem de aparecimento
  const vals = parseAllBrValues(rowSeg!);

  /*
   * Mapeamento posicional (stream order → campo):
   * idx 0: Valor do serviço (4 dec, grupo direita)
   * idx 1: Base de cálculo  (2 dec)
   * idx 2: (%)ISS aliquota  (2 dec, pequeno)
   * idx 3: Valor ISS        (2 dec)
   * idx 4: Qtd              (4 dec, grupo esquerda)
   * idx 5: Valor unitário   (4 dec)
   *
   * Fallback: se a linha tiver formato diferente, usa heurísticas de tamanho.
   */
  const makeVal = (
    rawVal: string | undefined,
    field: string,
    extraValidations: ValidationResult[] = [],
  ): ServicoField => {
    if (!rawVal) {
      return nullField(`${field} ausente na linha de valores`);
    }
    const validations: ValidationResult[] = [
      { rule: 'linha_valores_encontrada', passed: true },
      { rule: 'valor_presente', passed: true, detail: rawVal },
      ...extraValidations,
    ];
    return {
      valor: rawVal,
      confianca: 88,
      nivel: 'alta',
      metodo: 'positional_parse',
      validacoes: validations,
    };
  };

  // Heurística de fallback: quando a contagem de valores não é exatamente 6,
  // tenta identificar por contexto (aliquota é o menor valor entre 0 e 100)
  if (vals.length !== 6) {
    return extractValoresFallback(vals, foundRow);
  }

  return {
    valor_servico:  makeVal(vals[0], 'valor do serviço'),
    base_calculo:   makeVal(vals[1], 'base de cálculo'),
    aliquota_iss:   makeVal(vals[2], 'alíquota ISS', [
      { rule: 'aliquota_entre_0_e_100', passed: brToFloat(vals[2] ?? '0') <= 100 },
    ]),
    valor_iss:      makeVal(vals[3], 'valor ISS'),
    quantidade:     makeVal(vals[4], 'quantidade'),
    valor_unitario: makeVal(vals[5], 'valor unitário'),
  };
}

/**
 * Fallback para quando o número de valores no segmento não é 6.
 * Usa heurísticas de magnitude:
 *   - Aliquota: valor <= 100 com 2 decimais
 *   - Qtd: valor com 4 decimais e parte inteira pequena (< 10.000)
 *   - Valor ISS: menor valor monetário > aliquota
 *   - Demais: valores grandes
 */
function extractValoresFallback(vals: string[], foundRow: boolean): ReturnType<typeof extractValores> {
  const absent = (label: string) => nullField(
    `${label} — linha com ${vals.length} valor(es) (esperado: 6)`, foundRow ? 55 : 40
  );

  if (vals.length < 2) {
    return {
      quantidade:     absent('quantidade'),
      valor_unitario: absent('valor unitário'),
      valor_servico:  absent('valor do serviço'),
      base_calculo:   absent('base de cálculo'),
      aliquota_iss:   absent('alíquota ISS'),
      valor_iss:      absent('valor ISS'),
    };
  }

  const floats = vals.map(v => ({ raw: v, f: brToFloat(v) }));

  // Aliquota: 2 decimais, valor ≤ 100
  const aliquotaIdx = floats.findIndex(v =>
    !v.raw.endsWith('00') || v.f <= 100
  );

  // Qtd: 4 decimais, valor pequeno
  const qtdIdx = floats.findIndex(v => v.raw.match(/,\d{4}$/) && v.f < 10000);

  // Valor ISS: 2 decimais, menor valor monetário grande
  const sorted = [...floats].sort((a, b) => a.f - b.f);

  const pick = (i: number) => i !== -1 ? floats[i].raw : undefined;

  const makeField = (rawVal: string | undefined, campo: string): ServicoField => {
    if (!rawVal) return absent(campo);
    return {
      valor: rawVal,
      confianca: 60,
      nivel: 'media',
      metodo: 'heuristic_fallback',
      validacoes: [
        { rule: 'linha_valores_encontrada', passed: foundRow },
        { rule: 'valor_presente', passed: true, detail: rawVal },
        { rule: 'contagem_esperada', passed: false, detail: `${vals.length}/6` },
      ],
    };
  };

  return {
    aliquota_iss:   makeField(pick(aliquotaIdx), 'alíquota ISS'),
    quantidade:     makeField(pick(qtdIdx), 'quantidade'),
    valor_iss:      makeField(sorted[0]?.raw, 'valor ISS'),
    valor_servico:  makeField(sorted[sorted.length - 1]?.raw, 'valor do serviço'),
    base_calculo:   makeField(sorted[sorted.length - 2]?.raw, 'base de cálculo'),
    valor_unitario: makeField(sorted[sorted.length - 3]?.raw, 'valor unitário'),
  };
}

function extractCodigoServico(segs: string[], zoneEnd: number): ServicoField {
  const validations: ValidationResult[] = [];

  // Procura o label "Códigos dos serviços:" em TODA a lista (aparece após zona de serviços)
  const labelIdx = segs.findIndex((s, i) => i > zoneEnd && RE_CODIGO_LABEL.test(s));

  validations.push({ rule: 'label_codigos_encontrado', passed: labelIdx !== -1 });

  if (labelIdx === -1) {
    // Fallback: procura o label em qualquer posição
    const fallbackIdx = segs.findIndex(s => RE_CODIGO_LABEL.test(s));
    if (fallbackIdx !== -1) {
      return extractCodigoFrom(segs, fallbackIdx, validations, 'label_fora_da_zona');
    }
    return nullField('label "Códigos dos serviços:" não encontrado');
  }

  return extractCodigoFrom(segs, labelIdx, validations, 'label_apos_zona');
}

function extractCodigoFrom(
  segs: string[],
  labelIdx: number,
  validations: ValidationResult[],
  metodo: string,
): ServicoField {
  // O código aparece no próximo segmento não vazio após o label
  for (let i = labelIdx + 1; i < Math.min(segs.length, labelIdx + 5); i++) {
    const m = segs[i].match(RE_SERVICE_CODE);
    if (m) {
      const valor = m[1];
      validations.push({ rule: 'codigo_lc116_encontrado', passed: true, detail: valor });
      validations.push({
        rule: 'formato_XX_XX',
        passed: /^\d{1,2}\.\d{2,4}$/.test(valor),
      });
      return {
        valor,
        confianca: 92,
        nivel: 'alta',
        metodo,
        validacoes: validations,
      };
    }
  }

  validations.push({ rule: 'codigo_lc116_encontrado', passed: false });
  return nullField('código de serviço não localizado após label');
}

// ─── VALIDAÇÃO MATEMÁTICA ─────────────────────────────────────────────────────

/**
 * Retorna validações de coerência matemática entre os campos numéricos.
 * Tolerância de R$ 0,02 (arredondamentos).
 */
function validateMath(
  qtd:        string | null,
  valUnit:    string | null,
  valServico: string | null,
  aliq:       string | null,
  valIss:     string | null,
): ValidationResult[] {
  const validations: ValidationResult[] = [];
  const TOL = 0.02;

  if (qtd && valUnit && valServico) {
    const calc = brToFloat(qtd) * brToFloat(valUnit);
    const expected = brToFloat(valServico);
    const ok = Math.abs(calc - expected) <= TOL;
    validations.push({
      rule: 'qtd_x_valor_unitario_eq_valor_servico',
      passed: ok,
      detail: `${calc.toFixed(2)} ≈ ${expected.toFixed(2)}`,
    });
  }

  if (aliq && valServico && valIss) {
    const calc = brToFloat(valServico) * brToFloat(aliq) / 100;
    const expected = brToFloat(valIss);
    const ok = Math.abs(calc - expected) <= TOL;
    validations.push({
      rule: 'valor_servico_x_aliquota_eq_valor_iss',
      passed: ok,
      detail: `${calc.toFixed(2)} ≈ ${expected.toFixed(2)}`,
    });
  }

  return validations;
}

// ─── CÁLCULO DE CONFIANÇA GLOBAL ─────────────────────────────────────────────

function calcGlobal(servico: ServicoResult['servico']): { score: number; level: ConfidenceLevel } {
  const weights: Array<[ServicoField, number]> = [
    [servico.descricao,      20],
    [servico.of,             10],
    [servico.quantidade,     10],
    [servico.valor_unitario, 10],
    [servico.valor_servico,  20],
    [servico.base_calculo,   10],
    [servico.aliquota_iss,   10],
    [servico.valor_iss,      10],
    [servico.codigo_servico,  8],
  ];

  const totalWeight = weights.reduce((a, [, w]) => a + w, 0);
  const score = weights.reduce((acc, [f, w]) => acc + f.confianca * w, 0) / totalWeight;

  return { score: clamp(score), level: levelFor(clamp(score)) };
}

// ─── ENTRY POINT ─────────────────────────────────────────────────────────────

export async function extractServico(pdfBuffer: Buffer): Promise<ServicoResult> {
  const t0   = Date.now();
  const raw  = await pdfParse(pdfBuffer);
  const segs = toSegments(raw.text);

  const { start, end, strategy } = detectServicoZone(segs);

  if (start === -1) {
    const absent = (label: string) => nullField(`zona de serviços não detectada — ${label}`, 30);
    const servico: ServicoResult['servico'] = {
      descricao:      absent('descrição'),
      of:             absent('OF'),
      quantidade:     absent('quantidade'),
      valor_unitario: absent('valor unitário'),
      valor_servico:  absent('valor do serviço'),
      base_calculo:   absent('base de cálculo'),
      aliquota_iss:   absent('alíquota ISS'),
      valor_iss:      absent('valor ISS'),
      codigo_servico: absent('código do serviço'),
    };
    return {
      servico,
      zona:             { inicio: -1, fim: -1, segmentos: [], estrategia: strategy },
      globalConfidence: 0,
      globalLevel:      'nula',
      extractionMs:     Date.now() - t0,
    };
  }

  const zone     = segs.slice(start, end + 1);
  const anchorOff = segs.findIndex(s => RE_DISCRIM.test(s)) - start;

  const descricao      = extractDescricao(zone, anchorOff, zone.length - 1);
  const of             = extractOF(zone, anchorOff, zone.length - 1);
  const valores        = extractValores(zone, anchorOff, zone.length - 1);
  const codigo_servico = extractCodigoServico(segs, end);

  // Agrega validações matemáticas no campo valor_servico
  const mathValidations = validateMath(
    valores.quantidade.valor,
    valores.valor_unitario.valor,
    valores.valor_servico.valor,
    valores.aliquota_iss.valor,
    valores.valor_iss.valor,
  );
  valores.valor_servico.validacoes.push(...mathValidations);

  const servico: ServicoResult['servico'] = {
    descricao,
    of,
    ...valores,
    codigo_servico,
  };

  const { score, level } = calcGlobal(servico);

  return {
    servico,
    zona: {
      inicio:    start,
      fim:       end,
      segmentos: zone,
      estrategia: strategy,
    },
    globalConfidence: score,
    globalLevel:      level,
    extractionMs:     Date.now() - t0,
  };
}
