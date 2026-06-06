import type { PdfExtractResult } from '@/types';

// ─── Modelos IA (fallback de último recurso) ──────────────────────────────────
const AI_PDF_MODELS = [
  ...(process.env.ANTHROPIC_MODEL ? [process.env.ANTHROPIC_MODEL] : []),
  'claude-haiku-4-5',
  'claude-3-7-sonnet-20250219',
];
const AI_TEXT_MODELS = [
  ...(process.env.ANTHROPIC_MODEL ? [process.env.ANTHROPIC_MODEL] : []),
  'claude-haiku-4-5',
  'claude-3-7-sonnet-20250219',
  'claude-3-haiku-20240307',
];

// ─── Campos críticos — se regex encontrar todos, IA não é chamada ─────────────
function isSufficient(r: PdfExtractResult): boolean {
  return !!(
    r.numeroNf &&
    r.dataEmissao &&
    r.valorBruto &&
    r.valorLiquido &&
    r.prestador?.cpfCnpj &&
    r.tomador?.cpfCnpj
  );
}

// ─── Merge: regex é base, IA preenche só o que falta ─────────────────────────
function mergeResults(base: PdfExtractResult, extra: PdfExtractResult): PdfExtractResult {
  const merged = { ...extra };
  for (const k of Object.keys(base) as (keyof PdfExtractResult)[]) {
    if (base[k] != null && merged[k] == null) {
      (merged as Record<string, unknown>)[k] = base[k];
    }
  }
  merged.prestador = mergePessoa(base.prestador, extra.prestador);
  merged.tomador   = mergePessoa(base.tomador,   extra.tomador);
  merged.fontesExtracao = [...(base.fontesExtracao || []), ...(extra.fontesExtracao || [])];
  return merged;
}

function mergePessoa(
  a?: PdfExtractResult['prestador'],
  b?: PdfExtractResult['prestador'],
): PdfExtractResult['prestador'] {
  if (!a && !b) return undefined;
  if (!a) return b;
  if (!b) return a;
  const result = { ...b };
  for (const k of Object.keys(a) as (keyof typeof a)[]) {
    if (a[k] != null && result[k] == null) result[k] = a[k];
  }
  return result;
}

// ─── Helpers regex ────────────────────────────────────────────────────────────

function extractReg(text: string, patterns: RegExp[]): string | undefined {
  for (const p of patterns) {
    const v = text.match(p)?.[1]?.trim();
    if (v && v.length > 0) return v;
  }
}

function extractFloat(text: string, patterns: RegExp[]): number | undefined {
  const raw = extractReg(text, patterns);
  if (!raw) return undefined;
  // Aceita: "50.000,00" (BR) ou "50000.00" (US)
  const br = raw.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(br);
  return isNaN(n) ? undefined : n;
}

const toISO = (d?: string): string | undefined => {
  if (!d) return undefined;
  const m = d.match(/(\d{2})[\/-](\d{2})[\/-](\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
};

const validPhone = (v?: string) =>
  v && !/www\./i.test(v) && /\d{4,}/.test(v) && !/\/{1}/.test(v) ? v : undefined;

// ─── parsePessoa: extrai campos de um bloco de prestador/tomador ──────────────
// Suporta texto "garbled" (tabelas misturadas) e texto normal com labels.

function parsePessoa(block: string): PdfExtractResult['prestador'] {
  if (!block.trim()) return undefined;

  const clean = (s?: string | null) => s?.replace(/\s+/g, ' ').trim() || undefined;

  // Palavras-chave que NÃO devem ser capturadas como valores de pessoa
  const SKIP_RE = /^(Endere[çc]o|Complemento|Bairro|CEP|Munic[ií]pio|UF[\s:]|E-?mail|Telefone|Celular|Site|CPF|CNPJ|Inscri[çc]|N[uú]mero[\s:]|Fone[\s:]|Nome\s*\/|Raz[ãa]o|PRESTADOR|TOMADOR|Discrimina|Outras|Reten|Forma|Dados|Valores|Identifica|P[áa]gina|Central|MUNICIPIO|Se[çc][ãa]o|Verifica|DISCRIMINA|RETEN|FORMA)/i;

  // ── Razão Social ─────────────────────────────────────────────────────────────
  let nomeRazaoSocial = clean(extractReg(block, [
    /Nome\s*\/?\s*Raz[ãa]o\s+[Ss]ocial[:\s]+([^\n\t]+)/i,
    /Raz[ãa]o\s+[Ss]ocial[:\s]+([^\n\t]+)/i,
  ]));
  // Fallback: linha com sufixo empresarial
  if (!nomeRazaoSocial) {
    const m = block.match(
      /^[ \t]*([A-ZÀ-Úa-záàâãéêíóôõúüç][^\n\t]{2,70}(?:\s+Ltda\.?|\s+S\.A\.?|\s+ME\b|\s+EIRELI|\s+EPP|\s+SS\b|\s+SC\b|\s+LTDA\.?))[ \t]*$/mi,
    );
    if (m && !SKIP_RE.test(m[1])) nomeRazaoSocial = m[1].trim();
  }

  // ── Nome Fantasia ─────────────────────────────────────────────────────────────
  let nomeFantasia = clean(extractReg(block, [/Nome\s+[Ff]antasia[:\s]+([^\n\t]+)/i]));
  if (!nomeFantasia) {
    // Linha toda em maiúsculas (≥ 2 palavras, não é header conhecido)
    const capsLines = block.match(/^[ \t]*([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ\s\.]{4,60})[ \t]*$/mg) ?? [];
    for (const line of capsLines) {
      const t = line.trim();
      if (
        !SKIP_RE.test(t) &&
        !t.includes(':') &&
        t.split(/\s+/).length >= 2 &&
        !/^(MUNICIPIO|PRESTADOR|TOMADOR|DISCRIMINA|OUTRAS|RETENCOES?|FORMAS?|VALORES|DADOS|IDENTIFICA|P[AÁ]GINA|CENTRAL|NUMERO|SE[ÇC][AÃ]O|VERIFICA)/i.test(t) &&
        t.length <= 60
      ) {
        nomeFantasia = t;
        break;
      }
    }
  }

  // ── CNPJ / CPF ───────────────────────────────────────────────────────────────
  let cpfCnpj = extractReg(block, [
    /CPF\s*\/\s*CNPJ[:\s]*([\d]{2}\.[\d]{3}\.[\d]{3}\/[\d]{4}-[\d]{2})/i,
    /CNPJ[:\s]*([\d]{2}\.[\d]{3}\.[\d]{3}\/[\d]{4}-[\d]{2})/i,
    /CPF[:\s]*(\d{3}\.\d{3}\.\d{3}-\d{2})/i,
  ])?.trim();
  if (!cpfCnpj) {
    cpfCnpj = block.match(/\b(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/)?.[1]
           ?? block.match(/\b(\d{3}\.\d{3}\.\d{3}-\d{2})\b/)?.[1];
  }

  // ── Inscrição Municipal ────────────────────────────────────────────────────────
  let inscricaoMunicipal = extractReg(block, [
    /Inscri[çc][ãa]o\s+[Mm]unicipal[:\s]*([\d.\-\/]+)/i,
    /Insc\.?\s+[Mm]un\.?[:\s]*([\d.\-\/]+)/i,
  ])?.trim();
  // Fallback: número isolado de 5-12 dígitos (não é CNPJ, não é telefone, não é CEP)
  if (!inscricaoMunicipal || inscricaoMunicipal.length < 2) {
    const numLines = block.match(/^[ \t]*(\d{5,12})[ \t]*$/mg) ?? [];
    inscricaoMunicipal = numLines.map(s => s.trim())
      .find(s => !/^(\d{8}|\d{5}-\d{3})$/.test(s) && !/\d{10}/.test(s) && s.length >= 5);
  }

  // ── Inscrição Estadual ────────────────────────────────────────────────────────
  const inscricaoEstadual = (() => {
    const v = extractReg(block, [
      /Inscri[çc][ãa]o\s+[Ee]stadual[:\s]+([^\s\n\t;:]+)/i,
      /Insc\.?\s+[Ee]st\.?[:\s]+([^\s\n\t;:]+)/i,
    ])?.replace(/[:\s]+$/, '').trim();
    return v && v.length > 1 && !/^Inscri/i.test(v) ? v : undefined;
  })();

  // ── E-mail ────────────────────────────────────────────────────────────────────
  let email = extractReg(block, [
    /E-?[Mm]ail[:\s]+([a-zA-Z0-9._%+\-]+@[^\s\n,;]+)/i,
  ])?.trim();
  if (!email) {
    // Standalone email pattern
    email = block.match(/\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/)?.[1];
  }

  // ── Telefone ──────────────────────────────────────────────────────────────────
  // Evita capturar o telefone do município (geralmente na primeira linha do texto)
  let telefone = validPhone(extractReg(block, [
    /Telefone[:\s]+([\(\d][\d\s\)\-\.]{6,18}\d)/i,
    /Fone[:\s]+([\(\d][\d\s\)\-\.]{6,18}\d)(?!\s*-\s*www)/i,
  ])?.trim());
  if (!telefone) {
    // Linha standalone com formato telefone (sem 9 inicial = fixo)
    const m = block.match(/^[ \t]*(\(\d{2}\)\s*[\d]{4}[\s\-\.][\d]{4})[ \t]*$/m);
    if (m) telefone = validPhone(m[1].trim());
  }

  // ── Celular ───────────────────────────────────────────────────────────────────
  let celular = validPhone(extractReg(block, [
    /Celular[:\s]+([\(\d][\d\s\)\-\.]{6,18}\d)/i,
  ])?.trim());
  if (!celular) {
    // Linha standalone com 9 dígitos (celular BR)
    const m = block.match(/^[ \t]*(\(\d{2}\)\s*9[\d]{4}[\s\-\.][\d]{4})[ \t]*$/m);
    if (m) celular = validPhone(m[1].trim());
  }

  // ── Endereço ──────────────────────────────────────────────────────────────────
  const endLine = block.match(/[Ee]ndere[çc]o[:\s]+([^\n]+)/i)?.[1] ?? '';

  // Endereço sem o "Número"
  let endereco = endLine.replace(/\s*N[uú]mero[:\s].+$/i, '').trim() || undefined;
  if (!endereco && endLine) endereco = endLine.trim();
  // Remove sufixo de número colado ao endereço (ex: "R VEREADOR... Número: 6430")
  if (endereco) endereco = endereco.replace(/\s*N[uú]mero\s*:?\s*\d+.*$/i, '').trim();

  // Número
  const numero = endLine.match(/N[uú]mero[:\s]+([^\s,\n]+)/i)?.[1]?.trim()
    ?? block.match(/N[uú]mero[:\s]+([^\n,\s]+)/i)?.[1]?.trim();

  // Complemento
  let complemento = extractReg(block, [/Complemento[:\s]+([^\n\t]+)/i])?.trim();
  if (!complemento || complemento === '**' || complemento.length < 2) complemento = undefined;
  // "KM N" é um complemento comum em zonas rurais
  if (!complemento) {
    complemento = block.match(/^[ \t]*(KM\s*\d+[^\n]{0,30})[ \t]*$/mi)?.[1]?.trim();
  }

  // Bairro
  const bairro = endLine.match(/Bairro[:\s]+([^\n]+?)(?:\s{3,}|\s*CEP|\s*$)/i)?.[1]?.trim()
    ?? block.match(/Bairro[:\s]+([^\n]+?)(?:\s{3,}|\s*CEP|\s*$)/i)?.[1]?.trim();

  // CEP
  const cep = (endLine.match(/CEP[:\s]*([\d]{5}-?[\d]{3})/i)
    ?? block.match(/CEP[:\s]*([\d]{5}-?[\d]{3})/i))?.[1]?.trim();

  // Município
  let municipio = block.match(/Munic[ií]pio[:\s]+([^\n\t]+?)(?:\s{3,}|UF\s*:|$)/i)?.[1]?.trim();
  if (!municipio) {
    // "MS<Palavra>" fusão de coluna típica de NFS-e garbled
    const msMatch = block.match(/\bMS([A-ZÀ-Ú][a-záàâãéêíóôõúüç]+)/);
    if (msMatch) municipio = msMatch[1];
  }

  // UF
  const uf = block.match(/\bUF[:\s]*([A-Z]{2})\b/)?.[1]
    ?? (block.match(/\bMS[A-ZÀ-Ú][a-z]/) ? 'MS' : undefined);

  // Site
  const site = (() => {
    const s = extractReg(block, [/[Ss]ite[:\s]+([^\s\n]+)/i])?.trim();
    return s && s.length > 3 && !s.match(/^[A-Z]{2}$/) ? s : undefined;
  })();

  return {
    nomeRazaoSocial,
    nomeFantasia,
    cpfCnpj,
    inscricaoMunicipal,
    inscricaoEstadual,
    email,
    telefone,
    celular,
    endereco,
    numero,
    complemento,
    bairro,
    cep,
    municipio,
    uf,
    site,
  };
}

// ─── Tier 1: Regex sobre texto extraído (sempre executado) ────────────────────

async function extractWithRegex(buffer: Buffer): Promise<PdfExtractResult> {
  const pdfParse = (await import('pdf-parse')).default;
  const raw = (await pdfParse(buffer)).text ?? '';
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').normalize('NFC');

  console.log('[PDF] Regex — texto (0-600):\n' + text.slice(0, 600));
  console.log('[PDF] Regex — texto (600-1200):\n' + text.slice(600, 1200));

  const result: PdfExtractResult = {};
  const V = '([\\d.]+,[\\d]{2})';          // valor BR: 50.000,00
  const VN = '(\\d+(?:[.,]\\d+)*)';        // valor numérico genérico

  // ── Bloco antes das labels (cabeçalho invertido comum em NFS-e) ───────────
  const headerBlock = (() => {
    const labelIdx = text.search(/Data\s+da\s+emiss[ãa]o\s+da\s+nota/i);
    return labelIdx > 0 ? text.slice(0, labelIdx) : text.slice(0, 600);
  })();

  // ── Número da NF ──────────────────────────────────────────────────────────
  result.numeroNf = (() => {
    // 1) Próximo ao label "Número da nota" / "N° da NFS-e"
    const byLabel = extractReg(text, [
      /N[uú]mero\s+da\s+nota[:\s]*(\d+)/i,
      /N[°º]\s*da\s+NFS?-?e[:\s]*(\d+)/i,
      /N[°º]\s*da\s+NFS?-?e\s+(\d+)/i,
    ]);
    if (byLabel) return byLabel;
    // 2) Standalone no cabeçalho (coluna direita com número pequeno)
    const standalone = headerBlock.match(/^[ \t]*(\d{1,6})[ \t]*$/mg) ?? [];
    return standalone.map(s => s.trim()).filter(s => /^\d+$/.test(s)).pop();
  })();

  // ── Número RPS ────────────────────────────────────────────────────────────
  result.numeroRps = extractReg(text, [
    /N[uú]mero\s+do\s+RPS[:\s]*(\d+)/i,
    /RPS[:\s]+(\d+)/i,
  ]);

  // ── Código de Verificação ─────────────────────────────────────────────────
  result.codigoVerificacao = (() => {
    // Por label
    const byLabel = extractReg(text, [
      /C[oó]digo\s+de\s+[Vv]erifica[çc][ãa]o[:\s]+([A-Z0-9]{6,20})/i,
    ]);
    if (byLabel) return byLabel;
    // Standalone alfanumérico no cabeçalho (maiúsculas + dígitos)
    const codes = (headerBlock.match(/^[ \t]*([A-Z][A-Z0-9]{5,19})[ \t]*$/mg) ?? [])
      .map(s => s.trim())
      .filter(s => /[A-Z]/.test(s) && /[0-9]/.test(s) && !/^(NFS|NFS-E|NFE)$/i.test(s));
    return codes[0];
  })();

  // ── Tipo ──────────────────────────────────────────────────────────────────
  result.tipo = extractReg(text, [/(NFS?-?e)/i, /(NF-?e)/i]) ?? 'NFS-e';

  // ── Município Emissor ─────────────────────────────────────────────────────
  result.municipioEmissor = extractReg(text, [
    /MUNIC[IÍ]PIO\s+DE\s+([A-ZÀ-Ú][A-ZÀ-Úa-záàâã\s]+?)(?:\n|Central|Fone|\s{3})/i,
    /Municipio\s+Emissor[:\s]+([^\n]+)/i,
  ])?.trim();

  // ── Datas (por label, depois fallback posicional) ─────────────────────────
  result.dataEmissao = (() => {
    const byLabel = extractReg(text, [
      /Data\s+da\s+emiss[ãa]o\s+da\s+nota[:\s]*(\d{2}\/\d{2}\/\d{4})/i,
      /Data\s+d[ae]\s+emiss[ãa]o[:\s]+(\d{2}\/\d{2}\/\d{4})/i,
      /Emiss[ãa]o[:\s]+(\d{2}\/\d{2}\/\d{4})/i,
    ]);
    if (byLabel) return toISO(byLabel);
    // Primeira data no texto
    return toISO(text.match(/(\d{2}\/\d{2}\/\d{4})/)?.[1]);
  })();

  result.dataFatoGerador = (() => {
    const byLabel = extractReg(text, [
      /Data\s+d[oa]\s+[Ff]ato\s+[Gg]erador[:\s]*(\d{2}\/\d{2}\/\d{4})/i,
      /[Ff]ato\s+[Gg]erador[:\s]+(\d{2}\/\d{2}\/\d{4})/i,
    ]);
    if (byLabel) return toISO(byLabel);
    // Segunda data no texto
    const allDates = Array.from(text.matchAll(/(\d{2}\/\d{2}\/\d{4})/g)).map(m => m[1]);
    return allDates[1] ? toISO(allDates[1]) : undefined;
  })();

  // ── OF / OS ───────────────────────────────────────────────────────────────
  result.of = extractReg(text, [
    /\bO[Ff]\s*[:\s.]+(\d{5,})/i,
    /\bO\.S\.\s*[:\s]*(\d+)/i,
    /\bOS\s*[:\s]*(\d{5,})/i,
    /\bOrdem\s+de\s+[Ss]ervi[çc]o[:\s]+(\d+)/i,
  ]);

  // ── Código de Serviço ─────────────────────────────────────────────────────
  result.codigoServico = (() => {
    // Por label
    const byLabel = extractReg(text, [
      /C[oó]digos?\s+d[eo]s?\s+[Ss]ervi[çc]os?[\s\S]{0,30}([\d]{1,2}\.[\d]{2})/i,
    ]);
    if (byLabel) return byLabel;
    // Padrão "NN.NN" no início de linha (código de serviço ISSQN)
    const m = text.match(/\b(\d{2}\.\d{2})\b/);
    return m?.[1];
  })();

  // ══ SEÇÕES PRINCIPAIS ════════════════════════════════════════════════════════

  const tStart = text.search(/TOMADOR\s+DE\s+SERVI[ÇC]OS/i);
  const dStart = text.search(/DISCRIMINA[ÇC][AÃ]O\s+DOS\s+SERVI[ÇC]OS/i);
  const retStart = text.search(/RETEN[ÇC][ÕO]ES\s+FEDERAIS/i);
  const outStart = text.search(/OUTRAS\s+INFORMA[ÇC][ÕO]ES/i);
  const formStart = text.search(/Forma\s+de\s+Pagamento/i);
  const pStart  = text.search(/PRESTADOR\s+DE\s+SERVI[ÇC]OS/i);

  // ── DIVISÃO PRESTADOR / TOMADOR ──────────────────────────────────────────────
  // NFS-e garbled: PRESTADOR e TOMADOR aparecem juntos no início.
  // Divisão correta: usar posição do 2º "Endereço:"
  const enderecoIdxs = Array.from(text.matchAll(/Endere[çc]o\s*:/gi)).map(m => m.index!);
  console.log('[PDF] enderecoIdxs:', enderecoIdxs, '| tStart:', tStart, '| dStart:', dStart);

  let pBlock: string;
  let tBlock: string;

  if (enderecoIdxs.length >= 2) {
    const splitAt = enderecoIdxs[1];
    tBlock = text.slice(tStart >= 0 ? tStart : 0, splitAt);
    pBlock = text.slice(splitAt, dStart > splitAt ? dStart : splitAt + 1500);
  } else if (enderecoIdxs.length === 1) {
    tBlock = text.slice(tStart >= 0 ? tStart : 0, enderecoIdxs[0] + 300);
    pBlock = text.slice(enderecoIdxs[0], dStart > enderecoIdxs[0] ? dStart : enderecoIdxs[0] + 1500);
  } else {
    // Fallback: divide pela posição de TOMADOR / DISCRIMINAÇÃO
    pBlock = pStart >= 0
      ? text.slice(pStart, tStart > pStart ? tStart : pStart + 2000)
      : text.slice(0, tStart > 0 ? tStart : 2000);
    tBlock = tStart >= 0
      ? text.slice(tStart, dStart > tStart ? dStart : tStart + 2000)
      : '';
  }

  result.prestador = parsePessoa(pBlock) ?? undefined;
  result.tomador   = parsePessoa(tBlock) ?? undefined;

  // ── CNPJs globais (fallback) ──────────────────────────────────────────────────
  const allCnpjs = Array.from(text.matchAll(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/g)).map(m => m[1]);
  console.log('[PDF] CNPJs encontrados:', allCnpjs);

  // O primeiro CNPJ que aparece no texto costuma ser o do tomador (topo da NFS-e)
  if (allCnpjs.length >= 1 && !result.tomador?.cpfCnpj) {
    result.tomador = { ...result.tomador, cpfCnpj: allCnpjs[0] };
  }
  if (allCnpjs.length >= 2 && !result.prestador?.cpfCnpj) {
    result.prestador = { ...result.prestador, cpfCnpj: allCnpjs[1] };
  }

  // ── DISCRIMINAÇÃO DOS SERVIÇOS ────────────────────────────────────────────────
  const discBlock = dStart >= 0
    ? text.slice(dStart, formStart > dStart ? formStart : retStart > dStart ? retStart : dStart + 1200)
    : '';

  // Descrição: primeira linha não-header, não-número, com conteúdo real
  if (discBlock && !result.descricao) {
    const lines = discBlock.split('\n').map(l => l.trim()).filter(Boolean);
    // Pular header e linhas com valores monetários
    for (const line of lines) {
      if (/^(DISCRIMINA|Valor\s+unit|Qtd|Base\s+de|ISS|R\$\s*[\d])/i.test(line)) continue;
      if (/^[\d.,\s]+$/.test(line)) continue;   // só números
      if (/^[A-Z\s]+$/.test(line) && line.length < 5) continue; // header curto
      if (line.length < 8) continue;
      result.descricao = line;
      break;
    }
  }

  // OF no texto da discriminação (ex: "OF: 6866682")
  if (!result.of && result.descricao) {
    const ofMatch = result.descricao.match(/\bO[Ff]\s*[:\s]+(\d+)/);
    if (ofMatch) {
      result.of = ofMatch[1];
      // Remove "OF: XXXXX" da descrição para não poluir
      result.descricao = result.descricao.replace(/\s*O[Ff]\s*[:\s]+\d+/i, '').trim() || result.descricao;
    }
  }

  // Também busca OF diretamente no discBlock se não encontrou ainda
  if (!result.of && discBlock) {
    result.of = extractReg(discBlock, [/\bO[Ff]\s*[:\s.]+(\d{5,})/i]);
  }

  // ── Valores do serviço (tabela na discriminação) ──────────────────────────────
  // Padrão da tabela: [código] [valorUnit] [qty] [valorServico] [base%] [ISS]
  if (discBlock) {
    // Valor unitário
    result.valorUnitario ??= extractFloat(discBlock, [
      new RegExp(`Valor\s+unit[áa]rio[:\s]+${V}`, 'i'),
      new RegExp(`unit[áa]rio[:\s]+(${VN})`, 'i'),
    ]);

    // Quantidade
    result.quantidade ??= (() => {
      const raw = extractReg(discBlock, [
        /Qtd\.?[:\s]+([\d.,]+)/i,
        /Quantidade[:\s]+([\d.,]+)/i,
      ]);
      if (!raw) return undefined;
      const n = parseFloat(raw.replace(',', '.'));
      return isNaN(n) ? undefined : n;
    })();

    // ISS da tabela de discriminação
    result.valorIss ??= extractFloat(discBlock, [
      new RegExp(`ISS[:\s]+${V}`, 'i'),
      new RegExp(`Valor\s+ISS[:\s]+${V}`, 'i'),
    ]);
  }

  // ── Valores financeiros ────────────────────────────────────────────────────────
  // "Valor bruto = R$ X" (formato com = ou : )
  result.valorBruto = extractFloat(text, [
    new RegExp(`Valor\\s+bruto\\s*[=:][\\s]*R\\$\\s*${V}`, 'i'),
    new RegExp(`Valor\\s+bruto[^\\n]*${V}`, 'i'),
  ]);

  result.valorLiquido = extractFloat(text, [
    new RegExp(`Valor\\s+l[íi]quido\\s*[=:][\\s]*R\\$\\s*${V}`, 'i'),
    new RegExp(`Valor\\s+l[íi]quido[^\\n]*${V}`, 'i'),
  ]);

  // Base de cálculo
  result.baseCalculo = extractFloat(text, [
    new RegExp(`Base\\s+de\\s+[Cc][áa]lculo[^\\n]*${V}`, 'i'),
    new RegExp(`BASE\\s+DE\\s+C[AÁ]LCULO\\s*${V}`, 'i'),
  ]);
  result.baseCalculo ??= result.valorBruto; // padrão: sem deduções

  // Alíquota ISS
  result.aliquota = extractFloat(text, [
    /Al[íi]quota\s+(?:do\s+)?ISS[^0-9]*([\d,]+)\s*%/i,
    /Al[íi]quota[:\s]+([\d,]+)\s*%/i,
    /\b([\d,]+)\s*%\s*(?:ISS|ISSQN)/i,
  ]);

  // Valor ISS (do resumo, não da tabela)
  result.valorIss ??= extractFloat(text, [
    new RegExp(`Valor\\s+ISS[^\\n]*?${V}`, 'i'),
    new RegExp(`ISS\\s*=\\s*${V}`, 'i'),
  ]);

  // ── Retenções Federais ─────────────────────────────────────────────────────────
  const retBlock = retStart >= 0 ? text.slice(retStart, retStart + 800) : '';

  // Padrão: LABEL seguido de R$ VALOR (mesma linha ou linha seguinte)
  const retP = (label: string) => [
    new RegExp(`${label}\\s+R\\$\\s*([\\d.]+,\\d{2})`, 'i'),
    new RegExp(`${label}[^\\n]*\\n[^\\n]*R\\$\\s*([\\d.]+,\\d{2})`, 'i'),
    new RegExp(`${label}[:\\s]+([\\d.]+,\\d{2})`, 'i'),
  ];

  result.pisPasep        = extractFloat(retBlock, retP('PIS\\s*\\/\\s*PASEP'));
  result.cofins          = extractFloat(retBlock, retP('COFINS'));
  result.inss            = extractFloat(retBlock, retP('INSS'));
  result.ir              = extractFloat(retBlock, [
    ...retP('\\bIR\\b'),
    ...retP('\\bIRRF\\b'),
    ...retP('Imposto\\s+de\\s+Renda'),
  ]);
  result.csll            = extractFloat(retBlock, retP('CSLL'));
  result.outrasRetencoes = extractFloat(retBlock, retP('Outras\\s+Reten[çc][õo]es'));

  // Fallback posicional: 6 valores R$ em sequência no bloco de retenções
  if (retBlock && (result.pisPasep == null || result.cofins == null)) {
    const vals = Array.from(retBlock.matchAll(/R\$\s*([\d.]+,\d{2})/g)).map(m => {
      const n = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
      return isNaN(n) ? undefined : n;
    });
    if (vals.length >= 6) {
      result.pisPasep        ??= vals[0];
      result.cofins          ??= vals[1];
      result.inss            ??= vals[2];
      result.ir              ??= vals[3];
      result.csll            ??= vals[4];
      result.outrasRetencoes ??= vals[5];
    }
  }

  // ── Outras Informações Fiscais ─────────────────────────────────────────────────
  const outBlock = outStart >= 0 ? text.slice(outStart) : text.slice(-2500);

  result.naturezaOperacao = extractReg(outBlock, [
    /[Nn]atureza\s+da\s+opera[çc][ãa]o[:\s]+([^\n]+)/i,
    /(Opera[çc][ãa]o\s+Tribut[áa]vel|Opera[çc][ãa]o\s+Isenta|Exporta[çc][ãa]o)/i,
  ])?.trim();

  result.situacaoTributariaIssqn = extractReg(outBlock, [
    /[Ss]itua[çc][ãa]o\s+[Tt]ributária\s+do\s+ISSQN[:\s]+([^\n]+)/i,
    /[Ss]itua[çc][ãa]o\s+[Tt]ributária\s+ISSQN[:\s]+([^\n]+)/i,
    /(Reten[çc][ãa]o|Exig[íi]vel\s+\w+|Isento|Imune)/i,
  ])?.trim();

  result.localPrestacao = extractReg(outBlock, [
    /[Ll]ocal\s+da\s+presta[çc][ãa]o\s+do\s+servi[çc]o[:\s]+([^\n]+)/i,
    /[Ll]ocal\s+da\s+presta[çc][ãa]o[:\s]+([^\n]+)/i,
    /[Ll]ocal\s+de\s+presta[çc][ãa]o[:\s]+([^\n]+)/i,
  ])?.trim();

  result.situacaoNfse = extractReg(outBlock, [
    /[Ss]itua[çc][ãa]o\s+desta\s+NFS?-?e[:\s]+([^\n.]+)/i,
    /(Retida|Normal|Cancelada|Em\s+Aberto)/i,
  ])?.trim();

  result.regimeTributario = extractReg(outBlock, [
    /(Simples\s+Nacional|Lucro\s+Real|Lucro\s+Presumido|MEI)/i,
  ])?.trim();

  result.simplesNacional = /[Ss]imples\s+[Nn]acional/i.test(text);

  // Observações fiscais: bloco de texto após "Códigos dos serviços"
  const obsStart = text.search(/C[oó]digos?\s+dos?\s+[Ss]ervi[çc]os?/i);
  if (obsStart >= 0 && outStart > 0) {
    const obsRaw = text.slice(obsStart, outStart > obsStart ? outStart : obsStart + 2000);
    const obsLines = obsRaw.split('\n').filter(l => l.trim().length > 10 && !/^[\d\s,]+$/.test(l.trim()));
    if (obsLines.length > 1) {
      // Remove a primeira linha (header do bloco) e une o restante
      result.observacoesFiscais = obsLines.slice(1).join('\n').trim() || undefined;
    }
  }

  // Tributos aproximados (lei 12.741)
  result.valorAproximadoTributosFederal  = extractFloat(text, [/federal\s*[-–:]\s*R\$\s*([\d.]+,\d{2})/i]);
  result.valorAproximadoTributosEstadual = extractFloat(text, [/estadual\s*[-–:]\s*R\$\s*([\d.]+,\d{2})/i]);
  result.valorAproximadoTributosMunicipal= extractFloat(text, [/municipal\s*[-–:]\s*R\$\s*([\d.]+,\d{2})/i]);
  result.valorAproximadoTributos =
    result.valorAproximadoTributosFederal != null ||
    result.valorAproximadoTributosEstadual != null ||
    result.valorAproximadoTributosMunicipal != null
      ? (result.valorAproximadoTributosFederal  ?? 0)
        + (result.valorAproximadoTributosEstadual ?? 0)
        + (result.valorAproximadoTributosMunicipal ?? 0)
      : undefined;

  // ── Nome organizador ──────────────────────────────────────────────────────────
  const tNome = result.tomador?.nomeRazaoSocial ?? result.tomador?.nomeFantasia;
  result.nomeOrganizador = result.numeroNf && tNome
    ? `NF ${result.numeroNf} – ${tNome.replace(/\s+(Ltda\.?|S\.A\.?|ME\.?|EIRELI|EPP)\.?$/i, '').trim().slice(0, 30)}`
    : result.numeroNf ? `NF ${result.numeroNf}` : undefined;

  // ── Metadados ─────────────────────────────────────────────────────────────────
  result.camposNaoEncontrados = ['Número da NF', 'Data de Emissão', 'Valor Bruto', 'Valor Líquido']
    .filter((_, i) => [result.numeroNf, result.dataEmissao, result.valorBruto, result.valorLiquido][i] == null);
  result.camposBaixaConfianca = [
    ...(result.codigoVerificacao  ? [] : ['Código de Verificação']),
    ...(result.tomador?.cpfCnpj   ? [] : ['CNPJ do Tomador']),
    ...(result.prestador?.cpfCnpj ? [] : ['CNPJ do Prestador']),
  ];
  result.inconsistencias = (() => {
    const issues: string[] = [];
    if (result.valorBruto && result.valorLiquido) {
      const ret = (result.valorIss ?? 0) + (result.ir ?? 0) + (result.pisPasep ?? 0)
        + (result.cofins ?? 0) + (result.inss ?? 0) + (result.csll ?? 0) + (result.outrasRetencoes ?? 0);
      const expected = result.valorBruto - ret;
      if (Math.abs(expected - result.valorLiquido) > 1)
        issues.push(`Valor líquido calculado: R$ ${expected.toFixed(2)}, no PDF: R$ ${result.valorLiquido.toFixed(2)}`);
    }
    return issues;
  })();
  result.fontesExtracao = ['pdf-regex'];

  const ps: string[] = [];
  if (result.numeroNf)   ps.push(`NF ${result.numeroNf}`);
  if (tNome)             ps.push(tNome);
  if (result.valorBruto) ps.push(`R$ ${result.valorBruto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
  result.resumo = ps.join(' | ');

  console.log('[PDF] Regex resultado:', JSON.stringify({
    numeroNf: result.numeroNf, codigoVerificacao: result.codigoVerificacao,
    dataEmissao: result.dataEmissao, valorBruto: result.valorBruto,
    valorLiquido: result.valorLiquido, baseCalculo: result.baseCalculo,
    aliquota: result.aliquota, valorIss: result.valorIss,
    of: result.of, descricao: result.descricao?.slice(0, 80),
    prestador: { razao: result.prestador?.nomeRazaoSocial, cnpj: result.prestador?.cpfCnpj, email: result.prestador?.email, tel: result.prestador?.telefone },
    tomador:   { razao: result.tomador?.nomeRazaoSocial,   cnpj: result.tomador?.cpfCnpj },
    camposFaltando: result.camposNaoEncontrados,
  }, null, 2));

  return result;
}

// ─── Tier 2: IA (PDF direto) ──────────────────────────────────────────────────

const EXTRACTION_PROMPT = `Você é um parser especializado em NFS-e brasileira.
Analise o documento e retorne um JSON com TODOS os campos visíveis.

REGRAS:
1. Retorne SOMENTE o JSON puro, sem markdown, sem blocos de código
2. Campos não encontrados = null; Zero explícito = 0
3. Datas: "YYYY-MM-DD"; Valores monetários: número sem símbolo (50000.00 para R$ 50.000,00)
4. Alíquota: número percentual (5 para 5%); NUNCA invente valores
5. "Número da nota" ≠ "Número do RPS"

{"numeroNf":null,"numeroRps":null,"codigoVerificacao":null,"dataEmissao":null,"dataFatoGerador":null,"municipioEmissor":null,"tipo":"NFS-e","of":null,"codigoServico":null,"descricao":null,"quantidade":null,"valorUnitario":null,"valorBruto":null,"valorLiquido":null,"baseCalculo":null,"aliquota":null,"valorIss":null,"ir":null,"pisPasep":null,"cofins":null,"inss":null,"csll":null,"outrasRetencoes":null,"naturezaOperacao":null,"situacaoTributariaIssqn":null,"localPrestacao":null,"situacaoNfse":null,"regimeTributario":null,"simplesNacional":null,"observacoesFiscais":null,"prestador":{"nomeRazaoSocial":null,"nomeFantasia":null,"cpfCnpj":null,"inscricaoMunicipal":null,"inscricaoEstadual":null,"endereco":null,"numero":null,"complemento":null,"bairro":null,"cep":null,"municipio":null,"uf":null,"email":null,"telefone":null,"celular":null,"site":null},"tomador":{"nomeRazaoSocial":null,"nomeFantasia":null,"cpfCnpj":null,"inscricaoMunicipal":null,"inscricaoEstadual":null,"endereco":null,"numero":null,"complemento":null,"bairro":null,"cep":null,"municipio":null,"uf":null,"email":null,"telefone":null,"celular":null,"site":null}}`;

function parseJsonResponse(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(cleaned); } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) throw new Error(`JSON não encontrado`);
    return JSON.parse(m[0]);
  }
}

function mapParsedToResult(p: Record<string, unknown>): PdfExtractResult {
  const str = (v: unknown) => (v != null && v !== '' && v !== 'null') ? String(v) : undefined;
  const num = (v: unknown) => {
    if (v == null || v === '' || v === 'null') return undefined;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\./g, '').replace(',', '.'));
    return isNaN(n) ? undefined : n;
  };
  const bool = (v: unknown) => {
    if (v == null) return undefined;
    if (typeof v === 'boolean') return v;
    return String(v).match(/^(true|sim|1)$/i) ? true : String(v).match(/^(false|n[ãa]o|0)$/i) ? false : undefined;
  };
  const pessoa = (o: unknown) => {
    if (!o || typeof o !== 'object') return undefined;
    const q = o as Record<string, unknown>;
    return {
      nomeRazaoSocial: str(q.nomeRazaoSocial), nomeFantasia: str(q.nomeFantasia),
      cpfCnpj: str(q.cpfCnpj), inscricaoMunicipal: str(q.inscricaoMunicipal),
      inscricaoEstadual: str(q.inscricaoEstadual), endereco: str(q.endereco),
      numero: str(q.numero), complemento: str(q.complemento), bairro: str(q.bairro),
      cep: str(q.cep), municipio: str(q.municipio), uf: str(q.uf),
      email: str(q.email), telefone: str(q.telefone), celular: str(q.celular), site: str(q.site),
    };
  };
  const result: PdfExtractResult = {
    numeroNf: str(p.numeroNf), numeroRps: str(p.numeroRps),
    codigoVerificacao: str(p.codigoVerificacao), dataEmissao: str(p.dataEmissao),
    dataFatoGerador: str(p.dataFatoGerador), municipioEmissor: str(p.municipioEmissor),
    tipo: str(p.tipo) || 'NFS-e', of: str(p.of),
    codigoServico: str(p.codigoServico), descricao: str(p.descricao),
    naturezaOperacao: str(p.naturezaOperacao), situacaoTributariaIssqn: str(p.situacaoTributariaIssqn),
    localPrestacao: str(p.localPrestacao), situacaoNfse: str(p.situacaoNfse),
    regimeTributario: str(p.regimeTributario), observacoesFiscais: str(p.observacoesFiscais),
    quantidade: num(p.quantidade), valorUnitario: num(p.valorUnitario),
    valorBruto: num(p.valorBruto), valorLiquido: num(p.valorLiquido),
    baseCalculo: num(p.baseCalculo), aliquota: num(p.aliquota), valorIss: num(p.valorIss),
    ir: num(p.ir), pisPasep: num(p.pisPasep), cofins: num(p.cofins),
    inss: num(p.inss), csll: num(p.csll), outrasRetencoes: num(p.outrasRetencoes),
    simplesNacional: bool(p.simplesNacional),
    prestador: pessoa(p.prestador), tomador: pessoa(p.tomador),
    fontesExtracao: ['ia-claude'],
  };
  const tNome = result.tomador?.nomeRazaoSocial ?? result.tomador?.nomeFantasia;
  if (result.numeroNf && tNome) {
    result.nomeOrganizador = `NF ${result.numeroNf} – ${tNome.replace(/\s+(Ltda\.?|S\.A\.?|ME\.?)$/i, '').trim().slice(0, 30)}`;
  } else if (result.numeroNf) {
    result.nomeOrganizador = `NF ${result.numeroNf}`;
  }
  result.baseCalculo ??= result.valorBruto;
  result.camposNaoEncontrados = ['Número da NF', 'Data de Emissão', 'Valor Bruto', 'Valor Líquido']
    .filter((_, i) => [result.numeroNf, result.dataEmissao, result.valorBruto, result.valorLiquido][i] == null);
  result.camposBaixaConfianca = [
    ...(result.codigoVerificacao  ? [] : ['Código de Verificação']),
    ...(result.tomador?.cpfCnpj   ? [] : ['CNPJ do Tomador']),
    ...(result.prestador?.cpfCnpj ? [] : ['CNPJ do Prestador']),
  ];
  result.inconsistencias = [];
  result.resumo = [result.numeroNf && `NF ${result.numeroNf}`, tNome].filter(Boolean).join(' | ');
  return result;
}

async function tryModels(
  client: { messages: { create: (p: object) => Promise<{ content: Array<{ type: string; text?: string }> }> } },
  models: string[],
  buildReq: (model: string) => object,
  label: string,
): Promise<string> {
  let lastErr: Error | null = null;
  for (const model of models) {
    try {
      console.log(`[PDF] ${label} — modelo: ${model}`);
      const resp = await client.messages.create(buildReq(model));
      const txt = resp.content[0]?.type === 'text' ? (resp.content[0] as { type: string; text: string }).text.trim() : '';
      if (txt) { console.log(`[PDF] ${label} OK`); return txt; }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[PDF] ${label} ${model} falhou: ${msg.slice(0, 120)}`);
      lastErr = err instanceof Error ? err : new Error(msg);
    }
  }
  throw lastErr ?? new Error('Nenhum modelo disponível');
}

async function extractWithAIPdf(buffer: Buffer): Promise<PdfExtractResult> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const pdfBase64 = buffer.toString('base64');
  const raw = await tryModels(
    client as Parameters<typeof tryModels>[0], AI_PDF_MODELS,
    (model) => ({
      model, max_tokens: 2048,
      messages: [{ role: 'user', content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
        { type: 'text', text: EXTRACTION_PROMPT },
      ]}],
    }),
    'IA/PDF',
  );
  const result = mapParsedToResult(parseJsonResponse(raw));
  result.fontesExtracao = ['ia-claude-pdf'];
  return result;
}

async function extractWithAIText(text: string): Promise<PdfExtractResult> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const prompt = `${EXTRACTION_PROMPT}\n\nOBSERVAÇÃO: Texto extraído automaticamente — pode estar com tabelas quebradas. Use bom senso.\n\nTEXTO:\n${text.slice(0, 25000)}`;
  const raw = await tryModels(
    client as Parameters<typeof tryModels>[0], AI_TEXT_MODELS,
    (model) => ({ model, max_tokens: 2048, messages: [{ role: 'user', content: prompt }] }),
    'IA/texto',
  );
  const result = mapParsedToResult(parseJsonResponse(raw));
  result.fontesExtracao = ['ia-claude-text'];
  return result;
}

// ─── Exportação principal ─────────────────────────────────────────────────────
// Pipeline: Regex → (IA apenas se campos críticos faltarem)

export async function extractFromPdfBuffer(buffer: Buffer): Promise<PdfExtractResult> {
  // ── Tier 1: Regex (sempre, grátis, rápido) ───────────────────────────────────
  const regexResult = await extractWithRegex(buffer);

  if (isSufficient(regexResult)) {
    console.log('[PDF] ✓ Regex encontrou todos os campos críticos — IA não necessária');
    return regexResult;
  }

  const missing = regexResult.camposNaoEncontrados ?? [];
  const missingCnpj = !regexResult.prestador?.cpfCnpj || !regexResult.tomador?.cpfCnpj;
  console.log(`[PDF] Regex incompleto — faltando: ${[...missing, missingCnpj ? 'CNPJs' : ''].filter(Boolean).join(', ')}`);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('[PDF] Sem ANTHROPIC_API_KEY — usando resultado regex');
    return regexResult;
  }

  // ── Tier 2: IA PDF (lê layout real) ─────────────────────────────────────────
  try {
    console.log('[PDF] Chamando IA (PDF direto)…');
    const aiResult = await extractWithAIPdf(buffer);
    return mergeResults(regexResult, aiResult);
  } catch (err) {
    console.error('[PDF] IA/PDF falhou:', (err as Error).message?.slice(0, 150));
  }

  // ── Tier 3: IA Texto ─────────────────────────────────────────────────────────
  try {
    const pdfParse = (await import('pdf-parse')).default;
    const text = (await pdfParse(buffer)).text ?? '';
    console.log('[PDF] Chamando IA (texto)…');
    const aiResult = await extractWithAIText(text);
    return mergeResults(regexResult, aiResult);
  } catch (err) {
    console.error('[PDF] IA/texto falhou:', (err as Error).message?.slice(0, 150));
  }

  // Fallback final: regex mesmo incompleto
  return regexResult;
}
