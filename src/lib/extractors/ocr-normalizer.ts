/**
 * Fase 4.6 — Módulo de Robustez: OCR, Âncoras e Padrões Compartilhados
 *
 * Compartilhado entre prestador.ts e tomador.ts.
 * Centraliza estratégias de tolerância a OCR, detecção de âncoras robustas
 * e padrões de separação de zona.
 *
 * PROBLEMA RESOLVIDO:
 *   A dependência de palavras exatas (ex: "Endereço:") tornava o sistema
 *   frágil contra OCR imperfeito, variações de acento e outros municípios.
 *   Este módulo implementa matching multi-sinal e tolerante.
 */

// ─── OCR: NORMALIZAÇÃO DE CARACTERES ─────────────────────────────────────────

/**
 * Mapa de substituições OCR mais comuns (letra → dígito).
 * Aplicado apenas em campos que deveriam conter dígitos (CNPJ, CPF, CEP).
 */
const OCR_DIGIT_MAP: Record<string, string> = {
  'O': '0',   // maiúscula O → zero
  'l': '1',   // L minúsculo → 1
  'I': '1',   // I maiúsculo → 1
  'S': '5',   // S → 5
  'B': '8',   // B → 8
  'G': '6',   // G → 6
  'Z': '2',   // Z → 2
  'q': '9',   // q → 9
};

/**
 * Substitui caracteres OCR comuns em strings que deveriam ser numéricas.
 * Usa lookahead para não corrigir letras em contexto textual.
 *
 * Ex: "02.914.46O/0061-91" → "02.914.460/0061-91"
 *     "49.52l.060/0001-49" → "49.521.060/0001-49"
 */
export function normalizeNumericOCR(value: string): string {
  let result = '';
  for (let i = 0; i < value.length; i++) {
    const ch   = value[i];
    const prev = value[i - 1] ?? '';
    const next = value[i + 1] ?? '';
    // Aplica correção se o caractere está entre dígitos/pontuação CNPJ
    const numericContext = /[\d.\/\-]/.test(prev) || /[\d.\/\-]/.test(next);
    if (numericContext && ch in OCR_DIGIT_MAP) {
      result += OCR_DIGIT_MAP[ch];
    } else {
      result += ch;
    }
  }
  return result;
}

/**
 * Remove acentos portugueses de um texto para comparação aproximada de âncoras.
 * Usado quando OCR perde marcações diacríticas em "Endereço:", "Município:", etc.
 *
 * Ex: "Endereço" → "Endereco"
 *     "PRESTAÇÃO" → "PRESTACAO"
 */
export function stripAccents(text: string): string {
  return text
    .replace(/[àáâãä]/g, 'a').replace(/[ÀÁÂÃÄ]/g, 'A')
    .replace(/[èéêë]/g, 'e').replace(/[ÈÉÊË]/g, 'E')
    .replace(/[ìíîï]/g, 'i').replace(/[ÌÍÎÏ]/g, 'I')
    .replace(/[òóôõö]/g, 'o').replace(/[ÒÓÔÕÖ]/g, 'O')
    .replace(/[ùúûü]/g, 'u').replace(/[ÙÚÛÜ]/g, 'U')
    .replace(/ç/g, 'c').replace(/Ç/g, 'C')
    .replace(/ñ/g, 'n').replace(/Ñ/g, 'N');
}

// ─── DETECÇÃO TOLERANTE DE ÂNCORAS ───────────────────────────────────────────

/**
 * Detecta segmentos de endereço com tolerância a variações OCR.
 *
 * Coberturas:
 *   "Endereço:"   → padrão nativo
 *   "Endereco:"   → OCR perde acento (ê→e, ç→c)
 *   "Enderego:"   → OCR: ç→g
 *   "Endereqo:"   → OCR: ç→q
 *   "Endere9o:"   → OCR: ç→9 (raro)
 *   "ENDEREÇO:"   → maiúsculas
 *   "Endereço :"  → espaço antes do dois-pontos
 *   "Endereço;"   → dois-pontos virou ponto-e-vírgula
 */
export function isEnderecoAnchor(segment: string): boolean {
  const s = segment.trim();
  // Primário: cobre ç→c/g/q/9, ê→e, : pode ser ;
  if (/^Ender[eê][cçgq9][oô0O]\s*[:.;]/i.test(s)) return true;
  // Secundário: strip de acentos e match no normalizado
  return /^endereco\s*[:.;]/i.test(stripAccents(s));
}

/**
 * Normaliza o conteúdo de um segmento de endereço para parsing uniforme.
 * Converte variações OCR dos sub-labels para a forma canônica antes dos regex.
 *
 * Ex: "Endereco: ROD BR 163 Numero: S/N Bairro: CENTRO CEP: 79804-970"
 *   → "Endereço: ROD BR 163 Número: S/N Bairro: CENTRO CEP: 79804-970"
 */
export function normalizeEnderecoSegment(segment: string): string {
  return segment
    .replace(/^Ender[eê]?[cçgq9][oô0O]\s*[:.;]\s*/i, 'Endereço: ')
    .replace(/N[uú]?m[eê]?ro\s*:/gi,    'Número:')
    .replace(/Bairro\s*:/gi,             'Bairro:')
    .replace(/\bCEP\s*:/gi,              'CEP:');
}

/**
 * Retorna apenas segmentos "Endereço:" que aparecem ANTES das seções de conteúdo
 * (DISCRIMINAÇÃO DOS SERVIÇOS, Forma de Pagamento, etc.).
 *
 * PROBLEMA RESOLVIDO:
 *   Se a discriminação dos serviços mencionar um endereço
 *   ("Referente a instalação no Endereço: Av. Paulista, 900"),
 *   o detector antigo contaria 3 ocorrências e quebraria a fronteira das zonas.
 *
 * SOLUÇÃO:
 *   Filtrar apenas ocorrências ANTES da primeira âncora de seção de conteúdo.
 */
export function findValidEnderecoSegments(
  segs: string[],
): Array<{ s: string; i: number }> {
  const lower = segs.map(s => s.toLowerCase());

  const CONTENT_START_MARKERS = [
    'discriminação dos serviços',
    'discriminacao dos servicos',
    'forma de pagamento',
    'retenções federais',
    'retencoes federais',
    'outras informações',
    'outras informacoes',
  ];

  // Índice onde começa a área de conteúdo/corpo da nota
  const contentIdx = segs.findIndex((_, i) =>
    CONTENT_START_MARKERS.some(m => lower[i].includes(m))
  );

  const limit = contentIdx !== -1 ? contentIdx : segs.length;

  return segs
    .slice(0, limit)
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => isEnderecoAnchor(s));
}

// ─── MARCADORES DE FIM DE ZONA PRESTADOR ─────────────────────────────────────

/**
 * Marcadores de seção que delimitam o FIM da zona PRESTADOR.
 *
 * MUDANÇA DA FASE 4.6:
 *   'pagina'/'página' REMOVIDOS — eram muito genéricos como substring.
 *   Números de página agora detectados por ZONE_END_PAGE_RE (match exato).
 */
export const ZONE_END_MARKERS: string[] = [
  'discriminação dos serviços', 'discriminacao dos servicos',
  'forma de pagamento',
  'retenções federais', 'retencoes federais',
  'outras informações', 'outras informacoes',
  'número da notanúmero do rps', 'numero da notanumero do rps',
  'municipio de dourados', 'município de dourados',
  // 'página', 'pagina' → REMOVIDOS (causa falso-positivo em campos que contenham a palavra)
];

/** Detecta números de página: "Página 1/1", "Pagina 2/3", etc. (match exato de segmento). */
export const ZONE_END_PAGE_RE = /^P[aá]gina\s+\d+\/\d+$/i;

/**
 * Retorna true se o segmento marca o fim da zona PRESTADOR.
 * Combina substring match (para marcadores longos) com match exato (para página).
 */
export function isZoneEndMarker(segment: string): boolean {
  const l = segment.toLowerCase();
  if (ZONE_END_MARKERS.some(m => l.includes(m))) return true;
  if (ZONE_END_PAGE_RE.test(segment)) return true;
  return false;
}

// ─── PADRÕES COMPARTILHADOS (Fase 4.6: estendidos) ────────────────────────────

/**
 * Sufixos de natureza jurídica para identificar razão social.
 *
 * ADICIONADO NA FASE 4.6:
 *   - MEI (Microempreendedor Individual) — não estava na lista original
 *   - EI  (Empresário Individual)
 *   - Microempreendedor (extenso)
 *
 * Esses tipos são extremamente comuns no mercado brasileiro e o sistema
 * original os classificaria como "sem sufixo", triggering o fallback errado.
 */
export const COMPANY_SUFFIX_RE =
  /\s+(Ltda\.?|S\.?A\.?|EIRELI|MEI|ME|EI|EPP|SLU|Cia\.?|Cooperativa|Associa[cç][aã]o|Instituto|Microempreendedor[a-z]*|Empresa[rá]rio\s+Individual)\.?\s*$/i;

/**
 * Valores textuais para campos de inscrição (municipal, estadual).
 * Municípios usam esses textos para indicar isenção ou não-contribuinte.
 *
 * ADICIONADO NA FASE 4.6:
 *   Antes, o sistema só capturava inscrições numéricas. Prestadores MEI
 *   e isentos retornavam null incorretamente.
 */
export const INSCR_TEXTUAL_RE =
  /^(ISENTO|ISENTA|NÃO CONTRIBUINTE|NAO CONTRIBUINTE|DISPENSADO|DISPENSADA|SEM INSCRIÇÃO|SEM INSCRICAO|IMUNE|SUSPENSO|INATIVO|INATIVA|SIMPLES NACIONAL|OPTANTE SIMPLES)$/i;

/**
 * Padrão de nome de pessoa física (nome próprio brasileiro).
 * Usado como fallback de razão social quando prestador é MEI ou autônomo
 * e não há sufixo jurídico (Ltda, ME, etc.).
 *
 * Exemplos válidos:
 *   "João da Silva"
 *   "Maria Aparecida Santos"
 *   "Carlos Eduardo de Oliveira"
 *
 * Não casa com:
 *   strings com ':' (labels)
 *   strings com dígitos
 *   strings com um único token
 */
export const PERSON_NAME_RE =
  /^[A-ZÁÉÍÓÚÂÊÎÔÛÃÕ][a-záéíóúâêîôûãõ]+(\s+(de|da|do|dos|das|e|[A-ZÁÉÍÓÚÂÊÎÔÛÃÕ][a-záéíóúâêîôûãõ]+)){1,5}$/;

/**
 * Detecta se um segmento é um nome de pessoa física.
 * Combina PERSON_NAME_RE com uma heurística de quantidade de palavras.
 */
export function isPersonName(segment: string): boolean {
  if (segment.includes(':') || /\d/.test(segment)) return false;
  const words = segment.trim().split(/\s+/);
  if (words.length < 2 || words.length > 7) return false;
  return PERSON_NAME_RE.test(segment);
}

/**
 * Detecta se o PDF é provavelmente escaneado (não-nativo).
 * PDFs nativos (JasperReports/iText) têm alta variedade de caracteres e
 * estrutura de segmentos rica. PDFs escaneados com OCR ruim têm menos variedade.
 */
export function isLikelyScanned(rawText: string, segmentCount: number): boolean {
  if (segmentCount === 0) return true;
  const uniqueChars = new Set(rawText.replace(/\s/g, '')).size;
  const avgSegLen   = rawText.length / Math.max(segmentCount, 1);
  // Heurística: PDF nativo tem >40 chars únicos e segmentos longos
  return uniqueChars < 30 || avgSegLen < 8;
}
