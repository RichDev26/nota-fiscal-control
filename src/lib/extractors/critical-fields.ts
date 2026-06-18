/**
 * Fase 2 — Extrator de Campos Críticos de Identificação da NFS-e
 *
 * Extrai exclusivamente:
 *   - Número da nota
 *   - Código de verificação
 *   - Data de emissão
 *   - Data do fato gerador
 *
 * Estratégia: extração em camadas com pontuação de confiança por campo.
 * Não depende de ordem sequencial do texto bruto (o PDF usa iText/JasperReports
 * com posicionamento absoluto — os objetos chegam fora da ordem visual).
 */

import pdfParse from 'pdf-parse';
import type { ValidationResult, FieldResult, CriticalFieldsResult, ConfidenceLevel } from './types';

// ─── PADRÕES ──────────────────────────────────────────────────────────────────

/** Formato de data/hora exato da NFS-e: DD/MM/AAAA HH:MM:SS */
const RE_DATETIME = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/;

/** Número da nota: inteiro puro, sem separadores, até 10 dígitos */
const RE_NUMERIC_ONLY = /^\d{1,10}$/;

/**
 * Código de verificação: alfanumérico maiúsculo, sem espaços ou caracteres especiais,
 * com PELO MENOS UMA LETRA obrigatória.
 * Isso exclui inscrições municipais/estaduais que são puramente numéricas.
 * Faixa de 7-15 chars cobre os padrões observados em sistemas NFS-e brasileiros.
 */
const RE_VERIFICATION     = /^[A-Z0-9]{7,15}$/;
const RE_HAS_LETTER       = /[A-Z]/;  // código deve conter ao menos uma letra maiúscula

// ─── ÂNCORAS DE LABEL ────────────────────────────────────────────────────────
// Buscadas como substring (case-insensitive) nos segmentos do texto bruto.
// Inclui variantes concatenadas observadas no PDF (iText funde labels adjacentes).

const ANCHORS = {
  numeroNota: [
    'número da nota',
    'numero da nota',
    'número da notanúmero do rps',   // forma concatenada observada no PDF modelo
    'numero da notanumero do rps',
  ],
  codigoVerificacao: [
    'código de verificação',
    'codigo de verificacao',
    'código de verificacão',
    'codigo de verificacão',
  ],
  dataEmissao: [
    'data da emissão da nota',
    'data da emissao da nota',
    'data de emissão da nota',
    'data de emissao da nota',
  ],
  dataFatoGerador: [
    'data do fato gerador',
  ],
} as const;

/**
 * Tokens maiúsculos alfanuméricos que NÃO são código de verificação.
 * Garante que títulos de seção concatenados não sejam confundidos com o código.
 */
const EXCLUDED_FROM_VERIFICATION = new Set([
  'PRESTADOR', 'TOMADOR', 'SERVICOS', 'DISCRIMINACAO', 'RETENCOES',
  'FEDERAIS', 'FEDERAL', 'INFORMACOES', 'MUNICIPIO', 'DOURADOS',
  'COFINS', 'PASEP', 'ISSQN', 'INSS', 'CSLL', 'OUTRAS', 'FONTES',
]);

// ─── UTILITÁRIOS ─────────────────────────────────────────────────────────────

/** Divide o texto bruto em segmentos não-vazios (1 por linha). */
function toSegments(raw: string): string[] {
  return raw.split('\n').map(s => s.trim()).filter(s => s.length > 0);
}

/**
 * Encontra o índice do primeiro segmento que contenha qualquer uma das âncoras.
 * Retorna -1 se não encontrar.
 */
function findAnchorIdx(segs: string[], anchors: readonly string[]): number {
  const lower = segs.map(s => s.toLowerCase());
  for (const anchor of anchors) {
    const i = lower.findIndex(s => s.includes(anchor));
    if (i !== -1) return i;
  }
  return -1;
}

function levelFor(score: number): ConfidenceLevel {
  if (score >= 90) return 'alta';
  if (score >= 70) return 'media';
  if (score >= 50) return 'baixa';
  return 'nula';
}

function clamp(n: number): number {
  return Math.min(100, Math.max(0, n));
}

// ─── VALIDAÇÃO DE DATA/HORA ───────────────────────────────────────────────────

function validateDatetime(value: string): ValidationResult[] {
  const results: ValidationResult[] = [];
  const match = value.match(RE_DATETIME);

  results.push({ rule: 'formato_dd_mm_aaaa_hh_mm_ss', passed: !!match });
  if (!match) return results;

  const dd   = parseInt(match[1], 10);
  const mm   = parseInt(match[2], 10);
  const yyyy = parseInt(match[3], 10);
  const hh   = parseInt(match[4], 10);
  const min  = parseInt(match[5], 10);
  const ss   = parseInt(match[6], 10);

  results.push({ rule: 'mes_1_12',       passed: mm >= 1   && mm <= 12  });
  results.push({ rule: 'dia_1_31',       passed: dd >= 1   && dd <= 31  });
  results.push({ rule: 'hora_0_23',      passed: hh >= 0   && hh <= 23  });
  results.push({ rule: 'minuto_0_59',    passed: min >= 0  && min <= 59 });
  results.push({ rule: 'segundo_0_59',   passed: ss >= 0   && ss <= 59  });
  results.push({ rule: 'ano_2000_2099',  passed: yyyy >= 2000 && yyyy <= 2099 });

  // Valida que a data existe no calendário (ex: 31/02 não existe)
  const d = new Date(yyyy, mm - 1, dd);
  results.push({
    rule: 'data_existe_no_calendario',
    passed: d.getFullYear() === yyyy && d.getMonth() === mm - 1 && d.getDate() === dd,
  });

  return results;
}

// ─── EXTRATOR: CÓDIGO DE VERIFICAÇÃO ─────────────────────────────────────────

/**
 * CAMADAS:
 * 1. Busca por padrão: token alfanumérico maiúsculo 7-15 chars, não excluído.
 * 2. Localiza âncora "Código de verificação".
 * 3. Se múltiplos candidatos, seleciona o mais próximo da âncora.
 * 4. Valida formato e tamanho.
 * 5. Calcula pontuação de confiança.
 */
function extractCodigoVerificacao(segs: string[]): FieldResult {
  let score = 0;
  const validations: ValidationResult[] = [];

  // Camada 1 — busca por padrão
  const candidates = segs
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => RE_VERIFICATION.test(v) && RE_HAS_LETTER.test(v) && !EXCLUDED_FROM_VERIFICATION.has(v));

  validations.push({
    rule: 'candidatos_encontrados',
    passed: candidates.length > 0,
    detail: candidates.length > 0
      ? `${candidates.length} candidato(s): ${candidates.map(c => c.v).join(', ')}`
      : 'nenhum',
  });

  if (candidates.length === 0) {
    return { value: null, confidence: 0, level: 'nula', method: 'sem_candidatos', validations };
  }
  score += 40;

  // Camada 2 — âncora de label
  const anchorIdx = findAnchorIdx(segs, ANCHORS.codigoVerificacao);
  validations.push({ rule: 'label_encontrado', passed: anchorIdx !== -1 });
  if (anchorIdx !== -1) score += 20;

  // Camada 3 — seleção: mais próximo da âncora, ou primeiro se sem âncora
  const chosen = (anchorIdx !== -1 && candidates.length > 1)
    ? candidates.reduce((b, c) =>
        Math.abs(c.i - anchorIdx) < Math.abs(b.i - anchorIdx) ? c : b)
    : candidates[0];

  // Sem ambiguidade
  validations.push({
    rule: 'candidato_unico',
    passed: candidates.length === 1,
    detail: candidates.length > 1 ? `múltiplos: ${candidates.map(c => c.v).join(', ')}` : 'único',
  });
  if (candidates.length === 1) score += 10;

  // Camada 4 — proximidade à âncora
  if (anchorIdx !== -1) {
    const dist = Math.abs(chosen.i - anchorIdx);
    const near = dist <= 15;
    validations.push({ rule: 'proximo_label_ate_15_segmentos', passed: near, detail: `dist: ${dist}` });
    if (near) score += 15;
  }

  // Camada 4 — validação de formato
  validations.push({ rule: 'alfanumerico_maiusculo_sem_espacos', passed: RE_VERIFICATION.test(chosen.v) });
  score += 10;

  validations.push({ rule: 'tamanho_7_a_15_chars', passed: chosen.v.length >= 7 && chosen.v.length <= 15, detail: `${chosen.v.length} chars` });
  if (chosen.v.length >= 7 && chosen.v.length <= 15) score += 5;

  const final = clamp(score);
  return {
    value: chosen.v,
    confidence: final,
    level: levelFor(final),
    method: anchorIdx !== -1 ? 'pattern_com_ancora' : 'pattern_sem_ancora',
    validations,
  };
}

// ─── EXTRATOR: NÚMERO DA NOTA ─────────────────────────────────────────────────

/**
 * CAMADAS:
 * 1. Coleta todos os tokens puramente numéricos (sem pontos, vírgulas, barras).
 * 2. Localiza âncora "Número da nota".
 * 3. Filtra candidatos curtos (≤ 7 dígitos) — inscrições municipais/estaduais têm 8-9+.
 * 4. Seleciona o mais próximo da âncora dentro dos candidatos curtos.
 * 5. Valida e pontua.
 *
 * Observação estrutural (Fase 1): no PDF modelo, o valor aparece no segmento ~5
 * enquanto a âncora está no segmento ~47 (distância 42). A estratégia de "curto +
 * proximidade-relativa" isola o número da nota dos demais números do documento.
 */
function extractNumeroNota(segs: string[]): FieldResult {
  let score = 0;
  const validations: ValidationResult[] = [];

  // Camada 1 — candidatos numéricos puros
  const allNumeric = segs
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => RE_NUMERIC_ONLY.test(v));

  validations.push({
    rule: 'candidatos_numericos_encontrados',
    passed: allNumeric.length > 0,
    detail: `${allNumeric.length} candidato(s): ${allNumeric.map(c => c.v).join(', ')}`,
  });

  if (allNumeric.length === 0) {
    return { value: null, confidence: 0, level: 'nula', method: 'sem_candidatos', validations };
  }
  score += 25;

  // Camada 2 — âncora
  const anchorIdx = findAnchorIdx(segs, ANCHORS.numeroNota);
  validations.push({ rule: 'label_encontrado', passed: anchorIdx !== -1 });
  if (anchorIdx !== -1) score += 20;

  // Camada 3 — candidatos curtos (número da nota ≤ 7 dígitos; inscrições têm 8+)
  const shortCandidates = allNumeric.filter(c => c.v.length <= 7);
  validations.push({
    rule: 'candidatos_curtos_ate_7_digitos',
    passed: shortCandidates.length > 0,
    detail: shortCandidates.map(c => `${c.v}(idx:${c.i})`).join(', ') || 'nenhum',
  });

  let chosen: { v: string; i: number };
  let method: string;

  if (shortCandidates.length > 0) {
    chosen = anchorIdx !== -1
      ? shortCandidates.reduce((b, c) =>
          Math.abs(c.i - anchorIdx) < Math.abs(b.i - anchorIdx) ? c : b)
      : shortCandidates[0];
    method = anchorIdx !== -1 ? 'short_numeric_closest_anchor' : 'short_numeric_first';
    score += 20;
  } else {
    // fallback: qualquer numérico mais próximo da âncora
    chosen = anchorIdx !== -1
      ? allNumeric.reduce((b, c) =>
          Math.abs(c.i - anchorIdx) < Math.abs(b.i - anchorIdx) ? c : b)
      : allNumeric[0];
    method = 'fallback_any_numeric';
  }

  // Camada 4 — validação de valor
  const positive = parseInt(chosen.v, 10) > 0;
  validations.push({ rule: 'numero_positivo_nao_zero', passed: positive });
  if (positive) score += 10;

  // Camada 5 — proximidade à âncora
  if (anchorIdx !== -1) {
    const dist = Math.abs(chosen.i - anchorIdx);

    // Faixa ampla: aceita distâncias grandes devido ao scramble do PDF iText
    const withinRange = dist <= 60;
    validations.push({ rule: 'dentro_de_60_segmentos_da_ancora', passed: withinRange, detail: `dist: ${dist}` });
    if (withinRange) score += 20;

    // Bônus: se estiver muito próximo (PDF sem scramble ou futuro mapeamento posicional)
    const veryNear = dist <= 15;
    validations.push({ rule: 'muito_proximo_label_ate_15', passed: veryNear, detail: `dist: ${dist}` });
    if (veryNear) score += 5;
  }

  const final = clamp(score);
  return {
    value: chosen.v,
    confidence: final,
    level: levelFor(final),
    method,
    validations,
  };
}

// ─── EXTRATOR: DATAS ─────────────────────────────────────────────────────────

/**
 * CAMADAS:
 * 1. Coleta todas as ocorrências de DD/MM/AAAA HH:MM:SS no texto.
 * 2. Localiza âncoras "Data da emissão da nota" e "Data do fato gerador".
 * 3. Atribuição por ordem de stream: no PDF JasperReports/iText desta família,
 *    a emissão aparece antes do fato gerador no stream binário.
 * 4. Validação cruzada: compara proximidade de cada data com cada âncora.
 *    Se a ordem estiver invertida, aplica swap automático.
 * 5. Valida formato, calendário e intervalo de anos.
 * 6. Pontua e categoriza confiança.
 */
function extractDates(segs: string[]): { dataEmissao: FieldResult; dataFatoGerador: FieldResult } {
  const ev: ValidationResult[] = [];   // emissão validations
  const fv: ValidationResult[] = [];   // fato gerador validations

  // Camada 1 — encontrar todas as datas
  const datetimes = segs
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => RE_DATETIME.test(v));

  ev.push({ rule: 'datas_encontradas', passed: datetimes.length > 0, detail: `${datetimes.length} data(s)` });
  fv.push({ rule: 'datas_encontradas', passed: datetimes.length > 0, detail: `${datetimes.length} data(s)` });

  // Camada 2 — âncoras
  const emissaoAnchor = findAnchorIdx(segs, ANCHORS.dataEmissao);
  const fatoAnchor    = findAnchorIdx(segs, ANCHORS.dataFatoGerador);

  ev.push({ rule: 'label_data_emissao_encontrado',      passed: emissaoAnchor !== -1 });
  fv.push({ rule: 'label_data_fato_gerador_encontrado', passed: fatoAnchor    !== -1 });

  if (datetimes.length === 0) {
    const nil = (v: ValidationResult[]): FieldResult =>
      ({ value: null, confidence: 0, level: 'nula', method: 'sem_datas', validations: v });
    return { dataEmissao: nil(ev), dataFatoGerador: nil(fv) };
  }

  const hasTwoDates = datetimes.length >= 2;
  ev.push({ rule: 'duas_datas_no_pdf', passed: hasTwoDates });
  fv.push({ rule: 'duas_datas_no_pdf', passed: hasTwoDates });

  // Camada 3 — atribuição por ordem de stream
  let emissaoEntry = datetimes[0];
  let fatoEntry    = hasTwoDates ? datetimes[1] : datetimes[0];
  let emissaoMethod = hasTwoDates ? 'stream_order_primeiro' : 'unica_data_compartilhada';
  let fatoMethod    = hasTwoDates ? 'stream_order_segundo'  : 'unica_data_compartilhada';

  // Camada 4 — validação cruzada: confirmar via proximidade
  if (emissaoAnchor !== -1 && fatoAnchor !== -1 && hasTwoDates) {
    const d0ToE = Math.abs(datetimes[0].i - emissaoAnchor);
    const d1ToE = Math.abs(datetimes[1].i - emissaoAnchor);
    const d0ToF = Math.abs(datetimes[0].i - fatoAnchor);
    const d1ToF = Math.abs(datetimes[1].i - fatoAnchor);

    // Quando as âncoras estão adjacentes (≤ 3 posições), a diferença de proximidade
    // é marginal e não confiável — os valores anteriores sempre serão levemente
    // mais próximos da segunda âncora. Nesse caso, a ordem de stream é preferida.
    const labelsAdjacent = Math.abs(emissaoAnchor - fatoAnchor) <= 3;

    // Atribuição correta: cada data mais próxima da sua própria âncora do que da outra
    const assignOk = labelsAdjacent || (d0ToE < d0ToF && d1ToF < d1ToE);
    ev.push({
      rule: 'atribuicao_confirmada_por_proximidade',
      passed: assignOk,
      detail: labelsAdjacent ? 'ancoras_adjacentes_stream_order_usado' : `d0→E:${d0ToE},d1→F:${d1ToF}`,
    });
    fv.push({
      rule: 'atribuicao_confirmada_por_proximidade',
      passed: assignOk,
      detail: labelsAdjacent ? 'ancoras_adjacentes_stream_order_usado' : undefined,
    });

    if (!assignOk) {
      // Swap automático apenas quando a reversão é clara e não marginal
      [emissaoEntry, fatoEntry] = [fatoEntry, emissaoEntry];
      emissaoMethod = 'proximity_swap';
      fatoMethod    = 'proximity_swap';
    }
  }

  // Camada 5 — validação de formato e calendário
  const emissaoVals = validateDatetime(emissaoEntry.v);
  const fatoVals    = validateDatetime(fatoEntry.v);
  ev.push(...emissaoVals);
  fv.push(...fatoVals);

  // Camada 6 — pontuação
  function scoreDate(
    entry: { v: string; i: number },
    anchorIdx: number,
    dateVals: ValidationResult[],
    validations: ValidationResult[],
    twoFound: boolean,
  ): number {
    let s = 0;
    s += 40;  // data encontrada
    if (anchorIdx !== -1) s += 15;  // label encontrado
    if (twoFound) s += 10;           // duas datas distintas

    const formatOk = dateVals.every(v => v.passed);
    if (formatOk) s += 20;

    if (anchorIdx !== -1) {
      const dist = Math.abs(entry.i - anchorIdx);
      const near = dist <= 15;
      validations.push({ rule: 'proximo_label_ate_15_segmentos', passed: near, detail: `dist: ${dist}` });
      if (near) s += 15;
    }

    return clamp(s);
  }

  const emissaoScore = scoreDate(emissaoEntry, emissaoAnchor, emissaoVals, ev, hasTwoDates);
  const fatoScore    = scoreDate(fatoEntry,    fatoAnchor,    fatoVals,    fv, hasTwoDates);

  return {
    dataEmissao: {
      value: emissaoEntry.v,
      confidence: emissaoScore,
      level: levelFor(emissaoScore),
      method: emissaoMethod,
      validations: ev,
    },
    dataFatoGerador: {
      value: fatoEntry.v,
      confidence: fatoScore,
      level: levelFor(fatoScore),
      method: fatoMethod,
      validations: fv,
    },
  };
}

// ─── EXPORT PRINCIPAL ─────────────────────────────────────────────────────────

export async function extractCriticalFields(
  pdfBuffer: Buffer,
): Promise<CriticalFieldsResult> {
  const t0 = Date.now();

  const parsed = await pdfParse(pdfBuffer);
  const segs   = toSegments(parsed.text);

  const codigoVerificacao            = extractCodigoVerificacao(segs);
  const numeroNota                   = extractNumeroNota(segs);
  const { dataEmissao, dataFatoGerador } = extractDates(segs);

  const globalConfidence = Math.round(
    (codigoVerificacao.confidence +
     numeroNota.confidence +
     dataEmissao.confidence +
     dataFatoGerador.confidence) / 4,
  );

  return {
    numeroNota,
    codigoVerificacao,
    dataEmissao,
    dataFatoGerador,
    globalConfidence,
    globalLevel: levelFor(globalConfidence),
    extractionMs: Date.now() - t0,
    rawSegmentsCount: segs.length,
  };
}
