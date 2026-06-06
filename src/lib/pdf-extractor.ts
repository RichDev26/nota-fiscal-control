import type { PdfExtractResult } from '@/types';
import type { DocumentBlockParam } from '@anthropic-ai/sdk/resources/messages/messages';

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

  // nome sugerido
  const tNome = result.tomador?.nomeRazaoSocial ?? result.tomador?.nomeFantasia;
  if (result.numeroNf && tNome) {
    const short = tNome.replace(/\s+(Ltda\.?|S\.A\.?|ME\.?|EIRELI|EPP)\.?$/i, '').trim().slice(0, 28);
    result.nomeOrganizador = `NF ${result.numeroNf} – ${short}`;
  } else if (result.numeroNf) {
    result.nomeOrganizador = `NF ${result.numeroNf}`;
  }

  // validação
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

// ─── Tier 1: PDF direto ao Claude (lê layout real) ───────────────────────────

async function extractWithAIPdf(buffer: Buffer): Promise<PdfExtractResult> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const docBlock: DocumentBlockParam = {
    type: 'document',
    source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') },
  };

  console.log('[PDF] Tier1: enviando PDF direto ao Claude Sonnet...');
  const response = await client.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 2048,
    messages: [{ role: 'user', content: [docBlock, { type: 'text', text: EXTRACTION_PROMPT }] }],
  });

  const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
  if (!raw) throw new Error('Resposta vazia');
  const parsed = parseJsonResponse(raw);
  console.log('[PDF] Tier1 OK — numeroNf:', parsed.numeroNf, '| dataEmissao:', parsed.dataEmissao);
  const result = mapParsedToResult(parsed);
  result.fontesExtracao = ['ia-claude-pdf'];
  return result;
}

// ─── Tier 2: Texto extraído → Claude Sonnet ──────────────────────────────────

async function extractWithAIText(text: string): Promise<PdfExtractResult> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Aumenta o limite para 25000 chars e usa Sonnet (mais capaz que Haiku)
  const truncated = text.slice(0, 25000);
  const prompt = `${EXTRACTION_PROMPT}

OBSERVAÇÃO: O texto abaixo foi extraído automaticamente do PDF e pode estar com a estrutura das tabelas quebrada (colunas misturadas). Use seu melhor julgamento para identificar os campos mesmo com o texto fora de ordem.

TEXTO EXTRAÍDO DO PDF:
${truncated}`;

  console.log('[PDF] Tier2: enviando texto ao Claude Sonnet...');
  const response = await client.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
  if (!raw) throw new Error('Resposta vazia');
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

function extractDate(text: string, patterns: RegExp[]): string | undefined {
  const raw = extractReg(text, patterns);
  if (!raw) return undefined;
  const m = raw.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
}

function parsePessoa(block: string) {
  const clean = (s?: string | null) => s?.replace(/\s+/g, ' ').trim() || undefined;
  const LABEL = /^(Endere[çc]o|Complemento|Bairro|CEP|Munic[ií]pio|UF[:\s]|E-?mail|Telefone|Celular|Site|CPF|CNPJ|Inscri[çc]|N[uú]mero[:\s]|ROD\s|Fone)/i;
  const notLabel = (v?: string) => (v && !LABEL.test(v)) ? v : undefined;
  const validPhone = (v?: string) => (v && !/\//.test(v) && /\d{4,}/.test(v)) ? v : undefined;

  const endLine = block.match(/[Ee]ndere[çc]o[:\s]+([^\n]+)/i)?.[1] ?? '';
  return {
    nomeRazaoSocial: notLabel(clean(extractReg(block, [
      /Nome\s*\/?\s*Raz[ãa]o\s+[Ss]ocial[:\s]+([^\n]+)/i,
      /Raz[ãa]o\s+[Ss]ocial[:\s]+([^\n]+)/i,
    ]))),
    nomeFantasia: notLabel(clean(extractReg(block, [/Nome\s+[Ff]antasia[:\s]+([^\n]+)/i]))),
    cpfCnpj: extractReg(block, [
      /CPF\s*\/\s*CNPJ[:\s]*([\d]{2}\.[\d]{3}\.[\d]{3}\/[\d]{4}-[\d]{2})/i,
      /CNPJ[:\s]*([\d]{2}\.[\d]{3}\.[\d]{3}\/[\d]{4}-[\d]{2})/i,
      /CPF\s*\/\s*CNPJ[:\s]*([\d.\/\-]{14,18})/i,
    ])?.trim(),
    inscricaoMunicipal: extractReg(block, [/Inscri[çc][ãa]o\s+[Mm]unicipal[:\s]*([\d.\-\/]+)/i])?.trim(),
    inscricaoEstadual: (() => {
      const v = extractReg(block, [/Inscri[çc][ãa]o\s+[Ee]stadual[:\s]+([^\s\n\t]+)/i])?.replace(/[:\s]+$/, '').trim();
      return (v && v.length > 1) ? v : undefined;
    })(),
    email:    extractReg(block, [/E-?[Mm]ail[:\s]+([a-zA-Z0-9._%+\-]+@[^\s\n,]+)/i])?.trim(),
    telefone: validPhone(extractReg(block, [/(?:Telefone|Fone)[:\s]+([\(\d\s\)\-\.]{7,20})/i])?.trim()),
    celular:  validPhone(extractReg(block, [/Celular[:\s]+([\(\d\s\)\-\.]{7,20})/i])?.trim()),
    endereco: endLine.replace(/\s*N[uú]mero[:\s].+$/i, '').trim() || undefined,
    numero:   endLine.match(/N[uú]mero[:\s]+([^\s,]+)/i)?.[1]?.trim()
      ?? block.match(/N[uú]mero[:\s]+([^\n,\s]+)/i)?.[1]?.trim(),
    complemento: (() => {
      const v = extractReg(block, [/Complemento[:\s]+([^\n\t]+)/i])?.trim();
      return (v && v !== '**' && v.length > 0) ? v : undefined;
    })(),
    bairro:   endLine.match(/Bairro[:\s]+([^\n]+?)(?:\s{2,}|\s*CEP|$)/i)?.[1]?.trim()
      ?? block.match(/Bairro[:\s]+([^\n]+?)(?:\s{2,}|\s*CEP|$)/i)?.[1]?.trim(),
    cep:      (endLine.match(/CEP[:\s]*([\d]{5}-?[\d]{3})/i) ?? block.match(/CEP[:\s]*([\d]{5}-?[\d]{3})/i))?.[1]?.trim(),
    municipio: block.match(/Munic[ií]pio[:\s]+([^\n\t]+?)(?:\s{3,}|UF\s*:|$)/i)?.[1]?.trim(),
    uf:       block.match(/\bUF[:\s]*([A-Z]{2})\b/)?.[1],
    site:     (() => {
      const s = extractReg(block, [/[Ss]ite[:\s]+([^\s\n]+)/i])?.trim();
      return (s && s.length > 3) ? s : undefined;
    })(),
  };
}

async function extractWithRegex(buffer: Buffer): Promise<PdfExtractResult> {
  const pdfParse = (await import('pdf-parse')).default;
  const raw = (await pdfParse(buffer)).text ?? '';
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').normalize('NFC');

  // Log do texto bruto para diagnóstico nos logs do Railway
  console.log('[PDF] Tier3 (regex) — texto bruto (primeiros 1000 chars):\n' + text.slice(0, 1000));

  const result: PdfExtractResult = {};
  const V = '([\\d.]+,[\\d]{2})';

  // ── NF: rótulo + número na próxima linha (evita "Página 1/1")
  result.numeroNf = (() => {
    // Procura "Número da nota" e captura o número que segue na próxima linha não vazia
    const section = text.match(/N[uú]mero\s+da\s+nota[^\n]*\n([\s\S]{0,150})/i)?.[1] ?? '';
    // Primeiro número isolado que não seja parte de "X/Y" (ex: 1/1) e tenha pelo menos 1 dígito
    const m = section.match(/^\s*(\d+)\s*$/m)  // linha com só dígitos
      ?? section.match(/\b(\d{2,6})\b(?!\s*\/)/); // ou número ≥2 dígitos não seguido de /
    return m?.[1];
  })();

  // ── RPS
  result.numeroRps = (() => {
    const section = text.match(/N[uú]mero\s+do\s+RPS[^\n]*\n([\s\S]{0,80})/i)?.[1] ?? '';
    return section.match(/^\s*(\d+)\s*$/m)?.[1]
      ?? section.match(/\b(\d{1,6})\b(?!\s*\/)/)?.[1];
  })();

  // ── Código de verificação: busca código MAIÚSCULO com pelo menos 1 dígito
  //    Usa janela grande mas exige padrão estrito (não casa com nomes de cidades)
  result.codigoVerificacao = (() => {
    const idx = text.search(/C[oó]digo\s+de\s+verifica[çc][ãa]o/i);
    if (idx < 0) return undefined;
    // Pega até 300 chars depois do rótulo e procura código maiúsculo c/ dígito
    const window = text.slice(idx, idx + 300);
    // Código válido: só maiúsculas e dígitos, min 6 chars, DEVE ter pelo menos uma letra E um dígito
    const m = window.match(/\b([A-Z][A-Z0-9]{5,19})\b/g);
    if (!m) return undefined;
    // Filtra: deve conter pelo menos 1 letra e 1 dígito
    return m.find(c => /[A-Z]/.test(c) && /[0-9]/.test(c));
  })();

  // ── Datas
  result.dataEmissao = extractDate(text, [
    /Data\s+da\s+emiss[ãa]o\s+da\s+nota[^\n]*\n[^\n]*?(\d{2}\/\d{2}\/\d{4})/i,
    /Data\s+da\s+emiss[ãa]o\s+da\s+nota\s*[:\s]+(\d{2}\/\d{2}\/\d{4})/i,
    /[Ee]miss[ãa]o[:\s]+(\d{2}\/\d{2}\/\d{4})/i,
  ]);
  result.dataFatoGerador = extractDate(text, [
    /[Ff]ato\s+[Gg]erador[^\n]*\n[^\n]*?(\d{2}\/\d{2}\/\d{4})/i,
    /[Ff]ato\s+[Gg]erador[:\s]+(\d{2}\/\d{2}\/\d{4})/i,
  ]);

  result.tipo = extractReg(text, [/(NFS?-?e)/i, /(NF-?e)/i]) ?? 'NFS-e';
  result.municipioEmissor = extractReg(text, [/MUNIC[IÍ]PIO\s+DE\s+([A-ZÀ-Ú][^\n\r,]+)/i])?.trim();
  result.of = extractReg(text, [/\bOF\s*[:\s.]+(\d{6,})/i]);
  result.codigoServico = extractReg(text, [
    /C[oó]digos?\s+dos?\s+[Ss]ervi[çc]os?[\s\S]{0,20}?([\d]{1,2}\.[\d]{2})/i,
    /\b(\d{2}\.\d{2})\s*[-–]\s*Lubri/i,
    /\b(\d{2}\.\d{2})\b/,
  ]);

  // ── Blocos de prestador/tomador
  const pStart = text.search(/PRESTADOR\s+DE\s+SERVI[ÇC]OS/i);
  const tStart = text.search(/TOMADOR\s+DE\s+SERVI[ÇC]OS/i);
  const dStart = text.search(/DISCRIMINA[ÇC][AÃ]O\s+DOS\s+SERVI[ÇC]OS/i);

  result.prestador = parsePessoa(
    pStart >= 0 ? text.slice(pStart, tStart > pStart ? tStart : pStart + 1500) : text.slice(0, 1500)
  );
  result.tomador = parsePessoa(
    tStart >= 0 ? text.slice(tStart, dStart > tStart ? dStart : tStart + 1500) : ''
  );

  // ── Valores
  result.valorBruto   = extractFloat(text, [new RegExp(`Valor\\s+bruto\\s*[=:]\\s*R\\$\\s*${V}`, 'i')]);
  result.valorLiquido = extractFloat(text, [new RegExp(`Valor\\s+l[íi]quido\\s*[=:]\\s*R\\$\\s*${V}`, 'i')]);
  result.baseCalculo  = extractFloat(text, [new RegExp(`Base\\s+de\\s+[Cc][áa]lculo[^\\n]*?${V}`, 'i')]);
  result.aliquota     = extractFloat(text, [/Al[íi]quota\s+(?:do\s+)?ISS[^0-9]*([\d,]+)\s*%/i]);
  result.valorIss     = extractFloat(text, [new RegExp(`Valor\\s+ISS[^\\n]*?${V}`, 'i')]);

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
  result.ir              = extractFloat(retBlock, retP('\\bIR\\b'));
  result.csll            = extractFloat(retBlock, retP('CSLL'));
  result.outrasRetencoes = extractFloat(retBlock, retP('Outras\\s+Reten[çc][õo]es'));

  // Fallback: pega os 6 primeiros valores R$ encontrados no bloco de retenções
  if (retBlock && result.pisPasep == null && result.cofins == null) {
    const vals = Array.from(retBlock.matchAll(/R\$\s*([\d.]+,\d{2})/g))
      .map(m => { const n = parseFloat(m[1].replace(/\./g, '').replace(',', '.')); return isNaN(n) ? undefined : n; });
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

  // nome organizador
  const tNome = result.tomador?.nomeRazaoSocial ?? result.tomador?.nomeFantasia;
  result.nomeOrganizador = result.numeroNf && tNome
    ? `NF ${result.numeroNf} – ${tNome.replace(/\s+(Ltda\.?|S\.A\.?|ME\.?)$/i,'').trim().slice(0,28)}`
    : result.numeroNf ? `NF ${result.numeroNf}` : undefined;

  result.camposNaoEncontrados = ['Número da NF','Data de Emissão','Valor Bruto','Valor Líquido'].filter((_, i) =>
    [result.numeroNf, result.dataEmissao, result.valorBruto, result.valorLiquido][i] == null);
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

  console.log('[PDF] Tier3 regex — numeroNf:', result.numeroNf, '| codigoVerificacao:', result.codigoVerificacao, '| prestador.cpfCnpj:', result.prestador?.cpfCnpj);
  return result;
}

// ─── Exportação principal ─────────────────────────────────────────────────────

export async function extractFromPdfBuffer(buffer: Buffer): Promise<PdfExtractResult> {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  console.log('[PDF] ANTHROPIC_API_KEY presente:', hasKey);

  if (hasKey) {
    // Tier 1: PDF direto ao Claude (lê layout real, sem perder tabelas)
    try {
      return await extractWithAIPdf(buffer);
    } catch (err) {
      console.error('[PDF] Tier1 FALHOU:', (err as Error).message?.slice(0, 200));
    }

    // Tier 2: Texto extraído → Claude Sonnet (fallback se PDF API falhar)
    try {
      const pdfParse = (await import('pdf-parse')).default;
      const raw = (await pdfParse(buffer)).text ?? '';
      const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').normalize('NFC');
      console.log('[PDF] Tier2 — texto extraído (200 chars):', text.slice(0, 200));
      return await extractWithAIText(text);
    } catch (err) {
      console.error('[PDF] Tier2 FALHOU:', (err as Error).message?.slice(0, 200));
    }
  }

  // Tier 3: Regex (sem API key ou se ambas as IAs falharem)
  return extractWithRegex(buffer);
}
