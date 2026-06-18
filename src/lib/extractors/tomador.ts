/**
 * Fase 4 — Extrator do Bloco TOMADOR DE SERVIÇOS
 *
 * Descobertas estruturais desta fase (confirmadas pelo PDF modelo):
 *
 * 1. SEPARAÇÃO DE ZONAS
 *    O stream binário do PDF (JasperReports/iText) coloca o TOMADOR ANTES do
 *    PRESTADOR, invertido em relação à ordem visual. A regra de zona é:
 *      - Zona TOMADOR: tudo antes da 2ª ocorrência de "Endereço:"
 *      - Zona PRESTADOR: a partir da 2ª ocorrência de "Endereço:"
 *    Essa fronteira é absoluta: nenhum dado do PRESTADOR penetra na zona TOMADOR.
 *
 * 2. RUÍDO NO INÍCIO DA ZONA
 *    A zona TOMADOR (idx 0–26 no modelo) começa com cabeçalhos e dados da Fase 2
 *    que não pertencem ao TOMADOR (idx 0–10). O "data_start" é detectado
 *    dinamicamente como o primeiro índice com dados reais de empresa.
 *
 * 3. ANOMALIAS ESPECÍFICAS DO TOMADOR (vs PRESTADOR)
 *    a) UF+Município+Label concatenados: "MSDouradosMunicípio:" — o valor e o label
 *       aparecem juntos no mesmo segmento (vs PRESTADOR que os separa).
 *    b) Nome fantasia em mixed-case ("Seara Alimentos") — vs PRESTADOR que usa ALL_CAPS.
 *    c) Inscrições: "Inscrição estadual:Inscrição municipal:" — dois labels num único segmento.
 *    d) Número do endereço pode ser "S/N" (Sem Número).
 */

import pdfParse from 'pdf-parse';
import type { ValidationResult, ConfidenceLevel } from './types';

// ─── TIPOS ────────────────────────────────────────────────────────────────────

export interface TomadorField {
  valor: string | null;
  confianca: number;
  nivel: ConfidenceLevel;
  metodo: string;
  validacoes: ValidationResult[];
}

export interface TomadorResult {
  tomador: {
    razao_social:        TomadorField;
    nome_fantasia:       TomadorField;
    cpf_cnpj:            TomadorField;
    inscricao_municipal: TomadorField;
    inscricao_estadual:  TomadorField;
    endereco:            TomadorField;
    numero:              TomadorField;
    complemento:         TomadorField;
    bairro:              TomadorField;
    cep:                 TomadorField;
    municipio:           TomadorField;
    uf:                  TomadorField;
    email:               TomadorField;
    telefone:            TomadorField;
    celular:             TomadorField;
    site:                TomadorField;
  };
  zona: {
    inicio:    number;
    fim:       number;
    dataStart: number;   // primeiro índice com dado real do TOMADOR (ignora ruído inicial)
    segmentos: string[];
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
const RE_INSCR_MUN = /^\d{6,12}$/;
const RE_HAS_LOWER = /[a-z]/;
const RE_URL       = /^(https?:\/\/|www\.)/i;
const RE_PLACEHOLDER = /^\*+$|^-+$|^N\/A$/i;

// Padrão TOMADOR para UF+Município: pode vir com label "Município:" concatenado
// Ex: "MSDouradosMunicípio:" → UF=MS, Município=Dourados
const RE_UF_MUNI_WITH_LABEL = /^([A-Z]{2})(.*?)(Munic[íi]pio:|Municipio:)$/;
// Padrão limpo (como no PRESTADOR): "MSDourados"
const RE_UF_MUNI_CLEAN      = /^([A-Z]{2})([A-Z][a-zA-ZÀ-ÿ].*)/;

const VALID_UFS = new Set([
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
  'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
]);

const COMPANY_SUFFIX_RE = /\s+(Ltda\.?|S\.?A\.?|EIRELI|ME|EPP|SLU|Cia\.?|Cooperativa|Associa[cç][aã]o|Instituto)\.?\s*$/i;

const LABELS_TOMADOR = {
  razaoSocial:    ['nome/razão social:', 'nome/razao social:'],
  nomeFantasia:   ['nome fantasia:'],
  cpfCnpj:        ['cpf/cnpj:'],
  inscrMunicipal: ['inscrição municipal:', 'inscricao municipal:'],
  inscrEstadual:  ['inscrição estadual:', 'inscricao estadual:'],
  municipio:      ['município:', 'municipio:'],
  uf:             ['uf:'],
  email:          ['e-mail:'],
  telefone:       ['telefone:'],
  celular:        ['celular:'],
  complemento:    ['complemento:'],
  site:           ['site:'],
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

function findLabel(zone: string[], labels: string[]): number {
  const lower = zone.map(s => s.toLowerCase());
  for (const lbl of labels) {
    const i = lower.findIndex(s => s.includes(lbl));
    if (i !== -1) return i;
  }
  return -1;
}

function nullField(reason: string, labelFound = false): TomadorField {
  return {
    valor: null,
    confianca: labelFound ? 70 : 50,
    nivel: levelFor(labelFound ? 70 : 50),
    metodo: 'campo_ausente',
    validacoes: [{ rule: 'valor_encontrado', passed: false, detail: reason }],
  };
}

// ─── VALIDAÇÕES ───────────────────────────────────────────────────────────────

function validateCNPJ(cnpj: string): boolean {
  const d = cnpj.replace(/\D/g, '');
  if (d.length !== 14) return false;
  if (/^(\d)\1+$/.test(d)) return false;
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

// ─── DETECÇÃO DE ZONA ─────────────────────────────────────────────────────────

function detectTomadorZone(segs: string[]): {
  start: number; end: number; dataStart: number; strategy: string;
} {
  const enderecos = segs
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => /^Endereço:/i.test(s));

  // Regra primária: zona TOMADOR = tudo ANTES da 2ª ocorrência de "Endereço:"
  if (enderecos.length >= 2) {
    const start = 0;
    const end   = enderecos[1].i - 1;
    const dataStart = findDataStart(segs.slice(start, end + 1));
    return { start, end, dataStart, strategy: 'antes_da_segunda_ocorrencia_endereco' };
  }

  // Fallback: apenas 1 endereço — provavelmente TOMADOR
  if (enderecos.length === 1) {
    const start = 0;
    const end   = Math.min(segs.length - 1, enderecos[0].i + 24);
    const dataStart = findDataStart(segs.slice(start, end + 1));
    return { start, end, dataStart, strategy: 'unico_endereco_fallback' };
  }

  return { start: -1, end: -1, dataStart: -1, strategy: 'zona_nao_detectada' };
}

/**
 * Detecta onde os dados reais do TOMADOR começam dentro da zona.
 * A zona sempre começa com cabeçalhos e dados da Fase 2 (idx 0–10 no modelo)
 * que não pertencem ao TOMADOR e não devem ser candidatos para os campos.
 * O data_start é o menor índice com: CNPJ, CPF, e-mail, telefone ou razão social.
 */
function findDataStart(zone: string[]): number {
  for (let i = 0; i < zone.length; i++) {
    const s = zone[i];
    if (RE_CNPJ.test(s) || RE_CPF.test(s)) return i;
    if (RE_EMAIL.test(s)) return i;
    if (RE_PHONE.test(s)) return i;
    if (COMPANY_SUFFIX_RE.test(s)) return i;
  }
  return 0;
}

// ─── EXTRATORES DE CAMPO ──────────────────────────────────────────────────────

function extractCpfCnpj(zone: string[]): TomadorField {
  const validations: ValidationResult[] = [];
  let score = 0;

  const cnpjMatch = zone.map((s, i) => ({ s, i })).find(({ s }) => RE_CNPJ.test(s));
  const cpfMatch  = !cnpjMatch ? zone.map((s, i) => ({ s, i })).find(({ s }) => RE_CPF.test(s)) : null;
  const match = cnpjMatch ?? cpfMatch;
  const tipo  = cnpjMatch ? 'CNPJ' : cpfMatch ? 'CPF' : null;

  validations.push({ rule: 'padrao_encontrado', passed: !!match, detail: tipo ?? 'nenhum' });
  if (!match) return nullField('CNPJ/CPF não encontrado na zona TOMADOR');
  score += 50;

  const valor    = match.s;
  const labelIdx = findLabel(zone, LABELS_TOMADOR.cpfCnpj);
  validations.push({ rule: 'label_encontrado', passed: labelIdx !== -1 });
  if (labelIdx !== -1) score += 15;

  const dvOk = tipo === 'CNPJ' ? validateCNPJ(valor) : tipo === 'CPF' ? validateCPF(valor) : false;
  validations.push({ rule: 'digitos_verificadores_validos', passed: dvOk });
  if (dvOk) score += 25;

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

function extractEmail(zone: string[]): TomadorField {
  const validations: ValidationResult[] = [];
  let score = 0;

  const match    = zone.map((s, i) => ({ s, i })).find(({ s }) => RE_EMAIL.test(s));
  const labelIdx = findLabel(zone, LABELS_TOMADOR.email);
  validations.push({ rule: 'padrao_email_encontrado', passed: !!match });
  if (!match) return nullField('e-mail não encontrado na zona TOMADOR', labelIdx !== -1);
  score += 50;

  const valor = match.s.toLowerCase();
  validations.push({ rule: 'label_encontrado', passed: labelIdx !== -1 });
  if (labelIdx !== -1) score += 15;

  const hasAt    = valor.includes('@');
  const hasDomain = /\.[a-z]{2,}$/.test(valor);
  validations.push({ rule: 'tem_arroba',              passed: hasAt });
  validations.push({ rule: 'tem_dominio_com_ponto',   passed: hasDomain });
  if (hasAt && hasDomain) score += 30;

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
 * Bipartite: evita que um único número seja atribuído tanto a Telefone quanto a Celular.
 * No TOMADOR do modelo, existe apenas um número (telefone); Celular = null.
 */
function extractPhones(zone: string[]): { telefone: TomadorField; celular: TomadorField } {
  const phones   = zone.map((s, i) => ({ s, i })).filter(({ s }) => RE_PHONE.test(s));
  const telLabel = findLabel(zone, LABELS_TOMADOR.telefone);
  const celLabel = findLabel(zone, LABELS_TOMADOR.celular);

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

  const buildField = (assign: Assign, labelIdx: number, name: string): TomadorField => {
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
  endereco: TomadorField; numero: TomadorField; bairro: TomadorField; cep: TomadorField;
} {
  // O segmento Endereço: é o primeiro dentro da zona que começa com "Endereço:"
  const rawSeg = zone.find(s => /^Endereço:/i.test(s)) ?? '';

  function makeField(
    valor: string | null, rule: string, score: number, method: string,
    extra?: ValidationResult[],
  ): TomadorField {
    return {
      valor,
      confianca: clamp(score),
      nivel: levelFor(clamp(score)),
      metodo: method,
      validacoes: [
        { rule: 'linha_endereco_encontrada', passed: /^Endereço:/i.test(rawSeg) },
        { rule, passed: !!valor },
        ...(extra ?? []),
      ],
    };
  }

  const logrMatch   = rawSeg.match(RE_LOGR_IN);
  const numMatch    = rawSeg.match(RE_NUM_IN);
  const bairroMatch = rawSeg.match(RE_BAIRRO_IN);
  const cepMatch    = rawSeg.match(RE_CEP_IN);

  const logradouro = logrMatch?.[1]?.trim() ?? null;
  const numero     = numMatch?.[1]?.trim() ?? null;   // suporta "S/N" (Sem Número)
  const bairro     = bairroMatch?.[1]?.trim() ?? null;
  const cepRaw     = cepMatch?.[1]?.replace(/\D/g, '') ?? null;
  const cep        = cepRaw?.length === 8 ? `${cepRaw.slice(0, 5)}-${cepRaw.slice(5)}` : cepRaw;

  const cepValidation: ValidationResult[] = cep ? [
    { rule: 'cep_8_digitos',          passed: cepRaw?.length === 8 ?? false },
    { rule: 'cep_formato_xxxxx_xxx',  passed: /^\d{5}-\d{3}$/.test(cep ?? '') },
  ] : [];

  const numeroValidation: ValidationResult[] = numero ? [
    // "S/N" é valor válido para endereços sem número
    { rule: 'numero_ou_sn',  passed: /^\d+$/.test(numero) || numero.toUpperCase() === 'S/N' },
  ] : [];

  return {
    endereco: makeField(logradouro, 'logradouro_extraido', logradouro ? 95 : 0, 'regex_logradouro'),
    numero:   makeField(numero,     'numero_extraido',     numero     ? 90 : 0, 'regex_numero', numeroValidation),
    bairro:   makeField(bairro,     'bairro_extraido',     bairro     ? 90 : 0, 'regex_bairro'),
    cep:      makeField(cep,        'cep_extraido',        cep        ? 95 : 0, 'regex_cep', cepValidation),
  };
}

/**
 * Extrai UF e Município do TOMADOR.
 *
 * Anomalia específica do TOMADOR nesta família de NFS-e:
 * o segmento combina valor + label num único token: "MSDouradosMunicípio:"
 * (vs PRESTADOR onde aparecem separados: "MSDourados" + "Município:").
 *
 * Suporta ambas as formas para robustez.
 */
function extractUfMunicipio(zone: string[]): { uf: TomadorField; municipio: TomadorField } {
  const validations: ValidationResult[] = [];

  // Tier 1: segmento com valor+label concatenado (TOMADOR: "MSDouradosMunicípio:")
  const withLabel = zone
    .map((s, i) => ({ s, i }))
    .find(({ s }) => RE_UF_MUNI_WITH_LABEL.test(s));

  if (withLabel) {
    const parts = withLabel.s.match(RE_UF_MUNI_WITH_LABEL);
    const uf   = parts?.[1] ?? null;
    const muni = parts?.[2] ?? null;
    const ufOk = !!uf && VALID_UFS.has(uf);
    validations.push({ rule: 'padrao_uf_municipio_com_label_concatenado', passed: true });

    return {
      uf: {
        valor: uf,
        confianca: clamp(uf ? (ufOk ? 100 : 60) : 0),
        nivel: levelFor(ufOk ? 100 : uf ? 60 : 0),
        metodo: 'split_uf_municipio_com_label',
        validacoes: [
          ...validations,
          { rule: 'uf_valida_brasil', passed: ufOk, detail: uf ?? 'N/A' },
          { rule: 'dois_caracteres',  passed: (uf?.length ?? 0) === 2 },
        ],
      },
      municipio: {
        valor: muni,
        confianca: clamp(muni && muni.length >= 3 ? 90 : muni ? 50 : 0),
        nivel: levelFor(muni && muni.length >= 3 ? 90 : muni ? 50 : 0),
        metodo: 'split_uf_municipio_com_label',
        validacoes: [
          ...validations,
          { rule: 'municipio_3_chars_minimo', passed: (muni?.length ?? 0) >= 3, detail: muni ?? 'N/A' },
        ],
      },
    };
  }

  // Tier 2: segmento limpo (como PRESTADOR: "MSDourados")
  const clean = zone
    .map((s, i) => ({ s, i }))
    .find(({ s }) => RE_UF_MUNI_CLEAN.test(s) && !s.includes(':') && !s.includes(' '));

  validations.push({ rule: 'padrao_uf_municipio_concatenado', passed: !!clean });
  if (!clean) {
    return {
      uf:        nullField('UF não encontrada na zona TOMADOR'),
      municipio: nullField('Município não encontrado na zona TOMADOR'),
    };
  }

  const parts = clean.s.match(RE_UF_MUNI_CLEAN);
  const uf    = parts?.[1] ?? null;
  const muni  = parts?.[2] ?? null;
  const ufOk  = !!uf && VALID_UFS.has(uf);

  return {
    uf: {
      valor: uf,
      confianca: clamp(uf ? (ufOk ? 100 : 60) : 0),
      nivel: levelFor(ufOk ? 100 : uf ? 60 : 0),
      metodo: 'split_uf_municipio_limpo',
      validacoes: [...validations, { rule: 'uf_valida_brasil', passed: ufOk, detail: uf ?? 'N/A' }],
    },
    municipio: {
      valor: muni,
      confianca: clamp(muni && muni.length >= 3 ? 90 : 50),
      nivel: levelFor(muni && muni.length >= 3 ? 90 : 50),
      metodo: 'split_uf_municipio_limpo',
      validacoes: [...validations, { rule: 'municipio_3_chars_minimo', passed: (muni?.length ?? 0) >= 3 }],
    },
  };
}

function extractInscricaoMunicipal(
  zone: string[], dataStart: number, cnpj: string | null,
): TomadorField {
  const validations: ValidationResult[] = [];
  let score = 0;

  const labelIdx = findLabel(zone, LABELS_TOMADOR.inscrMunicipal);
  validations.push({ rule: 'label_encontrado', passed: labelIdx !== -1 });
  if (labelIdx !== -1) score += 15;

  const cnpjClean = cnpj?.replace(/\D/g, '') ?? '';
  const candidates = zone
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) =>
      i >= dataStart &&
      RE_INSCR_MUN.test(s) &&
      s.replace(/\D/g, '') !== cnpjClean
    );

  validations.push({ rule: 'candidatos_encontrados', passed: candidates.length > 0, detail: `${candidates.length}` });
  if (candidates.length === 0) return nullField('inscrição municipal não encontrada', labelIdx !== -1);
  score += 35;

  const chosen = labelIdx !== -1
    ? candidates.reduce((b, c) => Math.abs(c.i - labelIdx) < Math.abs(b.i - labelIdx) ? c : b)
    : candidates[0];
  score += 30;

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

function extractInscricaoEstadual(
  zone: string[], cnpj: string | null, inscMuni: string | null,
): TomadorField {
  const validations: ValidationResult[] = [];
  const labelIdx = findLabel(zone, LABELS_TOMADOR.inscrEstadual);
  validations.push({ rule: 'label_encontrado', passed: labelIdx !== -1 });
  if (labelIdx === -1) return nullField('label inscrição estadual não encontrado');

  const cnpjClean    = cnpj?.replace(/\D/g, '') ?? '';
  const inscMuniClean = inscMuni ?? '';
  const candidates = zone
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) =>
      RE_INSCR_MUN.test(s) &&
      s !== inscMuniClean &&
      s.replace(/\D/g, '') !== cnpjClean &&
      Math.abs(i - labelIdx) <= 8
    );

  if (candidates.length === 0) {
    return {
      valor: null,
      confianca: 75,
      nivel: 'media',
      metodo: 'label_encontrado_valor_ausente',
      validacoes: [...validations, { rule: 'valor_presente', passed: false, detail: 'campo vazio' }],
    };
  }

  return {
    valor: candidates[0].s,
    confianca: 80,
    nivel: 'alta',
    metodo: 'numeric_near_label',
    validacoes: [...validations, { rule: 'valor_presente', passed: true }],
  };
}

function extractComplemento(zone: string[], dataStart: number): TomadorField {
  const validations: ValidationResult[] = [];
  const labelIdx = findLabel(zone, LABELS_TOMADOR.complemento);
  validations.push({ rule: 'label_encontrado', passed: labelIdx !== -1 });

  // Tier 1: placeholder explícito → campo vazio
  const placeholder = zone
    .map((s, i) => ({ s, i }))
    .filter(({ i }) => i >= dataStart)
    .find(({ s }) => RE_PLACEHOLDER.test(s));

  if (placeholder) {
    validations.push({ rule: 'placeholder_detectado', passed: true, detail: `"${placeholder.s}" → null` });
    return {
      valor: null,
      confianca: labelIdx !== -1 ? 95 : 75,
      nivel: levelFor(labelIdx !== -1 ? 95 : 75),
      metodo: 'placeholder_detected',
      validacoes: validations,
    };
  }

  // Tier 2: busca por proximidade ao label, excluindo padrões conhecidos
  if (labelIdx === -1) return nullField('label complemento não encontrado');

  const knownPatterns = [RE_CNPJ, RE_CPF, RE_EMAIL, RE_PHONE, RE_INSCR_MUN];
  const candidates = zone
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) =>
      i >= dataStart &&
      i !== labelIdx &&
      Math.abs(i - labelIdx) <= 20 &&
      !s.includes(':') &&
      !knownPatterns.some(re => re.test(s)) &&
      !/^[A-Z]{2}[A-Z]/.test(s) &&
      !COMPANY_SUFFIX_RE.test(s)         // não é razão social
    );

  if (candidates.length === 0) return nullField('complemento não encontrado ou vazio', true);

  const chosen = candidates.reduce((b, c) =>
    Math.abs(c.i - labelIdx) < Math.abs(b.i - labelIdx) ? c : b);

  const t = chosen.s.trim();
  const normalized = (/^\*+$|^-+$|^N\/A$/i.test(t) || t === '') ? null : t;

  validations.push({
    rule: 'valor_extraido',
    passed: true,
    detail: normalized ?? `"${t}" → null`,
  });

  return {
    valor: normalized,
    confianca: clamp(normalized !== null ? 80 : 70),
    nivel: levelFor(normalized !== null ? 80 : 70),
    metodo: 'proximity_nearest_label',
    validacoes: validations,
  };
}

/**
 * Extrai a razão social: string mixed-case com sufixo de natureza jurídica.
 * Restrito ao data_start para não capturar rodapé da prefeitura.
 */
function extractRazaoSocial(zone: string[], dataStart: number): TomadorField {
  const validations: ValidationResult[] = [];
  let score = 0;

  const labelIdx = findLabel(zone, LABELS_TOMADOR.razaoSocial);
  validations.push({ rule: 'label_encontrado', passed: labelIdx !== -1 });
  if (labelIdx !== -1) score += 15;

  const knownPatterns = [RE_CNPJ, RE_CPF, RE_EMAIL, RE_PHONE, RE_INSCR_MUN];
  const candidates = zone
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) =>
      i >= dataStart &&
      RE_HAS_LOWER.test(s) &&
      s.split(' ').length >= 2 &&
      !s.includes(':') &&
      !knownPatterns.some(re => re.test(s))
    );

  validations.push({ rule: 'candidatos_mixed_case', passed: candidates.length > 0, detail: `${candidates.length}` });
  if (candidates.length === 0) return nullField('razão social não encontrada');
  score += 35;

  const withSuffix = candidates.filter(c => COMPANY_SUFFIX_RE.test(c.s));
  const chosen     = withSuffix.length > 0 ? withSuffix[0] : candidates[0];
  const hasSuffix  = COMPANY_SUFFIX_RE.test(chosen.s);

  validations.push({ rule: 'sufixo_natureza_juridica', passed: hasSuffix, detail: chosen.s });
  if (hasSuffix) score += 30;

  if (labelIdx !== -1) {
    const dist = Math.abs(chosen.i - labelIdx);
    validations.push({ rule: 'proximo_ao_label_ate_15', passed: dist <= 15, detail: `dist: ${dist}` });
    if (dist <= 15) score += 20;
  }

  return {
    valor: chosen.s,
    confianca: clamp(score),
    nivel: levelFor(clamp(score)),
    metodo: hasSuffix ? 'mixed_case_with_suffix' : 'mixed_case_nearest_label',
    validacoes: validations,
  };
}

/**
 * Extrai o nome fantasia do TOMADOR.
 *
 * Diferença crítica vs PRESTADOR:
 * - PRESTADOR: nome fantasia em ALL_CAPS
 * - TOMADOR:   nome fantasia em mixed-case, sem sufixo jurídico
 *
 * Discriminador: string mixed-case, multi-palavra, SEM sufixo de natureza jurídica,
 * restrita ao data_start (para não capturar rodapé da prefeitura).
 */
function extractNomeFantasia(zone: string[], dataStart: number, razaoSocial: string | null): TomadorField {
  const validations: ValidationResult[] = [];
  let score = 0;

  const labelIdx = findLabel(zone, LABELS_TOMADOR.nomeFantasia);
  validations.push({ rule: 'label_encontrado', passed: labelIdx !== -1 });
  if (labelIdx !== -1) score += 15;

  const knownPatterns = [RE_CNPJ, RE_CPF, RE_EMAIL, RE_PHONE, RE_INSCR_MUN];
  const candidates = zone
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) =>
      i >= dataStart &&
      RE_HAS_LOWER.test(s) &&             // tem letras minúsculas (mixed-case)
      s.split(' ').length >= 2 &&          // múltiplas palavras
      !s.includes(':') &&
      !knownPatterns.some(re => re.test(s)) &&
      !COMPANY_SUFFIX_RE.test(s) &&        // sem sufixo jurídico (diferencia de razão social)
      s !== razaoSocial                    // não é a mesma string da razão social
    );

  validations.push({ rule: 'candidatos_encontrados', passed: candidates.length > 0, detail: `${candidates.length}` });
  if (candidates.length === 0) return nullField('nome fantasia não encontrado', labelIdx !== -1);
  score += 35;

  const chosen = labelIdx !== -1
    ? candidates.reduce((b, c) => Math.abs(c.i - labelIdx) < Math.abs(b.i - labelIdx) ? c : b)
    : candidates[0];

  validations.push({ rule: 'sem_sufixo_juridico', passed: !COMPANY_SUFFIX_RE.test(chosen.s), detail: chosen.s });
  score += 25;

  if (labelIdx !== -1) {
    const dist = Math.abs(chosen.i - labelIdx);
    validations.push({ rule: 'proximo_ao_label_ate_15', passed: dist <= 15, detail: `dist: ${dist}` });
    if (dist <= 15) score += 25;
  }

  return {
    valor: chosen.s,
    confianca: clamp(score),
    nivel: levelFor(clamp(score)),
    metodo: 'mixed_case_no_suffix_nearest_label',
    validacoes: validations,
  };
}

function extractSite(zone: string[]): TomadorField {
  const labelIdx = findLabel(zone, LABELS_TOMADOR.site);
  const urlMatch = zone.find(s => RE_URL.test(s));
  if (!urlMatch) {
    return {
      valor: null,
      confianca: labelIdx !== -1 ? 75 : 50,
      nivel: levelFor(labelIdx !== -1 ? 75 : 50),
      metodo: 'label_encontrado_valor_ausente',
      validacoes: [
        { rule: 'label_encontrado', passed: labelIdx !== -1 },
        { rule: 'url_encontrada',   passed: false, detail: 'campo vazio' },
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
      { rule: 'url_encontrada',   passed: true },
    ],
  };
}

// ─── CONFIANÇA GLOBAL ─────────────────────────────────────────────────────────

function globalConfidence(tomador: TomadorResult['tomador']): number {
  const fields = Object.values(tomador);
  const sum    = fields.reduce((acc, f) => acc + f.confianca, 0);
  return Math.round(sum / fields.length);
}

// ─── EXPORT PRINCIPAL ─────────────────────────────────────────────────────────

export async function extractTomador(pdfBuffer: Buffer): Promise<TomadorResult> {
  const t0   = Date.now();
  const raw  = await pdfParse(pdfBuffer);
  const segs = toSegments(raw.text);

  const { start, end, dataStart, strategy } = detectTomadorZone(segs);
  if (start === -1) {
    throw new Error('Zona TOMADOR não detectada no PDF. Verifique se o PDF contém a seção "Endereço:".');
  }

  const zone     = segs.slice(start, end + 1);
  const zoneData = { inicio: start, fim: end, dataStart, segmentos: zone, estrategia: strategy };

  // Extração sequencial: campos com dependência primeiro
  const cpfCnpjField    = extractCpfCnpj(zone);
  const emailField      = extractEmail(zone);
  const { telefone: telefoneField, celular: celularField } = extractPhones(zone);
  const { uf, municipio }  = extractUfMunicipio(zone);
  const inscrMuniField  = extractInscricaoMunicipal(zone, dataStart, cpfCnpjField.valor);
  const inscrEstField   = extractInscricaoEstadual(zone, cpfCnpjField.valor, inscrMuniField.valor);
  const { endereco, numero, bairro, cep } = extractEndereco(zone);
  const complementoField = extractComplemento(zone, dataStart);
  const razaoSocialField = extractRazaoSocial(zone, dataStart);
  const nomeFantasiaField = extractNomeFantasia(zone, dataStart, razaoSocialField.valor);
  const siteField        = extractSite(zone);

  const tomador: TomadorResult['tomador'] = {
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

  const gc = globalConfidence(tomador);

  return {
    tomador,
    zona: zoneData,
    globalConfidence: gc,
    globalLevel: levelFor(gc),
    extractionMs: Date.now() - t0,
  };
}
