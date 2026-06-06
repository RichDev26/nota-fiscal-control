import type { PdfExtractResult } from '@/types';

// ─── Modelos a tentar (em ordem) ─────────────────────────────────────────────
// Modelos que suportam document/PDF API (claude 3.5+)
const AI_PDF_MODELS = [
  ...(process.env.ANTHROPIC_MODEL ? [process.env.ANTHROPIC_MODEL] : []),
  'claude-haiku-4-5',
  'claude-3-7-sonnet-20250219',
];

// Modelos para texto puro (qualquer versão serve)
const AI_TEXT_MODELS = [
  ...(process.env.ANTHROPIC_MODEL ? [process.env.ANTHROPIC_MODEL] : []),
  'claude-haiku-4-5',
  'claude-3-7-sonnet-20250219',
  'claude-3-haiku-20240307',
  'claude-3-opus-20240229',
];

// ─── Prompt de extração ───────────────────────────────────────────────────────

const EXTRACTION_PROMPT = `Você é um parser especializado em NFS-e brasileira.

Analise o documento e retorne um JSON com TODOS os campos visíveis.

REGRAS:
1. Retorne SOMENTE o JSON puro, sem markdown, sem blocos de código
2. Campos não encontrados = null
3. Datas: "YYYY-MM-DD" (ignore horário)
4. Valores monetários: número sem símbolo (ex: 50000.00 para R$ 50.000,00)
5. Alíquota: número percentual (ex: 5 para 5%)
6. NUNCA invente — use apenas o que está no documento
7. Zero explícito (R$ 0,00) = 0, não null
8. "Número da nota" (ou "N° da NFS-e") é diferente de "Número do RPS"
9. CNPJ tem formato XX.XXX.XXX/XXXX-XX

ESTRUTURA (use exatamente estas chaves):
{
  "numeroNf": "número da nota (não do RPS)",
  "numeroRps": "número do RPS ou null",
  "codigoVerificacao": "código alfanumérico ex: FHZSBPES7 ou null",
  "dataEmissao": "YYYY-MM-DD ou null",
  "dataFatoGerador": "YYYY-MM-DD ou null",
  "municipioEmissor": "município ou null",
  "tipo": "NFS-e",
  "of": "número OF/OS ou null",
  "codigoServico": "código ex: 14.01 ou null",
  "descricao": "descrição do serviço ou null",
  "quantidade": null_ou_número,
  "valorUnitario": null_ou_número,
  "valorBruto": null_ou_número,
  "valorLiquido": null_ou_número,
  "baseCalculo": null_ou_número,
  "aliquota": null_ou_número,
  "valorIss": null_ou_número,
  "ir": null_ou_número,
  "pisPasep": null_ou_número,
  "cofins": null_ou_número,
  "inss": null_ou_número,
  "csll": null_ou_número,
  "outrasRetencoes": null_ou_número,
  "desconto": null_ou_número,
  "descontoIncondicionado": null_ou_número,
  "deducoes": null_ou_número,
  "valorAproximadoTributos": null_ou_número,
  "valorAproximadoTributosFederal": null_ou_número,
  "valorAproximadoTributosEstadual": null_ou_número,
  "valorAproximadoTributosMunicipal": null_ou_número,
  "naturezaOperacao": "ex: Operação Tributável ou null",
  "situacaoTributariaIssqn": "ex: Retenção ou null",
  "localPrestacao": "cidade ou null",
  "situacaoNfse": "ex: Retida ou null",
  "regimeTributario": "ex: Simples Nacional ou null",
  "simplesNacional": true_ou_false_ou_null,
  "observacoesFiscais": "observações ou null",
  "prestador": {
    "nomeRazaoSocial": "razão social completa ou null",
    "nomeFantasia": "nome fantasia ou null",
    "cpfCnpj": "XX.XXX.XXX/XXXX-XX ou null",
    "inscricaoMunicipal": "número ou null",
    "inscricaoEstadual": "número ou null",
    "endereco": "logradouro sem número ou null",
    "numero": "número do endereço ou null",
    "complemento": "complemento ou null",
    "bairro": "bairro ou null",
    "cep": "XXXXX-XXX ou null",
    "municipio": "cidade ou null",
    "uf": "UF 2 letras ou null",
    "email": "email ou null",
    "telefone": "telefone ou null",
    "celular": "celular ou null",
    "site": "site ou null"
  },
  "tomador": {
    "nomeRazaoSocial": "razão social completa ou null",
    "nomeFantasia": "nome fantasia ou null",
    "cpfCnpj": "XX.XXX.XXX/XXXX-XX ou null",
    "inscricaoMunicipal": "número ou null",
    "inscricaoEstadual": "número ou null",
    "endereco": "logradouro sem número ou null",
    "numero": "número do endereço ou null",
    "complemento": "complemento ou null",
    "bairro": "bairro ou null",
    "cep": "XXXXX-XXX ou null",
    "municipio": "cidade ou null",
    "uf": "UF 2 letras ou null",
    "email": "email ou null",
    "telefone": "telefone ou null",
    "celular": "celular ou null",
    "site": "site ou null"
  }
}`;

// ─── Helpers de mapeamento ────────────────────────────────────────────────────

function mapParsedToResult(p: Record<string, unknown>): PdfExtractResult {
  const str = (v: unknown): string | undefined =>
    (v != null && v !== '' && v !== 'null') ? String(v) : undefined;

  const num = (v: unknown): number | undefined => {
    if (v == null || v === '' || v === 'null') return undefined;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\./g, '').replace(',', '.'));
    return isNaN(n) ? undefined : n;
  };

  const bool = (v: unknown): boolean | undefined => {
    if (v == null) return undefined;
    if (typeof v === 'boolean') return v;
    if (String(v).match(/^(true|sim|1)$/i)) return true;
    if (String(v).match(/^(false|n[ãa]o|0)$/i)) return false;
    return undefined;
  };

  const pessoa = (o: unknown) => {
    if (!o || typeof o !== 'object') return undefined;
    const q = o as Record<string, unknown>;
    return {
      nomeRazaoSocial:    str(q.nomeRazaoSocial),
      nomeFantasia:       str(q.nomeFantasia),
      cpfCnpj:            str(q.cpfCnpj),
      inscricaoMunicipal: str(q.inscricaoMunicipal),
      inscricaoEstadual:  str(q.inscricaoEstadual),
      endereco:           str(q.endereco),
      numero:             str(q.numero),
      complemento:        str(q.complemento),
      bairro:             str(q.bairro),
      cep:                str(q.cep),
      municipio:          str(q.municipio),
      uf:                 str(q.uf),
      email:              str(q.email),
      telefone:           str(q.telefone),
      celular:            str(q.celular),
      site:               str(q.site),
    };
  };

  const result: PdfExtractResult = {
    numeroNf:           str(p.numeroNf),
    numeroRps:          str(p.numeroRps),
    codigoVerificacao:  str(p.codigoVerificacao),
    dataEmissao:        str(p.dataEmissao),
    dataFatoGerador:    str(p.dataFatoGerador),
    municipioEmissor:   str(p.municipioEmissor),
    tipo:               str(p.tipo) || 'NFS-e',
    of:                 str(p.of),
    codigoServico:      str(p.codigoServico),
    descricao:          str(p.descricao),
    naturezaOperacao:        str(p.naturezaOperacao),
    situacaoTributariaIssqn: str(p.situacaoTributariaIssqn),
    localPrestacao:          str(p.localPrestacao),
    situacaoNfse:            str(p.situacaoNfse),
    regimeTributario:        str(p.regimeTributario),
    observacoesFiscais:      str(p.observacoesFiscais),
    quantidade:               num(p.quantidade),
    valorUnitario:            num(p.valorUnitario),
    valorBruto:               num(p.valorBruto),
    valorLiquido:             num(p.valorLiquido),
    baseCalculo:              num(p.baseCalculo),
    aliquota:                 num(p.aliquota),
    valorIss:                 num(p.valorIss),
    ir:                       num(p.ir),
    pisPasep:                 num(p.pisPasep),
    cofins:                   num(p.cofins),
    inss:                     num(p.inss),
    csll:                     num(p.csll),
    outrasRetencoes:          num(p.outrasRetencoes),
    desconto:                 num(p.desconto),
    descontoIncondicionado:   num(p.descontoIncondicionado),
    deducoes:                 num(p.deducoes),
    valorAproximadoTributos:          num(p.valorAproximadoTributos),
    valorAproximadoTributosFederal:   num(p.valorAproximadoTributosFederal),
    valorAproximadoTributosEstadual:  num(p.valorAproximadoTributosEstadual),
    valorAproximadoTributosMunicipal: num(p.valorAproximadoTributosMunicipal),
    simplesNacional: bool(p.simplesNacional),
    prestador: pessoa(p.prestador),
    tomador:   pessoa(p.tomador),
    fontesExtracao: ['ia-claude'],
  };

  const tNome = result.tomador?.nomeRazaoSocial ?? result.tomador?.nomeFantasia;
  if (result.numeroNf && tNome) {
    const short = tNome.replace(/\s+(Ltda\.?|S\.A\.?|ME\.?|EIRELI|EPP)\.?$/i, '').trim().slice(0, 28);
    result.nomeOrganizador = `NF ${result.numeroNf} – ${short}`;
  } else if (result.numeroNf) {
    result.nomeOrganizador = `NF ${result.numeroNf}`;
  }

  const issues: string[] = [];
  if (result.valorBruto && result.valorLiquido && result.valorIss != null) {
    const totalRet = (result.valorIss ?? 0) + (result.ir ?? 0) + (result.pisPasep ?? 0)
      + (result.cofins ?? 0) + (result.inss ?? 0) + (result.csll ?? 0) + (result.outrasRetencoes ?? 0);
    const expected = result.valorBruto - totalRet;
    if (Math.abs(expected - result.valorLiquido) > 1)
      issues.push(`Valor líquido: esperado R$ ${expected.toFixed(2)}, PDF R$ ${result.valorLiquido.toFixed(2)}`);
  }
  result.inconsistencias = issues;

  result.camposNaoEncontrados = [
    ...(result.numeroNf    ? [] : ['Número da NF']),
    ...(result.dataEmissao ? [] : ['Data de Emissão']),
    ...(result.valorBruto  ? [] : ['Valor Bruto']),
    ...(result.valorLiquido ? [] : ['Valor Líquido']),
  ];
  result.camposBaixaConfianca = [
    ...(result.codigoVerificacao  ? [] : ['Código de Verificação']),
    ...(result.tomador?.cpfCnpj   ? [] : ['CNPJ do Tomador']),
    ...(result.prestador?.cpfCnpj ? [] : ['CNPJ do Prestador']),
  ];

  const ps: string[] = [];
  if (result.numeroNf)    ps.push(`NF ${result.numeroNf}`);
  if (tNome)              ps.push(tNome);
  if (result.valorBruto)  ps.push(`R$ ${result.valorBruto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
  if (result.dataEmissao) {
    try { ps.push(new Date(result.dataEmissao + 'T12:00:00').toLocaleDateString('pt-BR')); } catch { /**/ }
  }
  result.resumo = ps.join(' | ');

  return result;
}

function parseJsonResponse(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) throw new Error(`JSON não encontrado. Resposta: ${raw.slice(0, 200)}`);
    return JSON.parse(m[0]);
  }
}

// ─── Helper: tenta lista de modelos até um funcionar ─────────────────────────

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
      if (txt) { console.log(`[PDF] ${label} OK com ${model}`); return txt; }
      console.log(`[PDF] ${label} ${model} retornou vazio`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[PDF] ${label} ${model} falhou: ${msg.slice(0, 150)}`);
      lastErr = err instanceof Error ? err : new Error(msg);
    }
  }
  throw lastErr ?? new Error(`${label}: nenhum modelo disponível (${models.join(', ')})`);
}

// ─── Tier 1: PDF direto ao Claude (lê layout real) ───────────────────────────

async function extractWithAIPdf(buffer: Buffer): Promise<PdfExtractResult> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const pdfBase64 = buffer.toString('base64');
  const raw = await tryModels(
    client as Parameters<typeof tryModels>[0],
    AI_PDF_MODELS,
    (model) => ({
      model,
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
          { type: 'text', text: EXTRACTION_PROMPT },
        ],
      }],
    }),
    'Tier1/PDF',
  );

  const parsed = parseJsonResponse(raw);
  console.log('[PDF] Tier1 OK — numeroNf:', parsed.numeroNf, '| dataEmissao:', parsed.dataEmissao);
  const result = mapParsedToResult(parsed);
  result.fontesExtracao = ['ia-claude-pdf'];
  return result;
}

// ─── Tier 2: Texto extraído → Claude ─────────────────────────────────────────

async function extractWithAIText(text: string): Promise<PdfExtractResult> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const truncated = text.slice(0, 25000);
  const prompt = `${EXTRACTION_PROMPT}

OBSERVAÇÃO: O texto abaixo foi extraído automaticamente do PDF e pode estar com a estrutura das tabelas quebrada (colunas misturadas). Use seu melhor julgamento para identificar os campos mesmo com o texto fora de ordem.

TEXTO EXTRAÍDO DO PDF:
${truncated}`;

  const raw = await tryModels(
    client as Parameters<typeof tryModels>[0],
    AI_TEXT_MODELS,
    (model) => ({
      model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    }),
    'Tier2/texto',
  );

  const parsed = parseJsonResponse(raw);
  console.log('[PDF] Tier2 OK — numeroNf:', parsed.numeroNf, '| dataEmissao:', parsed.dataEmissao);
  const result = mapParsedToResult(parsed);
  result.fontesExtracao = ['ia-claude-text'];
  return result;
}

// ─── Tier 3: Regex sobre texto extraído ──────────────────────────────────────

function extractReg(text: string, patterns: RegExp[]): string | undefined {
  for (const p of patterns) {
    const v = text.match(p)?.[1]?.trim();
    if (v && v.length > 0) return v;
  }
}

function extractFloat(text: string, patterns: RegExp[]): number | undefined {
  const raw = extractReg(text, patterns);
  if (!raw) return undefined;
  const n = parseFloat(raw.replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? undefined : n;
}

// ─── parsePessoa: extrai campos de um bloco de texto de prestador/tomador ────
// Funciona tanto com texto "normal" (label: valor) quanto com texto "invertido"
// (NFS-e garbled: valor aparece ANTES do label, ou sem label algum).

function parsePessoa(block: string) {
  const clean = (s?: string | null) => s?.replace(/\s+/g, ' ').trim() || undefined;

  // Labels que NÃO devem ser confundidos com valores
  const SKIP_RE = /^(Endere[çc]o|Complemento|Bairro|CEP|Munic[ií]pio|UF[\s:]|E-?mail|Telefone|Celular|Site|CPF|CNPJ|Inscri[çc]|N[uú]mero[\s:]|Fone[\s:]|Nome\s*\/|Raz[ãa]o|PRESTADOR|TOMADOR|Discrimina|Outras|Reten|Forma|Dados|Valores|Identifica|P[áa]gina|Central|MUNICIPIO|Seção)/i;

  const validPhone = (v?: string) =>
    (v && !/\//.test(v) && /\d{4,}/.test(v) && !/www\./i.test(v)) ? v : undefined;

  // ── Endereço
  const endLine = block.match(/[Ee]ndere[çc]o[:\s]+([^\n]+)/i)?.[1] ?? '';

  // ── Razão social: label-based → standalone "Ltda/S.A./ME" line
  let nomeRazaoSocial = clean(extractReg(block, [
    /Nome\s*\/?\s*Raz[ãa]o\s+[Ss]ocial[:\s]+([^\n]+)/i,
    /Raz[ãa]o\s+[Ss]ocial[:\s]+([^\n]+)/i,
  ]));
  if (!nomeRazaoSocial) {
    const m = block.match(
      /^[ \t]*([A-ZÀ-Úa-záàâãéêíóôõúüç][^\n\t]{2,60}(?:Ltda\.?|S\.A\.?|ME\b|EIRELI|EPP))[ \t]*$/mi,
    );
    if (m && !SKIP_RE.test(m[1])) nomeRazaoSocial = m[1].trim();
  }

  // ── Nome fantasia: label-based → ALL CAPS standalone (≥2 palavras)
  let nomeFantasia = clean(extractReg(block, [/Nome\s+[Ff]antasia[:\s]+([^\n]+)/i]));
  if (!nomeFantasia) {
    const capsLines = block.match(/^[ \t]*([A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ][A-ZÁÀÂÃÉÊÍÓÔÕÚÜÇ\s]{4,50})[ \t]*$/mg) ?? [];
    for (const line of capsLines) {
      const t = line.trim();
      if (
        !SKIP_RE.test(t) &&
        !t.includes(':') &&
        t.split(/\s+/).length >= 2 &&
        !/^(MUNICIPIO|PRESTADOR|TOMADOR|DISCRIMINA|OUTRAS|RETENCOES?|FORMA[S]?|VALORES|DADOS|IDENTIFICA|P[AÁ]GINA|CENTRAL|NUMERO|SE[ÇC][AÃ]O)/i.test(t)
      ) {
        nomeFantasia = t;
        break;
      }
    }
  }

  // ── CNPJ: label-based → standalone CNPJ pattern
  let cpfCnpj = extractReg(block, [
    /CPF\s*\/\s*CNPJ[:\s]*([\d]{2}\.[\d]{3}\.[\d]{3}\/[\d]{4}-[\d]{2})/i,
    /CNPJ[:\s]*([\d]{2}\.[\d]{3}\.[\d]{3}\/[\d]{4}-[\d]{2})/i,
  ])?.trim();
  if (!cpfCnpj) {
    cpfCnpj = block.match(/\b(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/)?.[1];
  }

  // ── Inscrição municipal: label-based → standalone 6-10 dígitos
  let inscricaoMunicipal = extractReg(block, [
    /Inscri[çc][ãa]o\s+[Mm]unicipal[:\s]*([\d.\-\/]+)/i,
  ])?.trim();
  if (!inscricaoMunicipal || inscricaoMunicipal.length < 2) {
    const numLines = block.match(/^[ \t]*(\d{6,10})[ \t]*$/mg) ?? [];
    inscricaoMunicipal = numLines.map(s => s.trim())
      .find(s => s.length >= 6 && s.length <= 10 && !/^(0{4,})$/.test(s));
  }

  // ── Inscrição estadual
  const inscricaoEstadual = (() => {
    const v = extractReg(block, [
      /Inscri[çc][ãa]o\s+[Ee]stadual[:\s]+([^\s\n\t;:]+)/i,
    ])?.replace(/[:\s]+$/, '').trim();
    return (v && v.length > 1 && !/^Inscri/i.test(v)) ? v : undefined;
  })();

  // ── Email: label-based → standalone email pattern
  let email = extractReg(block, [
    /E-?[Mm]ail[:\s]+([a-zA-Z0-9._%+\-]+@[^\s\n,]+)/i,
  ])?.trim();
  if (!email) {
    email = block.match(/\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/)?.[1];
  }

  // ── Telefone: "Telefone:" label → standalone "(XX) XXXX-XXXX"
  // NÃO usa "Fone:" para evitar pegar o telefone do município (Fone: (67) 3410-5609 - www...)
  let telefone = validPhone(
    extractReg(block, [/Telefone[:\s]+([\(\d][\d\s\)\-\.]{6,18}\d)/i])?.trim(),
  );
  if (!telefone) {
    // Standalone: linha com APENAS um telefone
    const m = block.match(/^[ \t]*(\(\d{2}\)\s*[\d]{4,5}[\s\-\.][\d]{4})[ \t]*$/m);
    if (m) telefone = validPhone(m[1].trim());
  }

  // ── Celular
  let celular = validPhone(
    extractReg(block, [/Celular[:\s]+([\(\d][\d\s\)\-\.]{6,18}\d)/i])?.trim(),
  );
  if (!celular && !telefone) {
    // Standalone celular com 9 dígitos: (XX) 9XXXX-XXXX
    const m = block.match(/^[ \t]*(\(\d{2}\)\s*9[\d]{4}[\s\-\.][\d]{4})[ \t]*$/m);
    if (m) celular = validPhone(m[1].trim());
  }

  // ── Complemento: label → "KM N" pattern
  let complemento = extractReg(block, [/Complemento[:\s]+([^\n\t]+)/i])?.trim();
  if (!complemento || complemento === '**' || complemento.length < 2) complemento = undefined;
  if (!complemento) {
    complemento = block.match(/^[ \t]*(KM\s*\d+[^\n]*)[ \t]*$/mi)?.[1]?.trim();
  }

  // ── Município: label → "MSCidade" merged text
  let municipio = block.match(/Munic[ií]pio[:\s]+([^\n\t]+?)(?:\s{3,}|UF\s*:|$)/i)?.[1]?.trim();
  if (!municipio) {
    const msMatch = block.match(/\bMS([A-ZÀ-Ú][a-záàâãéêíóôõúüç]+)/);
    if (msMatch) municipio = msMatch[1];
  }

  // ── UF
  const uf = block.match(/\bUF[:\s]*([A-Z]{2})\b/)?.[1]
    ?? (block.match(/\bMS[A-ZÀ-Ú][a-z]/) ? 'MS' : undefined);

  // ── Site
  const site = (() => {
    const s = extractReg(block, [/[Ss]ite[:\s]+([^\s\n]+)/i])?.trim();
    return (s && s.length > 3 && !s.match(/^[A-Z]{2}$/)) ? s : undefined;
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
    endereco: endLine.replace(/\s*N[uú]mero[:\s].+$/i, '').trim() || undefined,
    numero: endLine.match(/N[uú]mero[:\s]+([^\s,]+)/i)?.[1]?.trim()
      ?? block.match(/N[uú]mero[:\s]+([^\n,\s]+)/i)?.[1]?.trim(),
    complemento,
    bairro: endLine.match(/Bairro[:\s]+([^\n]+?)(?:\s{2,}|\s*CEP|$)/i)?.[1]?.trim()
      ?? block.match(/Bairro[:\s]+([^\n]+?)(?:\s{2,}|\s*CEP|$)/i)?.[1]?.trim(),
    cep: (endLine.match(/CEP[:\s]*([\d]{5}-?[\d]{3})/i)
      ?? block.match(/CEP[:\s]*([\d]{5}-?[\d]{3})/i))?.[1]?.trim(),
    municipio,
    uf,
    site,
  };
}

async function extractWithRegex(buffer: Buffer): Promise<PdfExtractResult> {
  const pdfParse = (await import('pdf-parse')).default;
  const raw = (await pdfParse(buffer)).text ?? '';
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').normalize('NFC');

  console.log('[PDF] Tier3 — texto bruto (0-1200):\n' + text.slice(0, 1200));
  console.log('[PDF] Tier3 — texto bruto (1200-2400):\n' + text.slice(1200, 2400));

  const result: PdfExtractResult = {};
  const V = '([\\d.]+,[\\d]{2})';

  // ── Bloco de cabeçalho (valores invertidos antes dos labels)
  const headerBlock = (() => {
    const labelIdx = text.search(/Data\s+da\s+emiss[ãa]o\s+da\s+nota/i);
    return labelIdx > 0 ? text.slice(0, labelIdx) : text.slice(0, 500);
  })();

  // ── NF: número isolado no cabeçalho
  result.numeroNf = (() => {
    const standalone = headerBlock.match(/^[ \t]*(\d{1,6})[ \t]*$/mg) ?? [];
    return standalone.map(s => s.trim()).filter(s => /^\d+$/.test(s)).pop();
  })();

  // ── Código de verificação: alfanumérico maiúsculo no cabeçalho
  result.codigoVerificacao = (() => {
    const codes = (headerBlock.match(/^[ \t]*([A-Z][A-Z0-9]{5,19})[ \t]*$/mg) ?? [])
      .map(s => s.trim())
      .filter(s => /[A-Z]/.test(s) && /[0-9]/.test(s));
    if (codes.length > 0) return codes[0];
    const idx = text.search(/C[oó]digo\s+de\s+verifica[çc][ãa]o/i);
    if (idx < 0) return undefined;
    return text.slice(idx + 30, idx + 200)
      .match(/\b([A-Z][A-Z0-9]{5,19})\b/g)
      ?.find(c => /[A-Z]/.test(c) && /[0-9]/.test(c));
  })();

  // ── Datas: primeiras duas datas no texto
  const allDates = Array.from(text.matchAll(/(\d{2}\/\d{2}\/\d{4})/g)).map(m => m[1]);
  const toISO = (d?: string) => {
    const m = d?.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
  };
  result.dataEmissao    = toISO(allDates[0]);
  result.dataFatoGerador = toISO(allDates[1]);

  result.tipo = extractReg(text, [/(NFS?-?e)/i, /(NF-?e)/i]) ?? 'NFS-e';
  result.municipioEmissor = extractReg(text, [/MUNIC[IÍ]PIO\s+DE\s+([A-ZÀ-Ú][^\n\r,]+)/i])?.trim();
  result.of = extractReg(text, [/\bOF\s*[:\s.]+(\d{6,})/i]);
  result.codigoServico = extractReg(text, [
    /C[oó]digos?\s+dos?\s+[Ss]ervi[çc]os?[\s\S]{0,20}?([\d]{1,2}\.[\d]{2})/i,
    /\b(\d{2}\.\d{2})\s*[-–]\s*Lubri/i,
    /\b(\d{2}\.\d{2})\b/,
  ]);

  // ── Posições das seções principais
  const tStart = text.search(/TOMADOR\s+DE\s+SERVI[ÇC]OS/i);
  const dStart = text.search(/DISCRIMINA[ÇC][AÃ]O\s+DOS\s+SERVI[ÇC]OS/i);

  // ── DIVISÃO PRESTADOR / TOMADOR
  // No texto garbled desta NFS-e, os cabeçalhos PRESTADOR e TOMADOR aparecem
  // nas primeiras linhas (adjacentes). O conteúdo real está misturado depois:
  //   - Tomador: de TOMADOR até o 2º "Endereço:"
  //   - Prestador: do 2º "Endereço:" em diante
  const enderecoIdxs = Array.from(text.matchAll(/Endere[çc]o\s*:/gi)).map(m => m.index!);
  console.log('[PDF] Tier3 — posições Endereço:', enderecoIdxs, '| tStart:', tStart, '| dStart:', dStart);

  let pBlock: string;
  let tBlock: string;

  if (enderecoIdxs.length >= 2) {
    // 2 endereços: 1º = tomador, 2º = prestador
    const splitAt = enderecoIdxs[1];
    tBlock = text.slice(tStart >= 0 ? tStart : 0, splitAt);
    pBlock = text.slice(splitAt);
    console.log('[PDF] Tier3 — split em enderecoIdx[1]=', splitAt);
  } else if (enderecoIdxs.length === 1) {
    // 1 endereço: metade antes = tomador, metade após = prestador
    tBlock = text.slice(tStart >= 0 ? tStart : 0, enderecoIdxs[0] + 200);
    pBlock = text.slice(enderecoIdxs[0]);
    console.log('[PDF] Tier3 — split em único enderecoIdx[0]=', enderecoIdxs[0]);
  } else {
    // Sem endereço: usa seções (fallback antigo)
    const pStart = text.search(/PRESTADOR\s+DE\s+SERVI[ÇC]OS/i);
    pBlock = pStart >= 0 ? text.slice(pStart, tStart > pStart ? tStart : pStart + 2000) : text.slice(0, 2000);
    tBlock = tStart >= 0 ? text.slice(tStart, dStart > tStart ? dStart : tStart + 2000) : '';
    console.log('[PDF] Tier3 — sem Endereço, usando seções (pStart:', pStart, ')');
  }

  result.prestador = parsePessoa(pBlock);
  result.tomador   = parsePessoa(tBlock);

  // ── CNPJs globais: fallback se parsePessoa não encontrou
  const allCnpjs = Array.from(text.matchAll(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/g)).map(m => m[1]);
  console.log('[PDF] Tier3 — CNPJs no texto:', allCnpjs);
  if (allCnpjs.length > 0 && !result.tomador?.cpfCnpj) {
    result.tomador = { ...result.tomador, cpfCnpj: allCnpjs[0] } as typeof result.tomador;
  }
  if (allCnpjs.length > 1 && !result.prestador?.cpfCnpj) {
    result.prestador = { ...result.prestador, cpfCnpj: allCnpjs[1] } as typeof result.prestador;
  }

  // ── Valores monetários
  result.valorBruto   = extractFloat(text, [new RegExp(`Valor\\s+bruto\\s*[=:]\\s*R\\$\\s*${V}`, 'i')]);
  result.valorLiquido = extractFloat(text, [new RegExp(`Valor\\s+l[íi]quido\\s*[=:]\\s*R\\$\\s*${V}`, 'i')]);
  result.baseCalculo  = extractFloat(text, [
    new RegExp(`Base\\s+de\\s+[Cc][áa]lculo[^\\n]*?${V}`, 'i'),
    new RegExp(`BASE\\s+DE\\s+C[AÁ]LCULO\\s*${V}`, 'i'),
  ]);
  // Fallback: base de cálculo = valor bruto (padrão NFS-e sem deduções)
  result.baseCalculo ??= result.valorBruto;

  result.aliquota = extractFloat(text, [/Al[íi]quota\s+(?:do\s+)?ISS[^0-9]*([\d,]+)\s*%/i]);
  result.valorIss = extractFloat(text, [new RegExp(`Valor\\s+ISS[^\\n]*?${V}`, 'i')]);

  // ── Retenções federais
  const retStart = text.search(/RETEN[ÇC][ÕO]ES\s+FEDERAIS/i);
  const retBlock = retStart >= 0 ? text.slice(retStart, retStart + 800) : '';
  const retP = (label: string) => [
    new RegExp(`${label}\\s+R\\$\\s*([\\d.]+,\\d{2})`, 'i'),
    new RegExp(`${label}[^\\n]*\\n[^\\n]*R\\$\\s*([\\d.]+,\\d{2})`, 'i'),
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

  // Fallback posicional: 6 valores R$ no bloco de retenções
  if (retBlock && result.pisPasep == null && result.cofins == null) {
    const vals = Array.from(retBlock.matchAll(/R\$\s*([\d.]+,\d{2})/g)).map(m => {
      const n = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
      return isNaN(n) ? undefined : n;
    });
    if (vals.length >= 6) {
      result.pisPasep ??= vals[0]; result.cofins ??= vals[1]; result.inss ??= vals[2];
      result.ir ??= vals[3]; result.csll ??= vals[4]; result.outrasRetencoes ??= vals[5];
    }
  }

  // ── Outras informações fiscais
  const outStart = text.search(/OUTRAS\s+INFORMA[ÇC][ÕO]ES/i);
  const outBlock = outStart >= 0 ? text.slice(outStart) : text.slice(-2500);
  result.naturezaOperacao = extractReg(outBlock, [
    /[Nn]atureza\s+da\s+opera[çc][ãa]o[:\s]+([^\n]+)/i,
    /(Opera[çc][ãa]o\s+Tribut[áa]vel|Opera[çc][ãa]o\s+Isenta)/i,
  ])?.trim();
  result.situacaoTributariaIssqn = extractReg(outBlock, [
    /[Ss]itua[çc][ãa]o\s+[Tt]ributária\s+do\s+ISSQN[:\s]+([^\n]+)/i,
    /(Reten[çc][ãa]o|Exig[íi]vel|Isento|Imune)/i,
  ])?.trim();
  result.localPrestacao = extractReg(outBlock, [
    /[Ll]ocal\s+da\s+presta[çc][ãa]o\s+do\s+servi[çc]o[:\s]+([^\n]+)/i,
    /[Ll]ocal\s+da\s+presta[çc][ãa]o[:\s]+([^\n]+)/i,
  ])?.trim();
  result.situacaoNfse = extractReg(outBlock, [
    /[Ss]itua[çc][ãa]o\s+desta\s+NFS?-?e[:\s]+([^\n.]+)/i,
    /(Retida|Normal|Cancelada)/i,
  ])?.trim();
  result.regimeTributario = extractReg(outBlock, [
    /(Simples\s+Nacional|Lucro\s+Real|Lucro\s+Presumido)/i,
  ])?.trim();
  result.simplesNacional = /[Ss]imples\s+[Nn]acional/i.test(text);
  result.valorAproximadoTributosFederal  = extractFloat(text, [/federal\s*[-–]\s*R\$\s*([\d.]+,\d{2})/i]);
  result.valorAproximadoTributosEstadual = extractFloat(text, [/estadual\s*[-–]\s*R\$\s*([\d.]+,\d{2})/i]);
  result.valorAproximadoTributosMunicipal= extractFloat(text, [/municipal\s*[-–]\s*R\$\s*([\d.]+,\d{2})/i]);

  // ── Nome organizador
  const tNome = result.tomador?.nomeRazaoSocial ?? result.tomador?.nomeFantasia;
  result.nomeOrganizador = result.numeroNf && tNome
    ? `NF ${result.numeroNf} – ${tNome.replace(/\s+(Ltda\.?|S\.A\.?|ME\.?)$/i, '').trim().slice(0, 28)}`
    : result.numeroNf ? `NF ${result.numeroNf}` : undefined;

  result.camposNaoEncontrados = ['Número da NF', 'Data de Emissão', 'Valor Bruto', 'Valor Líquido']
    .filter((_, i) => [result.numeroNf, result.dataEmissao, result.valorBruto, result.valorLiquido][i] == null);
  result.camposBaixaConfianca = [
    ...(result.codigoVerificacao  ? [] : ['Código de Verificação']),
    ...(result.tomador?.cpfCnpj   ? [] : ['CNPJ do Tomador']),
    ...(result.prestador?.cpfCnpj ? [] : ['CNPJ do Prestador']),
  ];
  result.inconsistencias = [];
  result.fontesExtracao = ['pdf-regex'];

  const ps2: string[] = [];
  if (result.numeroNf)   ps2.push(`NF ${result.numeroNf}`);
  if (tNome)             ps2.push(tNome);
  if (result.valorBruto) ps2.push(`R$ ${result.valorBruto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
  result.resumo = ps2.join(' | ');

  // ── Log detalhado para diagnóstico
  console.log('[PDF] Tier3 resultado:', JSON.stringify({
    numeroNf: result.numeroNf,
    codigoVerificacao: result.codigoVerificacao,
    dataEmissao: result.dataEmissao,
    valorBruto: result.valorBruto,
    baseCalculo: result.baseCalculo,
    prestador: {
      razaoSocial: result.prestador?.nomeRazaoSocial,
      nomeFantasia: result.prestador?.nomeFantasia,
      cnpj: result.prestador?.cpfCnpj,
      email: result.prestador?.email,
      telefone: result.prestador?.telefone,
      inscMunicipal: result.prestador?.inscricaoMunicipal,
      endereco: result.prestador?.endereco,
    },
    tomador: {
      razaoSocial: result.tomador?.nomeRazaoSocial,
      nomeFantasia: result.tomador?.nomeFantasia,
      cnpj: result.tomador?.cpfCnpj,
      telefone: result.tomador?.telefone,
      inscMunicipal: result.tomador?.inscricaoMunicipal,
      complemento: result.tomador?.complemento,
    },
  }, null, 2));

  return result;
}

// ─── Exportação principal ─────────────────────────────────────────────────────

export async function extractFromPdfBuffer(buffer: Buffer): Promise<PdfExtractResult> {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  console.log('[PDF] ANTHROPIC_API_KEY presente:', hasKey);

  if (hasKey) {
    // Tier 1: PDF direto ao Claude
    try {
      return await extractWithAIPdf(buffer);
    } catch (err) {
      console.error('[PDF] Tier1 FALHOU:', (err as Error).message?.slice(0, 200));
    }

    // Tier 2: Texto extraído → Claude
    try {
      const pdfParse = (await import('pdf-parse')).default;
      const raw = (await pdfParse(buffer)).text ?? '';
      const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').normalize('NFC');
      console.log('[PDF] Tier2 — texto (200 chars):', text.slice(0, 200));
      return await extractWithAIText(text);
    } catch (err) {
      console.error('[PDF] Tier2 FALHOU:', (err as Error).message?.slice(0, 200));
    }
  }

  // Tier 3: Regex
  return extractWithRegex(buffer);
}
