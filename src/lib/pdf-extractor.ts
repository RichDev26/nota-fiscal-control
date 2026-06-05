import type { PdfExtractResult } from '@/types';

// ─── Prompt para Claude ───────────────────────────────────────────────────────

const EXTRACTION_PROMPT = `Você é um parser especializado em NFS-e (Nota Fiscal de Serviços Eletrônica) brasileira.

Analise o texto de PDF abaixo e retorne um JSON com todos os campos encontrados.

REGRAS OBRIGATÓRIAS:
1. Retorne SOMENTE o JSON puro, sem markdown, sem \`\`\`json, sem explicações
2. Campos não encontrados = null
3. Datas: "YYYY-MM-DD" (ex: "2026-05-19") — ignore o horário
4. Valores monetários: número decimal sem símbolo (ex: 50000.00 para R$ 50.000,00)
5. Alíquota: número percentual (ex: 5 para 5%)
6. NUNCA invente dados — use apenas o que está no texto
7. Para números zero explícitos no texto (R$ 0,00), use 0, não null

ESTRUTURA DO JSON (use exatamente estas chaves):
{
  "numeroNf": "número da nota fiscal",
  "numeroRps": "número do RPS ou null",
  "codigoVerificacao": "código alfanumérico (ex: FHZSBPES7) ou null",
  "dataEmissao": "YYYY-MM-DD ou null",
  "dataFatoGerador": "YYYY-MM-DD ou null",
  "municipioEmissor": "nome do município emissor ou null",
  "tipo": "NFS-e",
  "of": "número OF/OS ou null",
  "codigoServico": "código do serviço (ex: 14.01) ou null",
  "descricao": "descrição do serviço prestado ou null",
  "quantidade": número_ou_null,
  "valorUnitario": número_ou_null,
  "valorBruto": número_ou_null,
  "valorLiquido": número_ou_null,
  "baseCalculo": número_ou_null,
  "aliquota": número_ou_null,
  "valorIss": número_ou_null,
  "ir": número_ou_null,
  "pisPasep": número_ou_null,
  "cofins": número_ou_null,
  "inss": número_ou_null,
  "csll": número_ou_null,
  "outrasRetencoes": número_ou_null,
  "desconto": número_ou_null,
  "descontoIncondicionado": número_ou_null,
  "deducoes": número_ou_null,
  "valorAproximadoTributos": número_ou_null,
  "valorAproximadoTributosFederal": número_ou_null,
  "valorAproximadoTributosEstadual": número_ou_null,
  "valorAproximadoTributosMunicipal": número_ou_null,
  "naturezaOperacao": "ex: Operação Tributável ou null",
  "situacaoTributariaIssqn": "ex: Retenção ou null",
  "localPrestacao": "cidade ou null",
  "situacaoNfse": "ex: Retida ou null",
  "regimeTributario": "ex: Simples Nacional ou null",
  "simplesNacional": true_ou_false_ou_null,
  "observacoesFiscais": "observações fiscais ou null",
  "prestador": {
    "nomeRazaoSocial": "razão social ou null",
    "nomeFantasia": "nome fantasia ou null",
    "cpfCnpj": "XX.XXX.XXX/XXXX-XX ou null",
    "inscricaoMunicipal": "número ou null",
    "inscricaoEstadual": "número ou null",
    "endereco": "logradouro (sem número) ou null",
    "numero": "número do endereço ou null",
    "complemento": "complemento ou null",
    "bairro": "bairro ou null",
    "cep": "XXXXX-XXX ou null",
    "municipio": "cidade ou null",
    "uf": "UF (2 letras) ou null",
    "email": "email ou null",
    "telefone": "telefone ou null",
    "celular": "celular ou null",
    "site": "site ou null"
  },
  "tomador": {
    "nomeRazaoSocial": "razão social ou null",
    "nomeFantasia": "nome fantasia ou null",
    "cpfCnpj": "XX.XXX.XXX/XXXX-XX ou null",
    "inscricaoMunicipal": "número ou null",
    "inscricaoEstadual": "número ou null",
    "endereco": "logradouro (sem número) ou null",
    "numero": "número do endereço ou null",
    "complemento": "complemento ou null",
    "bairro": "bairro ou null",
    "cep": "XXXXX-XXX ou null",
    "municipio": "cidade ou null",
    "uf": "UF (2 letras) ou null",
    "email": "email ou null",
    "telefone": "telefone ou null",
    "celular": "celular ou null",
    "site": "site ou null"
  }
}

TEXTO DO PDF:
`;

// ─── Extração via IA (Claude) ─────────────────────────────────────────────────

async function extractWithAI(text: string): Promise<PdfExtractResult> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: EXTRACTION_PROMPT + text.slice(0, 12000),
    }],
  });

  const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
  if (!raw) throw new Error('Resposta vazia da IA');

  // Remove possível bloco markdown caso a IA coloque ```json ... ```
  const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/, '');

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Tenta extrair JSON da resposta
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('JSON não encontrado na resposta da IA');
    parsed = JSON.parse(m[0]);
  }

  return mapParsedToResult(parsed);
}

// ─── Mapeia resposta da IA para PdfExtractResult ──────────────────────────────

function mapParsedToResult(p: Record<string, unknown>): PdfExtractResult {
  const str = (v: unknown): string | undefined =>
    (v != null && v !== '' && v !== 'null') ? String(v) : undefined;

  const num = (v: unknown): number | undefined => {
    if (v == null || v === '' || v === 'null') return undefined;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
    return isNaN(n) ? undefined : n;
  };

  const bool = (v: unknown): boolean | undefined => {
    if (v == null) return undefined;
    if (typeof v === 'boolean') return v;
    if (v === 'true' || v === 'sim' || v === '1') return true;
    if (v === 'false' || v === 'não' || v === '0') return false;
    return undefined;
  };

  const pessoa = (o: unknown) => {
    if (!o || typeof o !== 'object') return undefined;
    const q = o as Record<string, unknown>;
    return {
      nomeRazaoSocial: str(q.nomeRazaoSocial),
      nomeFantasia:    str(q.nomeFantasia),
      cpfCnpj:         str(q.cpfCnpj),
      inscricaoMunicipal: str(q.inscricaoMunicipal),
      inscricaoEstadual:  str(q.inscricaoEstadual),
      endereco:    str(q.endereco),
      numero:      str(q.numero),
      complemento: str(q.complemento),
      bairro:      str(q.bairro),
      cep:         str(q.cep),
      municipio:   str(q.municipio),
      uf:          str(q.uf),
      email:       str(q.email),
      telefone:    str(q.telefone),
      celular:     str(q.celular),
      site:        str(q.site),
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
    quantidade:   num(p.quantidade),
    valorUnitario: num(p.valorUnitario),
    valorBruto:   num(p.valorBruto),
    valorLiquido: num(p.valorLiquido),
    baseCalculo:  num(p.baseCalculo),
    aliquota:     num(p.aliquota),
    valorIss:     num(p.valorIss),
    ir:           num(p.ir),
    pisPasep:     num(p.pisPasep),
    cofins:       num(p.cofins),
    inss:         num(p.inss),
    csll:         num(p.csll),
    outrasRetencoes:     num(p.outrasRetencoes),
    desconto:            num(p.desconto),
    descontoIncondicionado: num(p.descontoIncondicionado),
    deducoes:            num(p.deducoes),
    valorAproximadoTributos:         num(p.valorAproximadoTributos),
    valorAproximadoTributosFederal:  num(p.valorAproximadoTributosFederal),
    valorAproximadoTributosEstadual: num(p.valorAproximadoTributosEstadual),
    valorAproximadoTributosMunicipal: num(p.valorAproximadoTributosMunicipal),
    simplesNacional: bool(p.simplesNacional),
    prestador: pessoa(p.prestador),
    tomador:   pessoa(p.tomador),
    fontesExtracao: ['ia-claude'],
  };

  // ── Nome organizador sugerido ──────────────────────────────────────────────
  const tNome = result.tomador?.nomeRazaoSocial ?? result.tomador?.nomeFantasia;
  if (result.numeroNf && tNome) {
    const short = tNome
      .replace(/\s+(Ltda\.?|S\.A\.?|ME\.?|EIRELI|EPP)\.?$/i, '')
      .trim()
      .slice(0, 28);
    result.nomeOrganizador = `NF ${result.numeroNf} – ${short}`;
  } else if (result.numeroNf) {
    result.nomeOrganizador = `NF ${result.numeroNf}`;
  }

  // ── Validação de consistência ──────────────────────────────────────────────
  const issues: string[] = [];
  if (result.valorBruto && result.valorLiquido && result.valorIss != null) {
    const totalRet =
      (result.valorIss ?? 0) + (result.ir ?? 0) + (result.pisPasep ?? 0)
      + (result.cofins ?? 0) + (result.inss ?? 0) + (result.csll ?? 0)
      + (result.outrasRetencoes ?? 0);
    const expected = result.valorBruto - totalRet;
    if (Math.abs(expected - result.valorLiquido) > 1) {
      issues.push(`Valor líquido: esperado R$ ${expected.toFixed(2)}, PDF R$ ${result.valorLiquido.toFixed(2)}`);
    }
  }
  result.inconsistencias = issues;

  // ── Campos ausentes ────────────────────────────────────────────────────────
  result.camposNaoEncontrados = [
    ...(result.numeroNf    ? [] : ['Número da NF']),
    ...(result.dataEmissao ? [] : ['Data de Emissão']),
    ...(result.valorBruto  ? [] : ['Valor Bruto']),
    ...(result.valorLiquido ? [] : ['Valor Líquido']),
  ];

  // ── Baixa confiança ────────────────────────────────────────────────────────
  result.camposBaixaConfianca = [
    ...(result.codigoVerificacao   ? [] : ['Código de Verificação']),
    ...(result.tomador?.cpfCnpj    ? [] : ['CNPJ do Tomador']),
    ...(result.prestador?.cpfCnpj  ? [] : ['CNPJ do Prestador']),
  ];

  // ── Resumo ─────────────────────────────────────────────────────────────────
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

// ─── Extração por regex (fallback) ────────────────────────────────────────────

function extractReg(text: string, patterns: RegExp[]): string | undefined {
  for (const p of patterns) {
    const v = text.match(p)?.[1]?.trim();
    if (v && v.length > 0) return v;
  }
}

function extractFloatReg(text: string, patterns: RegExp[]): number | undefined {
  const raw = extractReg(text, patterns);
  if (!raw) return undefined;
  const n = parseFloat(raw.replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? undefined : n;
}

function extractDateReg(text: string, patterns: RegExp[]): string | undefined {
  const raw = extractReg(text, patterns);
  if (!raw) return undefined;
  const m = raw.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
}

function parsePessoa(block: string) {
  const endLine = block.match(/[Ee]ndere[çc]o[:\s]+([^\n]+)/i)?.[1] ?? '';
  const enderecoBase = endLine.replace(/\s*N[uú]mero[:\s].+$/i, '').trim();
  const numero = endLine.match(/N[uú]mero[:\s]+([^\s,]+)/i)?.[1]?.trim()
    ?? block.match(/N[uú]mero[:\s]+([^\n,\s]+)/i)?.[1]?.trim();
  const bairro = endLine.match(/Bairro[:\s]+([^\n]+?)(?:\s{2,}|\s*CEP|$)/i)?.[1]?.trim()
    ?? block.match(/Bairro[:\s]+([^\n]+?)(?:\s{2,}|\s*CEP|$)/i)?.[1]?.trim();
  const cep = endLine.match(/CEP[:\s]*([\d]{5}-?[\d]{3})/i)?.[1]?.trim()
    ?? block.match(/CEP[:\s]*([\d]{5}-?[\d]{3})/i)?.[1]?.trim();
  const municipioRaw = block.match(/Munic[ií]pio[:\s]+([^\n\t]+?)(?:\s{3,}|UF\s*:|$)/i)?.[1]?.trim();
  const ufRaw = block.match(/\bUF[:\s]*([A-Z]{2})\b/)?.[1];
  const clean = (s?: string | null) => (s?.replace(/\s+/g, ' ').trim() || undefined);
  const LABELS = /^(Endere[çc]o|Complemento|Bairro|CEP|Munic[ií]pio|UF[:\s]|E-?mail|Telefone|Celular|Site|CPF|CNPJ|Inscri[çc]|N[uú]mero[:\s]|ROD\s|R\s+[A-Z])/i;
  const notLabel = (v?: string) => (v && !LABELS.test(v)) ? v : undefined;
  const validPhone = (v?: string) => (v && !/\//.test(v) && /\d{4,}/.test(v)) ? v : undefined;
  return {
    nomeRazaoSocial: notLabel(clean(extractReg(block, [
      /Nome\s*\/?\s*Raz[ãa]o\s+[Ss]ocial[:\s]+([^\n]+)/i,
      /Raz[ãa]o\s+[Ss]ocial[:\s]+([^\n]+)/i,
    ]))),
    nomeFantasia: notLabel(clean(extractReg(block, [/Nome\s+[Ff]antasia[:\s]+([^\n]+)/i]))),
    cpfCnpj: extractReg(block, [
      /CPF\s*\/\s*CNPJ[:\s]*([\d.\/\-]{11,18})/i,
      /CNPJ[:\s]*([\d.\/\-]{14,18})/i,
    ])?.trim(),
    inscricaoMunicipal: extractReg(block, [/Inscri[çc][ãa]o\s+[Mm]unicipal[:\s]*([\d.\-\/]+)/i])?.trim(),
    inscricaoEstadual:  (() => {
      const v = extractReg(block, [/Inscri[çc][ãa]o\s+[Ee]stadual[:\s]+([^\s\n\t]+)/i])?.replace(/[:\s]+$/, '').trim();
      return (v && v.length > 1) ? v : undefined;
    })(),
    email:    extractReg(block, [/E-?[Mm]ail[:\s]+([a-zA-Z0-9._%+\-]+@[^\s\n,]+)/i])?.trim(),
    telefone: validPhone(extractReg(block, [/Telefone[:\s]+([\(\d\s\)\-\.]{7,20})/i])?.trim()),
    celular:  validPhone(extractReg(block, [/Celular[:\s]+([\(\d\s\)\-\.]{7,20})/i])?.trim()),
    endereco:    enderecoBase || undefined,
    numero,
    complemento: (() => {
      const v = extractReg(block, [/Complemento[:\s]+([^\n\t]+)/i])?.trim();
      return (v && v !== '**' && v.length > 0) ? v : undefined;
    })(),
    bairro:    bairro || undefined,
    cep:       cep || undefined,
    municipio: municipioRaw || undefined,
    uf:        ufRaw || undefined,
    site:      (() => {
      const s = extractReg(block, [/[Ss]ite[:\s]+([^\s\n]+)/i])?.trim();
      return (s && s.length > 3) ? s : undefined;
    })(),
  };
}

async function extractWithRegex(buffer: Buffer): Promise<PdfExtractResult> {
  const pdfParse = (await import('pdf-parse')).default;
  const raw = (await pdfParse(buffer)).text ?? '';
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').normalize('NFC');

  const result: PdfExtractResult = {};
  const V = '([\\d.]+,[\\d]{2})';

  result.numeroNf = extractReg(text, [
    /N[uú]mero\s+da\s+nota\s{0,30}(\d+)/i,
    /NFS?-?e\s+N[º°o]?\s*\.?\s*(\d+)/i,
    /N[uú]mero\s+(?:da\s+)?NFS?-?e[:\s]+(\d+)/i,
  ]);
  result.numeroRps = extractReg(text, [
    /N[uú]mero\s+do\s+RPS\s{0,30}(\d+)/i,
    /N[uú]mero\s+do\s+RPS[:\s]+(\d+)/i,
  ]);
  result.codigoVerificacao = extractReg(text, [
    /C[oó]digo\s+de\s+[Vv]erifica[çc][ãa]o\s{0,30}([A-Z0-9]{6,20})/i,
    /C[oó]digo\s+de\s+[Vv]erifica[çc][ãa]o[:\s]+([A-Z0-9]{6,20})/i,
    /\b([A-Z]{3,}[0-9]+[A-Z0-9]{1,12})\b/,
  ]);
  result.dataEmissao = extractDateReg(text, [
    /Data\s+da\s+emiss[ãa]o\s+da\s+nota\s{0,30}(\d{2}\/\d{2}\/\d{4})/i,
    /Data\s+(?:e\s+Hora\s+)?(?:de\s+)?[Ee]miss[ãa]o[:\s]+(\d{2}\/\d{2}\/\d{4})/i,
  ]);
  result.dataFatoGerador = extractDateReg(text, [
    /Data\s+do\s+fato\s+gerador\s{0,30}(\d{2}\/\d{2}\/\d{4})/i,
    /[Ff]ato\s+[Gg]erador[:\s]+(\d{2}\/\d{2}\/\d{4})/i,
  ]);
  result.tipo = extractReg(text, [/(NFS?-?e)/i, /(NF-?e)/i]) ?? 'NFS-e';
  result.municipioEmissor = extractReg(text, [/MUNIC[IÍ]PIO\s+DE\s+([A-ZÀ-Ú][^\n\r,]+)/i])?.trim();
  result.of = extractReg(text, [/\bOF\s*[:\s.]+(\d{6,})/i]);
  result.codigoServico = extractReg(text, [
    /C[oó]digos?\s+dos?\s+[Ss]ervi[çc]os?\s*[:\n\r]+\s*([\d]{1,2}\.[\d]{2})/i,
    /\b(1[0-9]\.\d{2})\s*[-–]/,
    /\b(\d{2}\.\d{2})\s*[-–]/,
  ]);

  const pStart   = text.search(/PRESTADOR\s+DE\s+SERVI[ÇC]OS/i);
  const tStart   = text.search(/TOMADOR\s+DE\s+SERVI[ÇC]OS/i);
  const dStart   = text.search(/DISCRIMINA[ÇC][AÃ]O\s+DOS\s+SERVI[ÇC]OS/i);
  const retStart = text.search(/RETEN[ÇC][ÕO]ES\s+FEDERAIS/i);
  const outStart = text.search(/OUTRAS\s+INFORMA[ÇC][ÕO]ES/i);

  result.prestador = parsePessoa(pStart >= 0 ? text.slice(pStart, tStart > pStart ? tStart : pStart + 1500) : text.slice(0, 1500));
  result.tomador   = parsePessoa(tStart >= 0 ? text.slice(tStart, dStart > tStart ? dStart : tStart + 1500) : '');

  result.valorBruto  = extractFloatReg(text, [new RegExp(`Valor\\s+bruto\\s*[=:]\\s*R\\$\\s*${V}`, 'i')]);
  result.valorLiquido = extractFloatReg(text, [new RegExp(`Valor\\s+l[íi]quido\\s*[=:]\\s*R\\$\\s*${V}`, 'i')]);
  result.baseCalculo  = extractFloatReg(text, [new RegExp(`Base\\s+de\\s+[Cc][áa]lculo\\s*\\(?R\\$\\)?[:\\s]*${V}`, 'i')]);
  result.aliquota     = extractFloatReg(text, [/Al[íi]quota\s+do\s+ISS\s+([\d,]+)\s*%/i, /[\d.]+,\d{2}x([\d,]+)\s*[= ]/]);
  result.valorIss     = extractFloatReg(text, [new RegExp(`Valor\\s+ISS\\s*\\(?R\\$\\)?[:\\s]*${V}`, 'i'), /[\d.]+,\d{2}x[\d,]+\s*=\s*([\d.]+,\d{2})/]);

  const retBlock = (() => {
    if (retStart < 0) return '';
    const vbPos = text.indexOf('Valor bruto', retStart);
    const end = vbPos > retStart ? Math.min(vbPos, retStart + 600) : retStart + 600;
    return text.slice(retStart, end);
  })();

  const retP = (label: string) => [
    new RegExp(`${label}\\s+R\\$\\s*([\\d.]+,\\d{2})`, 'i'),
    new RegExp(`${label}[:\\s]*\\n\\s*R?\\$?\\s*([\\d.]+,\\d{2})`, 'i'),
  ];
  result.pisPasep        = extractFloatReg(retBlock, retP('PIS\\s*\\/\\s*PASEP'));
  result.cofins          = extractFloatReg(retBlock, retP('COFINS'));
  result.inss            = extractFloatReg(retBlock, retP('INSS'));
  result.ir              = extractFloatReg(retBlock, retP('\\bIR\\b'));
  result.csll            = extractFloatReg(retBlock, retP('CSLL'));
  result.outrasRetencoes = extractFloatReg(retBlock, retP('Outras\\s+Reten[çc][õo]es'));

  if (retBlock && result.pisPasep == null && result.cofins == null) {
    const vals = Array.from(retBlock.matchAll(/R\$\s*([\d.]+,\d{2})/g))
      .map(m => { const n = parseFloat(m[1].replace(/\./g, '').replace(',', '.')); return isNaN(n) ? undefined : n; });
    if (vals.length >= 6) {
      result.pisPasep ??= vals[0]; result.cofins ??= vals[1]; result.inss ??= vals[2];
      result.ir ??= vals[3]; result.csll ??= vals[4]; result.outrasRetencoes ??= vals[5];
    }
  }

  result.naturezaOperacao = extractReg(outStart >= 0 ? text.slice(outStart) : text.slice(-2000), [
    /[Nn]atureza\s+da\s+[Oo]pera[çc][ãa]o[:\s]+([^\n]+)/i,
    /(Opera[çc][ãa]o\s+Tribut[áa]vel|Opera[çc][ãa]o\s+Isenta)/i,
  ])?.trim();
  result.situacaoTributariaIssqn = extractReg(outStart >= 0 ? text.slice(outStart) : text.slice(-2000), [
    /[Ss]itua[çc][ãa]o\s+[Tt]ributária\s+do\s+ISSQN[:\s]+([^\n]+)/i,
    /(Reten[çc][ãa]o|Exig[íi]vel|Isento|Imune)/i,
  ])?.trim();
  result.localPrestacao = extractReg(outStart >= 0 ? text.slice(outStart) : text.slice(-2000), [
    /[Ll]ocal\s+da\s+presta[çc][ãa]o\s+do\s+servi[çc]o[:\s]+([^\n]+)/i,
  ])?.trim();
  result.situacaoNfse = extractReg(outStart >= 0 ? text.slice(outStart) : text.slice(-2000), [
    /[Ss]itua[çc][ãa]o\s+desta\s+NFS?-?e[:\s]+([^\n.]+)/i,
    /(Retida|Normal|Cancelada)/i,
  ])?.trim();
  result.regimeTributario = extractReg(outStart >= 0 ? text.slice(outStart) : text.slice(-2000), [
    /(Simples\s+Nacional|Lucro\s+Real|Lucro\s+Presumido)/i,
  ])?.trim();
  result.simplesNacional = /[Ss]imples\s+[Nn]acional/i.test(text);
  result.valorAproximadoTributosFederal  = extractFloatReg(text, [/federal\s*[-–]\s*R\$\s*([\d.]+,\d{2})/i]);
  result.valorAproximadoTributosEstadual = extractFloatReg(text, [/estadual\s*[-–]\s*R\$\s*([\d.]+,\d{2})/i]);
  result.valorAproximadoTributosMunicipal= extractFloatReg(text, [/municipal\s*[-–]\s*R\$\s*([\d.]+,\d{2})/i]);
  result.valorAproximadoTributos = result.valorAproximadoTributosFederal;

  const tNome = result.tomador?.nomeRazaoSocial ?? result.tomador?.nomeFantasia;
  result.nomeOrganizador = result.numeroNf && tNome
    ? `NF ${result.numeroNf} – ${tNome.replace(/\s+(Ltda\.?|S\.A\.?|ME\.?)$/i,'').trim().slice(0,28)}`
    : result.numeroNf ? `NF ${result.numeroNf}` : undefined;

  result.camposNaoEncontrados = ['Número da NF','Data de Emissão','Valor Bruto','Valor Líquido'].filter((_, i) =>
    [result.numeroNf, result.dataEmissao, result.valorBruto, result.valorLiquido][i] == null
  );
  result.camposBaixaConfianca = [
    ...(result.codigoVerificacao  ? [] : ['Código de Verificação']),
    ...(result.tomador?.cpfCnpj   ? [] : ['CNPJ do Tomador']),
    ...(result.prestador?.cpfCnpj ? [] : ['CNPJ do Prestador']),
  ];
  result.inconsistencias = [];
  result.fontesExtracao = ['pdf-regex'];

  const ps2: string[] = [];
  if (result.numeroNf)    ps2.push(`NF ${result.numeroNf}`);
  if (tNome)              ps2.push(tNome);
  if (result.valorBruto)  ps2.push(`R$ ${result.valorBruto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
  result.resumo = ps2.join(' | ');

  return result;
}

// ─── Exportação principal ─────────────────────────────────────────────────────

export async function extractFromPdfBuffer(buffer: Buffer): Promise<PdfExtractResult> {
  // Extrai texto bruto do PDF
  const pdfParse = (await import('pdf-parse')).default;
  const raw = (await pdfParse(buffer)).text ?? '';
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').normalize('NFC');

  // Tenta IA primeiro (se API key disponível)
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const result = await extractWithAI(text);
      console.log('[PDF Extractor] IA usada com sucesso');
      return result;
    } catch (err) {
      console.warn('[PDF Extractor] Falha na IA, usando regex como fallback:', err);
    }
  }

  // Fallback: regex
  console.log('[PDF Extractor] Usando regex (sem ANTHROPIC_API_KEY ou fallback)');
  return extractWithRegex(buffer);
}
