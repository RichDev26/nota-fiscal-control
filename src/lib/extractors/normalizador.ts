/**
 * Normalizador — Fase 9
 *
 * Funções puras de normalização para comparação semântica de valores.
 * Nenhuma dessas funções faz I/O; são todas síncronas e sem efeitos colaterais.
 */

export type NormTipo =
  | 'money'
  | 'cnpj'
  | 'cpf'
  | 'date'
  | 'percent'
  | 'text'
  | 'boolean'
  | 'raw';

// ─── NORMALIZAÇÕES INDIVIDUAIS ────────────────────────────────────────────────

/** "R$ 50.000,00" | "50.000,0000" → "50000.00" */
export function normalizeMoney(v: string | null): string | null {
  if (v === null || v.trim() === '') return null;
  const clean = v.replace(/R\$\s*/g, '').replace(/\s/g, '');
  // Remove pontos de milhar; vírgula → ponto decimal; ignore casas extras além de 2
  const withDot = clean.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(withDot);
  if (isNaN(n)) return null;
  return n.toFixed(2);
}

/** "49.521.060/0001-49" | "49521060000149" → "49521060000149" */
export function normalizeCNPJ(v: string | null): string | null {
  if (v === null) return null;
  const digits = v.replace(/[^\d]/g, '');
  return digits.length >= 11 ? digits : null;
}

/** "19/05/2026 12:01:05" → "2026-05-19 12:01:05" */
export function normalizeDate(v: string | null): string | null {
  if (v === null) return null;
  // DD/MM/YYYY HH:MM:SS
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}:\d{2}:\d{2}))?/);
  if (m) {
    const [, dd, mm, yyyy, time] = m;
    return `${yyyy}-${mm}-${dd}${time ? ' ' + time : ''}`;
  }
  // Already ISO-like?
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.trim();
  return v.trim();
}

/** "5" | "5,00" | "5.00%" | "5,00%" → "5.0000" */
export function normalizePercent(v: string | null): string | null {
  if (v === null) return null;
  const clean = v.replace(/[%\s]/g, '').replace(',', '.');
  const n = parseFloat(clean);
  if (isNaN(n)) return null;
  return n.toFixed(4);
}

/** "JM Inox Manutencoa" → "jm inox manutencoa" (lowercase, sem acentos, sem duplos espaços) */
export function normalizeText(v: string | null): string | null {
  if (v === null) return null;
  return v
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // remove diacritics
    .replace(/[^\w\s]/g, ' ')           // pontuação → espaço
    .replace(/\s+/g, ' ')
    .trim();
}

/** "true" | "false" | true | false → "true" | "false" */
export function normalizeBoolean(v: string | null): string | null {
  if (v === null) return null;
  const lower = v.toLowerCase().trim();
  if (lower === 'true' || lower === 'sim' || lower === '1' || lower === 'retido') return 'true';
  if (lower === 'false' || lower === 'nao' || lower === 'não' || lower === '0') return 'false';
  return lower;
}

// ─── DISPATCHER ───────────────────────────────────────────────────────────────

export function normalize(v: string | null, tipo: NormTipo): string | null {
  switch (tipo) {
    case 'money':   return normalizeMoney(v);
    case 'cnpj':
    case 'cpf':     return normalizeCNPJ(v);
    case 'date':    return normalizeDate(v);
    case 'percent': return normalizePercent(v);
    case 'text':    return normalizeText(v);
    case 'boolean': return normalizeBoolean(v);
    default:        return v === null ? null : v.trim();
  }
}

// ─── COMPARAÇÃO ───────────────────────────────────────────────────────────────

export type TipoConcordancia =
  | 'CONCORDANCIA_TOTAL'
  | 'CONCORDANCIA_FUNCIONAL'
  | 'DIVERGENCIA_LEVE'
  | 'DIVERGENCIA_MODERADA'
  | 'DIVERGENCIA_CRITICA';

/**
 * Classifica a relação entre dois valores após normalização.
 * Retorna o tipo de concordância e os valores normalizados.
 */
export function classifyConcordance(
  rawA: string | null,
  rawB: string | null,
  tipo: NormTipo,
): { tipo: TipoConcordancia; normA: string | null; normB: string | null } {
  const normA = normalize(rawA, tipo);
  const normB = normalize(rawB, tipo);

  // Ambos nulos
  if (normA === null && normB === null) {
    return { tipo: 'CONCORDANCIA_TOTAL', normA, normB };
  }
  // Um nulo, outro não
  if (normA === null || normB === null) {
    return { tipo: 'DIVERGENCIA_MODERADA', normA, normB };
  }

  // Idêntico depois de normalizar E antes (raw)
  if (normA === normB) {
    const sameRaw = (rawA ?? '') === (rawB ?? '');
    return { tipo: sameRaw ? 'CONCORDANCIA_TOTAL' : 'CONCORDANCIA_FUNCIONAL', normA, normB };
  }

  // Diferença após normalização → medir proximidade
  const sim = strSim(normA, normB);
  if (sim >= 0.95) return { tipo: 'DIVERGENCIA_LEVE',     normA, normB };
  if (sim >= 0.75) return { tipo: 'DIVERGENCIA_MODERADA', normA, normB };
  return             { tipo: 'DIVERGENCIA_CRITICA',        normA, normB };
}

// ─── SIMILARIDADE DE STRINGS ─────────────────────────────────────────────────

/** Coeficiente de Dice (bigramas) — range 0..1 */
function strSim(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;

  const bigrams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s[i] + s[i + 1];
      m.set(bg, (m.get(bg) ?? 0) + 1);
    }
    return m;
  };

  const ba = bigrams(a);
  const bb = bigrams(b);
  let intersection = 0;
  ba.forEach((cnt, bg) => {
    intersection += Math.min(cnt, bb.get(bg) ?? 0);
  });
  const total = (a.length - 1) + (b.length - 1);
  return (2 * intersection) / total;
}
