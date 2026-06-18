/**
 * Fase 3 — Extrator do Bloco PRESTADOR DE SERVIÇOS
 *
 * Descoberta estrutural crítica (Fase 1 + Fase 3):
 *   No PDF gerado por JasperReports/iText para esta família de NFS-e,
 *   os dados do TOMADOR aparecem ANTES dos dados do PRESTADOR no stream
 *   binário, mesmo que visualmente o PRESTADOR apareça acima do TOMADOR.
 *
 * Regra de zona:
 *   1ª ocorrência de "Endereço:" no stream → zona TOMADOR
 *   2ª ocorrência de "Endereço:" no stream → zona PRESTADOR (início)
 *
 * Delimitação do fim da zona PRESTADOR:
 *   Primeiro segmento após o início que seja âncora de seção subsequente
 *   ("DISCRIMINAÇÃO DOS SERVIÇOS", "Forma de Pagamento", "Número da nota...",
 *   "MUNICIPIO DE DOURADOS") ou limite de 25 segmentos — o que vier primeiro.
 */

import pdfParse from 'pdf-parse';
import type { ValidationResult, ConfidenceLevel } from './types';
import {
  findValidEnderecoSegments,
  isZoneEndMarker,
  normalizeEnderecoSegment,
  isEnderecoAnchor,
  COMPANY_SUFFIX_RE,
  INSCR_TEXTUAL_RE,
  isPersonName,
} from './ocr-normalizer';

// ─── TIPOS ESPECÍFICOS DA FASE 3 ─────────────────────────────────────────────

export interface PrestadorField {
  valor: string | null;
  confianca: number;
  nivel: ConfidenceLevel;
  metodo: string;
  validacoes: ValidationResult[];
}

export interface PrestadorResult {
  prestador: {
    razao_social:        PrestadorField;
    nome_fantasia:       PrestadorField;
    cpf_cnpj:            PrestadorField;
    inscricao_municipal: PrestadorField;
    inscricao_estadual:  PrestadorField;
    endereco:            PrestadorField;
    numero:              PrestadorField;
    complemento:         PrestadorField;
    bairro:              PrestadorField;
    cep:                 PrestadorField;
    municipio:           PrestadorField;
    uf:                  PrestadorField;
    email:               PrestadorField;
    telefone:            PrestadorField;
    celular:             PrestadorField;
    site:                PrestadorField;
  };
  zona: {
    inicio:     number;   // índice absoluto no array de segmentos
    fim:        number;
    segmentos:  string[];
    estrategia: string;
  };
  globalConfidence: number;
  globalLevel:      ConfidenceLevel;
  extractionMs:     number;
}

// ─── PADRÕES ──────────────────────────────────────────────────────────────────

const RE_CNPJ      = /^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})-(\d{2})$/;
const RE_CPF       = /^(\d{3})\.(\d{3})\.(\d{3})-(\d{2})$/;
const RE_EMAIL     = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/i;
const RE_PHONE     = /^\(\d{2}\)\s*\d{4,5}[-\s]?\d{4}$/;
const RE_CEP_IN    = /CEP:\s*(\d{5}-?\d{3})/;
const RE_NUM_IN    = /Número:\s*(\S+)/;
const RE_BAIRRO_IN = /Bairro:\s*(.+?)\s+CEP:/;
const RE_LOGR_IN   = /^Endereço:\s*(.+?)\s+Número:/;
const RE_INSCR_MUN = /^\d{6,12}$/;        // inscrição municipal: numérico puro, 6-12 dígitos
const RE_UF_MUNI   = /^([A-Z]{2})([A-Z][a-zA-ZÀ-ÿ].*)/; // "MSDourados" → MS + Dourados
const RE_ALL_CAPS  = /^[A-Z][A-Z\s]+$/;   // nome fantasia: maiúsculas e espaços
const RE_HAS_LOWER = /[a-z]/;             // razão social: tem letra minúscula
const RE_URL       = /^(https?:\/\/|www\.)/i;

// COMPANY_SUFFIX_RE importado de ./ocr-normalizer (Fase 4.6: inclui MEI, EI)

// Siglas de UF válidas
const VALID_UFS = new Set([
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
  'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
]);

// Âncoras de seção: isZoneEndMarker importado de ./ocr-normalizer
// ('pagina'/'página' removidos na Fase 4.6 — eram substring match genérico demais)

// Âncoras de label dentro da zona PRESTADOR
const LABELS_PRESTADOR = {
  razaoSocial:      ['nome/razão social:', 'nome/razao social:'],
  nomeFantasia:     ['nome fantasia:'],
  cpfCnpj:          ['cpf/cnpj:', 'inscrição municipal:cpf/cnpj:', 'inscricao municipal:cpf/cnpj:'],
  inscrMunicipal:   ['inscrição municipal:', 'inscricao municipal:'],
  inscrEstadual:    ['inscrição estadual:', 'inscricao estadual:'],
  municipio:        ['município:', 'municipio:'],
  uf:               ['uf:'],
  email:            ['e-mail:'],
  telefone:         ['telefone:'],
  celular:          ['celular:'],
  complemento:      ['complemento:'],
  site:             ['site:'],
};

// ─── UTILITÁRIOS ─────────────────────────────────────────────────────────────

function toSegments(raw: string): string[] {
  return raw.split('\n').map(s => s.trim()).filter(s => s.length > 0);
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

/** Encontra o índice de um label (substring) dentro de um array de segmentos. */
function findLabel(zone: string[], labels: string[]): number {
  const lower = zone.map(s => s.toLowerCase());
  for (const lbl of labels) {
    const i = lower.findIndex(s => s.includes(lbl));
    if (i !== -1) return i;
  }
  return -1;
}

/** Cria um FieldResult nulo com razão descrita. */
function nullField(reason: string, labelFound = false): PrestadorField {
  return {
    valor: null,
    confianca: labelFound ? 70 : 50,
    nivel: levelFor(labelFound ? 70 : 50),
    metodo: 'campo_ausente',
    validacoes: [{ rule: 'valor_encontrado', passed: false, detail: reason }],
  };
}

/** Normaliza complemento: "**" e variantes são placeholder de vazio → null. */
function normalizeComplemento(v: string): string | null {
  const t = v.trim();
  if (/^\*+$/.test(t) || t === '' || t === '-' || t.toLowerCase() === 'n/a') return null;
  return t;
}

// ─── VALIDAÇÃO DE CNPJ (dígitos verificadores) ────────────────────────────────

function validateCNPJ(cnpj: string): boolean {
  const d = cnpj.replace(/\D/g, '');
  if (d.length !== 14) return false;
  if (/^(\d)\1+$/.test(d)) return false; // todos os dígitos iguais

  const calc = (weights: number[]): number => {
    const sum = weights.reduce((acc, w, i) => acc + parseInt(d[i]) * w, 0);
    const rem = sum % 11;
    return rem < 2 ? 0 : 11 - rem;
  };
  const d1 = calc([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return parseInt(d[12]) === d1 && parseInt(d[13]) === d2;
}

function validateCPF(cpf: string): boolean {
  const d = cpf.replace(/\D/g, '');
  if (d.length !== 11) return false;
  if (/^(\d)\1+$/.test(d)) return false;

  const calc = (len: number): number => {
    const sum = Array.from({ length: len }, (_, i) => parseInt(d[i]) * (len + 1 - i))
      .reduce((a, b) => a + b, 0);
    const rem = (sum * 10) % 11;
    return rem >= 10 ? 0 : rem;
  };
  return parseInt(d[9]) === calc(9) && parseInt(d[10]) === calc(10);
}

// ─── DETECTORES DE ZONA ───────────────────────────────────────────────────────

function detectPrestadorZone(segs: string[]): { start: number; end: number; strategy: string } {
  // Fase 4.6: findValidEnderecoSegments ignora "Endereço:" dentro da discriminação dos serviços
  const enderecos = findValidEnderecoSegments(segs);

  // Regra primária: 2ª ocorrência válida de "Endereço:" = início da zona PRESTADOR
  if (enderecos.length >= 2) {
    const start = enderecos[1].i;
    // Fase 4.6: isZoneEndMarker substitui ZONE_END_MARKERS inline; usa match exato para "Página N/M"
    const endMarkerIdx = segs.findIndex((s, i) => i > start && isZoneEndMarker(s));
    const end = endMarkerIdx !== -1
      ? endMarkerIdx - 1
      : Math.min(segs.length - 1, start + 35);  // Fase 4.6: cap 24→35 para zonas longas
    return { start, end, strategy: 'segunda_ocorrencia_endereco' };
  }

  // Fallback: 1 endereço → tentar localizar por âncora "PRESTADOR DE SERVIÇOS"
  const prestadorHeaderIdx = segs.findIndex(s =>
    s.toLowerCase().includes('prestador de serviços') || s.toLowerCase().includes('prestador de servicos')
  );
  if (prestadorHeaderIdx !== -1 && enderecos.length === 1) {
    const start = enderecos[0].i;
    const end   = Math.min(segs.length - 1, start + 35);
    return { start, end, strategy: 'unico_endereco_fallback' };
  }

  return { start: -1, end: -1, strategy: 'zona_nao_detectada' };
}

// ─── EXTRATORES DE CAMPO ──────────────────────────────────────────────────────

function extractCpfCnpj(zone: string[]): PrestadorField {
  const validations: ValidationResult[] = [];
  let score = 0;

  // Fase 4.6: hoist labelIdx para desempatar múltiplos CNPJs por proximidade ao label
  const labelIdx  = findLabel(zone, LABELS_PRESTADOR.cpfCnpj);
  const allCnpjs  = zone.map((s, i) => ({ s, i })).filter(({ s }) => RE_CNPJ.test(s));
  const cnpjMatch = allCnpjs.length > 1 && labelIdx !== -1
    ? allCnpjs.reduce((a, b) => Math.abs(a.i - labelIdx) <= Math.abs(b.i - labelIdx) ? a : b)
    : allCnpjs[0] ?? null;
  const cpfMatch  = !cnpjMatch ? zone.map((s, i) => ({ s, i })).find(({ s }) => RE_CPF.test(s)) : null;
  const match = cnpjMatch ?? cpfMatch;
  const tipo  = cnpjMatch ? 'CNPJ' : cpfMatch ? 'CPF' : null;

  validations.push({ rule: 'padrao_encontrado', passed: !!match, detail: tipo ?? 'nenhum' });
  if (!match) return nullField('CNPJ/CPF não encontrado na zona PRESTADOR');
  score += 50;

  const valor = match.s;
  validations.push({ rule: 'label_encontrado', passed: labelIdx !== -1 });
  if (labelIdx !== -1) score += 15;

  // Validação dos dígitos verificadores
  const dvOk = tipo === 'CNPJ' ? validateCNPJ(valor) : tipo === 'CPF' ? validateCPF(valor) : false;
  validations.push({ rule: 'digitos_verificadores_validos', passed: dvOk });
  if (dvOk) score += 25;

  // Comprimento esperado
  const lenOk = tipo === 'CNPJ'
    ? valor.replace(/\D/g, '').length === 14
    : valor.replace(/\D/g, '').length === 11;
  validations.push({ rule: 'comprimento_correto', passed: lenOk });
  if (lenOk) score += 10;

  return {
    valor,
    confianca: clamp(score),
    nivel: levelFor(clamp(score)),
    metodo: `pattern_${tipo?.toLowerCase() ?? 'cpfcnpj'}`,
    validacoes: validations,
  };
}

function extractEmail(zone: string[]): PrestadorField {
  const validations: ValidationResult[] = [];
  let score = 0;

  const match = zone.map((s, i) => ({ s, i })).find(({ s }) => RE_EMAIL.test(s));
  validations.push({ rule: 'padrao_email_encontrado', passed: !!match });
  if (!match) {
    const labelIdx = findLabel(zone, LABELS_PRESTADOR.email);
    return nullField('e-mail não encontrado na zona', labelIdx !== -1);
  }
  score += 50;

  const valor = match.s.toLowerCase();
  const labelIdx = findLabel(zone, LABELS_PRESTADOR.email);
  validations.push({ rule: 'label_encontrado', passed: labelIdx !== -1 });
  if (labelIdx !== -1) score += 15;

  // Tem @ e domínio com ponto
  const hasAt = valor.includes('@');
  const hasDomain = /\.[a-z]{2,}$/.test(valor);
  validations.push({ rule: 'tem_arroba', passed: hasAt });
  validations.push({ rule: 'tem_dominio_com_ponto', passed: hasDomain });
  if (hasAt && hasDomain) score += 30;

  // Sem espaços
  const noSpaces = !valor.includes(' ');
  validations.push({ rule: 'sem_espacos', passed: noSpaces });
  if (noSpaces) score += 5;

  return {
    valor,
    confianca: clamp(score),
    nivel: levelFor(clamp(score)),
    metodo: 'pattern_email',
    validacoes: validations,
  };
}

/**
 * Atribuição bipartida de telefones: cada número vai para o label mais próximo,
 * sem sobreposição. Evita que o mesmo número seja atribuído a Telefone e Celular
 * quando há apenas um número na zona.
 */
function extractPhones(zone: string[]): { telefone: PrestadorField; celular: PrestadorField } {
  const phones   = zone.map((s, i) => ({ s, i })).filter(({ s }) => RE_PHONE.test(s));
  const telLabel = findLabel(zone, LABELS_PRESTADOR.telefone);
  const celLabel = findLabel(zone, LABELS_PRESTADOR.celular);

  type Assign = { phone: typeof phones[0]; dist: number } | null;
  let telAssign: Assign = null;
  let celAssign: Assign = null;

  for (const phone of phones) {
    const dTel = telLabel !== -1 ? Math.abs(phone.i - telLabel) : Infinity;
    const dCel = celLabel !== -1 ? Math.abs(phone.i - celLabel) : Infinity;

    if (dTel <= dCel) {
      if (!telAssign || dTel < telAssign.dist) telAssign = { phone, dist: dTel };
    } else {
      if (!celAssign || dCel < celAssign.dist) celAssign = { phone, dist: dCel };
    }
  }

  const buildField = (assign: Assign, labelIdx: number, name: string): PrestadorField => {
    if (!assign) {
      return {
        valor: null,
        confianca: labelIdx !== -1 ? 75 : 50,
        nivel: levelFor(labelIdx !== -1 ? 75 : 50),
        metodo: 'label_encontrado_valor_ausente',
        validacoes: [
          { rule: 'label_encontrado',    passed: labelIdx !== -1 },
          { rule: 'telefone_encontrado', passed: false, detail: `${name} sem número exclusivo na zona` },
        ],
      };
    }

    const valor = assign.phone.s;
    const ddd   = valor.match(/^\((\d{2})\)/)?.[1];
    const dddOk = !!ddd && parseInt(ddd) >= 11;
    const numOk = /\d{4,5}[-\s]?\d{4}/.test(valor.replace(/^\(\d{2}\)\s*/, ''));
    const score = clamp(40 + (labelIdx !== -1 ? 20 : 0) + (dddOk ? 20 : 0) + (numOk ? 20 : 0));

    return {
      valor,
      confianca: score,
      nivel: levelFor(score),
      metodo: 'bipartite_nearest_label',
      validacoes: [
        { rule: 'label_encontrado',      passed: labelIdx !== -1 },
        { rule: 'telefone_encontrado',   passed: true },
        { rule: 'ddd_formato_valido',    passed: dddOk, detail: `DDD: ${ddd}` },
        { rule: 'numero_formato_valido', passed: numOk },
        { rule: 'proximo_ao_label',      passed: assign.dist <= 10, detail: `dist: ${assign.dist}` },
      ],
    };
  };

  return {
    telefone: buildField(telAssign, telLabel, 'Telefone'),
    celular:  buildField(celAssign, celLabel,  'Celular'),
  };
}

function extractEndereco(zone: string[]): {
  endereco: PrestadorField;
  numero: PrestadorField;
  bairro: PrestadorField;
  cep: PrestadorField;
} {
  // Fase 4.6: normaliza variações OCR do segmento Endereço antes de parsear
  const rawOrig = zone[0] ?? '';
  const raw     = normalizeEnderecoSegment(rawOrig);
  const foundAnchor = isEnderecoAnchor(rawOrig);

  function makeField(
    valor: string | null,
    rule: string,
    score: number,
    method: string,
    extra?: ValidationResult[],
  ): PrestadorField {
    return {
      valor,
      confianca: clamp(score),
      nivel: levelFor(clamp(score)),
      metodo: method,
      validacoes: [
        { rule: 'linha_endereco_encontrada', passed: foundAnchor },
        { rule, passed: !!valor },
        ...(extra ?? []),
      ],
    };
  }

  const logrMatch  = raw.match(RE_LOGR_IN);
  const numMatch   = raw.match(RE_NUM_IN);
  const bairroMatch = raw.match(RE_BAIRRO_IN);
  const cepMatch   = raw.match(RE_CEP_IN);

  const logradouro = logrMatch?.[1]?.trim() ?? null;
  const numero     = numMatch?.[1]?.trim() ?? null;
  const bairro     = bairroMatch?.[1]?.trim() ?? null;
  const cepRaw     = cepMatch?.[1]?.replace(/\D/g, '') ?? null;
  const cep        = cepRaw?.length === 8 ? `${cepRaw.slice(0, 5)}-${cepRaw.slice(5)}` : cepRaw;

  const cepValidation: ValidationResult[] = cep ? [
    { rule: 'cep_8_digitos', passed: cepRaw?.length === 8 },
    { rule: 'cep_formato_xxxxx_xxx', passed: /^\d{5}-\d{3}$/.test(cep ?? '') },
  ] : [];

  return {
    endereco:  makeField(logradouro, 'logradouro_extraido', logradouro ? 95 : 0, 'regex_logradouro'),
    numero:    makeField(numero,     'numero_extraido',     numero     ? 90 : 0, 'regex_numero'),
    bairro:    makeField(bairro,     'bairro_extraido',     bairro     ? 90 : 0, 'regex_bairro'),
    cep:       makeField(cep,        'cep_extraido',        cep        ? 95 : 0, 'regex_cep', cepValidation),
  };
}

function extractUfMunicipio(zone: string[]): { uf: PrestadorField; municipio: PrestadorField } {
  const validations: ValidationResult[] = [];

  // Padrão: "MSDourados" → UF concaten. com Município
  const match = zone
    .map((s, i) => ({ s, i }))
    .find(({ s }) => RE_UF_MUNI.test(s) && !s.includes(':') && !s.includes(' '));

  validations.push({ rule: 'padrao_uf_municipio_concatenado', passed: !!match });

  if (!match) {
    return {
      uf:        nullField('UF não encontrada na zona'),
      municipio: nullField('Município não encontrado na zona'),
    };
  }

  const parts = match.s.match(RE_UF_MUNI);
  const uf    = parts?.[1] ?? null;
  const muni  = parts?.[2] ?? null;

  const ufOk   = !!uf && VALID_UFS.has(uf);
  const muniOk = !!muni && muni.length >= 3;

  return {
    uf: {
      valor: uf,
      confianca: clamp(uf ? (ufOk ? 100 : 60) : 0),
      nivel: levelFor(ufOk ? 100 : uf ? 60 : 0),
      metodo: 'split_uf_municipio_concatenado',
      validacoes: [
        ...validations,
        { rule: 'uf_valida_brasil', passed: ufOk, detail: uf ?? 'N/A' },
        { rule: 'dois_caracteres', passed: (uf?.length ?? 0) === 2 },
      ],
    },
    municipio: {
      valor: muni,
      confianca: clamp(muni ? (muniOk ? 90 : 50) : 0),
      nivel: levelFor(muniOk ? 90 : muni ? 50 : 0),
      metodo: 'split_uf_municipio_concatenado',
      validacoes: [
        ...validations,
        { rule: 'municipio_3_chars_minimo', passed: muniOk, detail: muni ?? 'N/A' },
      ],
    },
  };
}

function extractInscricaoMunicipal(zone: string[], cnpj: string | null): PrestadorField {
  const validations: ValidationResult[] = [];
  let score = 0;

  const labelIdx = findLabel(zone, LABELS_PRESTADOR.inscrMunicipal);
  validations.push({ rule: 'label_encontrado', passed: labelIdx !== -1 });
  if (labelIdx !== -1) score += 15;

  // Fase 4.6: suporta inscrições textuais (ISENTO, NÃO CONTRIBUINTE, etc.)
  const cnpjClean  = cnpj?.replace(/\D/g, '') ?? '';
  const textualIdx = zone.findIndex((s, i) =>
    INSCR_TEXTUAL_RE.test(s) && (labelIdx === -1 || Math.abs(i - labelIdx) <= 5)
  );
  const candidates = zone
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => RE_INSCR_MUN.test(s) && s.replace(/\D/g, '') !== cnpjClean);

  validations.push({ rule: 'candidatos_encontrados', passed: candidates.length > 0 || textualIdx !== -1, detail: `${candidates.length}` });

  if (candidates.length === 0) {
    if (textualIdx !== -1) {
      return {
        valor: zone[textualIdx],
        confianca: clamp(60 + (labelIdx !== -1 ? 20 : 0)),
        nivel: levelFor(60 + (labelIdx !== -1 ? 20 : 0)),
        metodo: 'inscricao_textual',
        validacoes: [...validations, { rule: 'valor_textual_valido', passed: true, detail: zone[textualIdx] }],
      };
    }
    return nullField('inscrição municipal não encontrada', labelIdx !== -1);
  }
  score += 35;

  // Mais próximo do label
  const chosen = labelIdx !== -1
    ? candidates.reduce((b, c) => Math.abs(c.i - labelIdx) < Math.abs(b.i - labelIdx) ? c : b)
    : candidates[0];

  score += 30; // valor selecionado

  // Comprimento razoável (6-10 dígitos típico para inscrição municipal)
  const lenOk = chosen.s.length >= 6 && chosen.s.length <= 12;
  validations.push({ rule: 'comprimento_6_12_digitos', passed: lenOk, detail: `${chosen.s.length} dígitos` });
  if (lenOk) score += 20;

  return {
    valor: chosen.s,
    confianca: clamp(score),
    nivel: levelFor(clamp(score)),
    metodo: 'numeric_nearest_label',
    validacoes: validations,
  };
}

function extractInscricaoEstadual(zone: string[], cnpj: string | null, inscMuni: string | null): PrestadorField {
  const validations: ValidationResult[] = [];
  const labelIdx = findLabel(zone, LABELS_PRESTADOR.inscrEstadual);
  validations.push({ rule: 'label_encontrado', passed: labelIdx !== -1 });

  if (labelIdx === -1) return nullField('label inscrição estadual não encontrado');

  const cnpjClean    = cnpj?.replace(/\D/g, '') ?? '';
  const inscMuniClean = inscMuni ?? '';

  // Candidatos: numérico puro próximo ao label, diferente de CNPJ e inscrição municipal
  const candidates = zone
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) =>
      RE_INSCR_MUN.test(s) &&
      s !== inscMuniClean &&
      s.replace(/\D/g, '') !== cnpjClean &&
      Math.abs(i - labelIdx) <= 8
    );

  // Fase 4.6: verifica valores textuais (ISENTO, NÃO CONTRIBUINTE) próximos ao label
  if (candidates.length === 0) {
    const textualIdx = zone.findIndex((s, i) =>
      INSCR_TEXTUAL_RE.test(s) && s !== (inscMuni ?? '') && Math.abs(i - labelIdx) <= 8
    );
    if (textualIdx !== -1) {
      return {
        valor: zone[textualIdx],
        confianca: 75,
        nivel: 'media',
        metodo: 'inscricao_textual',
        validacoes: [...validations, { rule: 'valor_textual_valido', passed: true, detail: zone[textualIdx] }],
      };
    }
    return {
      valor: null,
      confianca: 75,
      nivel: 'media',
      metodo: 'label_encontrado_valor_ausente',
      validacoes: [...validations, { rule: 'valor_presente', passed: false, detail: 'campo vazio' }],
    };
  }

  const chosen = candidates[0];
  return {
    valor: chosen.s,
    confianca: 80,
    nivel: 'alta',
    metodo: 'numeric_near_label',
    validacoes: [...validations, { rule: 'valor_presente', passed: true }],
  };
}

const RE_PLACEHOLDER = /^\*+$|^-+$|^N\/A$/i;

function extractComplemento(zone: string[]): PrestadorField {
  const validations: ValidationResult[] = [];

  const labelIdx = findLabel(zone, LABELS_PRESTADOR.complemento);
  validations.push({ rule: 'label_encontrado', passed: labelIdx !== -1 });

  // Tier 1: placeholder explícito ("**", "---", "N/A") — valor inequívoco de campo vazio.
  // Tem prioridade sobre a busca por proximidade porque é o padrão canônico desta família
  // de NFS-e gerada pelo JasperReports para complemento ausente.
  const placeholder = zone.map((s, i) => ({ s, i })).find(({ s }) => RE_PLACEHOLDER.test(s));
  if (placeholder) {
    validations.push({
      rule: 'placeholder_detectado',
      passed: true,
      detail: `"${placeholder.s}" → null`,
    });
    return {
      valor: null,
      confianca: labelIdx !== -1 ? 95 : 75,
      nivel: levelFor(labelIdx !== -1 ? 95 : 75),
      metodo: 'placeholder_detected',
      validacoes: validations,
    };
  }

  // Tier 2: busca por proximidade — exclui labels, padrões conhecidos, nome fantasia e razão social
  const knownPatterns = [RE_CNPJ, RE_CPF, RE_EMAIL, RE_PHONE, RE_INSCR_MUN];
  const candidates = zone
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) =>
      i !== labelIdx &&
      labelIdx !== -1 &&
      Math.abs(i - labelIdx) <= 20 &&
      !s.includes(':') &&
      !knownPatterns.some(re => re.test(s)) &&
      !/^[A-Z]{2}[A-Z]/.test(s) &&               // não é UF+Município concatenado
      !(RE_ALL_CAPS.test(s) && s.includes(' ')) && // não é nome fantasia (ALL_CAPS multi-palavra)
      !RE_HAS_LOWER.test(s)                        // não é razão social (mixed case)
    );

  if (candidates.length === 0) {
    return nullField('complemento não encontrado ou vazio', labelIdx !== -1);
  }

  const chosen = candidates.reduce((b, c) =>
    Math.abs(c.i - labelIdx) < Math.abs(b.i - labelIdx) ? c : b);

  const normalized = normalizeComplemento(chosen.s);

  validations.push({
    rule: 'valor_normalizado',
    passed: true,
    detail: normalized === null ? `"${chosen.s}" → null (placeholder)` : normalized,
  });

  return {
    valor: normalized,
    confianca: clamp(normalized !== null ? 70 : 60),
    nivel: levelFor(normalized !== null ? 70 : 60),
    metodo: 'proximity_normalized',
    validacoes: validations,
  };
}

function extractRazaoSocial(zone: string[]): PrestadorField {
  const validations: ValidationResult[] = [];
  let score = 0;

  const labelIdx = findLabel(zone, LABELS_PRESTADOR.razaoSocial);
  validations.push({ rule: 'label_encontrado', passed: labelIdx !== -1 });
  if (labelIdx !== -1) score += 15;

  // Candidatos: strings com letra minúscula (mixed case) e múltiplas palavras
  const knownPatterns = [RE_CNPJ, RE_CPF, RE_EMAIL, RE_PHONE, RE_INSCR_MUN];
  const candidates = zone
    .map((s, i) => ({ s, i }))
    .filter(({ s }) =>
      RE_HAS_LOWER.test(s) &&          // tem minúscula → não é seção header nem nome fantasia
      s.split(' ').length >= 2 &&       // múltiplas palavras
      !s.includes(':') &&               // não é label
      !knownPatterns.some(re => re.test(s))
    );

  validations.push({ rule: 'candidatos_mixed_case', passed: candidates.length > 0, detail: `${candidates.length}` });

  // Fase 4.6: fallback pessoa física (MEI, autônomo, prestador sem sufixo jurídico)
  if (candidates.length === 0) {
    const personName = zone
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => isPersonName(s))
      .sort((a, b) => labelIdx !== -1 ? Math.abs(a.i - labelIdx) - Math.abs(b.i - labelIdx) : a.i - b.i)[0];
    if (personName) {
      validations.push({ rule: 'pessoa_fisica_detectada', passed: true, detail: personName.s });
      return {
        valor: personName.s,
        confianca: clamp(50 + (labelIdx !== -1 ? 15 : 0)),
        nivel: levelFor(50 + (labelIdx !== -1 ? 15 : 0)),
        metodo: 'pessoa_fisica_fallback',
        validacoes: validations,
      };
    }
    return nullField('razão social não encontrada');
  }
  score += 35;

  // Preferir o que tem sufixo de natureza jurídica (Fase 4.6: inclui MEI, EI via ocr-normalizer)
  const withSuffix = candidates.filter(c => COMPANY_SUFFIX_RE.test(c.s));
  const chosen     = withSuffix.length > 0 ? withSuffix[0] : candidates[0];

  const hasSuffix = COMPANY_SUFFIX_RE.test(chosen.s);
  validations.push({ rule: 'sufixo_natureza_juridica', passed: hasSuffix, detail: chosen.s });
  if (hasSuffix) score += 30;

  // Proximidade ao label
  if (labelIdx !== -1) {
    const dist = Math.abs(chosen.i - labelIdx);
    validations.push({ rule: 'proximo_ao_label_ate_10', passed: dist <= 10, detail: `dist: ${dist}` });
    if (dist <= 10) score += 20;
  }

  return {
    valor: chosen.s,
    confianca: clamp(score),
    nivel: levelFor(clamp(score)),
    metodo: hasSuffix ? 'mixed_case_with_suffix' : 'mixed_case_nearest_label',
    validacoes: validations,
  };
}

function extractNomeFantasia(zone: string[]): PrestadorField {
  const validations: ValidationResult[] = [];
  let score = 0;

  const labelIdx = findLabel(zone, LABELS_PRESTADOR.nomeFantasia);
  validations.push({ rule: 'label_encontrado', passed: labelIdx !== -1 });
  if (labelIdx !== -1) score += 15;

  // Nome fantasia: ALL CAPS, múltiplas palavras, sem caracteres especiais além de espaço
  const knownHeaders = ['PRESTADOR DE SERVIÇOS', 'TOMADOR DE SERVIÇOS', 'DISCRIMINAÇÃO',
    'RETENÇÕES', 'OUTRAS', 'INFORMAÇÕES', 'FEDERAL', 'MUNICIPIO'];

  const candidates = zone
    .map((s, i) => ({ s, i }))
    .filter(({ s }) =>
      RE_ALL_CAPS.test(s) &&
      s.split(' ').length >= 2 &&
      !knownHeaders.some(h => s.includes(h)) &&
      !s.includes(':')
    );

  validations.push({ rule: 'candidatos_all_caps', passed: candidates.length > 0, detail: `${candidates.length}` });
  if (candidates.length === 0) return nullField('nome fantasia não encontrado');
  score += 35;

  const chosen = labelIdx !== -1
    ? candidates.reduce((b, c) => Math.abs(c.i - labelIdx) < Math.abs(b.i - labelIdx) ? c : b)
    : candidates[0];

  validations.push({ rule: 'apenas_maiusculas', passed: RE_ALL_CAPS.test(chosen.s) });
  score += 30;

  if (labelIdx !== -1) {
    const dist = Math.abs(chosen.i - labelIdx);
    validations.push({ rule: 'proximo_ao_label_ate_10', passed: dist <= 10, detail: `dist: ${dist}` });
    if (dist <= 10) score += 20;
  }

  return {
    valor: chosen.s,
    confianca: clamp(score),
    nivel: levelFor(clamp(score)),
    metodo: 'all_caps_nearest_label',
    validacoes: validations,
  };
}

function extractSite(zone: string[]): PrestadorField {
  const labelIdx = findLabel(zone, LABELS_PRESTADOR.site);
  const urlMatch = zone.find(s => RE_URL.test(s));

  if (!urlMatch) {
    return {
      valor: null,
      confianca: labelIdx !== -1 ? 75 : 50,
      nivel: labelIdx !== -1 ? 'media' : 'baixa',
      metodo: 'label_encontrado_valor_ausente',
      validacoes: [
        { rule: 'label_encontrado', passed: labelIdx !== -1 },
        { rule: 'url_encontrada', passed: false, detail: 'campo vazio' },
      ],
    };
  }

  return {
    valor: urlMatch,
    confianca: 85,
    nivel: 'alta',
    metodo: 'pattern_url',
    validacoes: [
      { rule: 'label_encontrado', passed: labelIdx !== -1 },
      { rule: 'url_encontrada', passed: true },
    ],
  };
}

// ─── CÁLCULO DA CONFIANÇA GLOBAL ─────────────────────────────────────────────

function globalConfidence(prestador: PrestadorResult['prestador']): number {
  const fields = Object.values(prestador);
  const sum = fields.reduce((acc, f) => acc + f.confianca, 0);
  return Math.round(sum / fields.length);
}

// ─── EXPORT PRINCIPAL ─────────────────────────────────────────────────────────

export async function extractPrestador(pdfBuffer: Buffer): Promise<PrestadorResult> {
  const t0  = Date.now();
  const raw = await pdfParse(pdfBuffer);
  const segs = toSegments(raw.text);

  // 1. Detectar zona PRESTADOR
  const { start, end, strategy } = detectPrestadorZone(segs);

  if (start === -1) {
    throw new Error('Zona PRESTADOR não detectada no PDF. Verifique se o PDF contém a seção "Endereço:".');
  }

  const zone     = segs.slice(start, end + 1);
  const zoneData = { inicio: start, fim: end, segmentos: zone, estrategia: strategy };

  // 2. Extrair campos
  const cpfCnpjField          = extractCpfCnpj(zone);
  const emailField            = extractEmail(zone);
  const { telefone: telefoneField, celular: celularField } = extractPhones(zone);
  const { uf, municipio }= extractUfMunicipio(zone);
  const inscrMuniField   = extractInscricaoMunicipal(zone, cpfCnpjField.valor);
  const inscrEstField    = extractInscricaoEstadual(zone, cpfCnpjField.valor, inscrMuniField.valor);
  const { endereco, numero, bairro, cep } = extractEndereco(zone);
  const complementoField = extractComplemento(zone);
  const razaoSocialField = extractRazaoSocial(zone);
  const nomeFantasiaField= extractNomeFantasia(zone);
  const siteField        = extractSite(zone);

  const prestador: PrestadorResult['prestador'] = {
    razao_social:        razaoSocialField,
    nome_fantasia:       nomeFantasiaField,
    cpf_cnpj:            cpfCnpjField,
    inscricao_municipal: inscrMuniField,
    inscricao_estadual:  inscrEstField,
    endereco,
    numero,
    complemento:         complementoField,
    bairro,
    cep,
    municipio,
    uf,
    email:               emailField,
    telefone:            telefoneField,
    celular:             celularField,
    site:                siteField,
  };

  const gc = globalConfidence(prestador);

  return {
    prestador,
    zona: zoneData,
    globalConfidence: gc,
    globalLevel: levelFor(gc),
    extractionMs: Date.now() - t0,
  };
}
