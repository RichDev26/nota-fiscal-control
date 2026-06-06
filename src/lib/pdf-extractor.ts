import type { PdfExtractResult } from '@/types';
import type { DocumentBlockParam } from '@anthropic-ai/sdk/resources/messages/messages';

// ─── Prompt para Claude ───────────────────────────────────────────────────────

const EXTRACTION_PROMPT = `Você é um parser especializado em NFS-e (Nota Fiscal de Serviços Eletrônica) brasileira.

Analise a NFS-e neste PDF e retorne um JSON com TODOS os campos visíveis.

REGRAS OBRIGATÓRIAS:
1. Retorne SOMENTE o JSON puro, sem markdown, sem \`\`\`json, sem explicações
2. Campos não encontrados = null
3. Datas: "YYYY-MM-DD" (ex: "2026-05-19") — ignore o horário
4. Valores monetários: número decimal sem símbolo (ex: 50000.00 para R$ 50.000,00)
5. Alíquota: número percentual (ex: 5 para 5%)
6. NUNCA invente dados — use apenas o que está visível no PDF
7. Para números zero explícitos no PDF (R$ 0,00), use 0, não null
8. "Número da nota" aparece no cabeçalho superior (campo "Número da nota" ou "N° da NFS-e")
9. "Número do RPS" aparece no cabeçalho superior (campo "Número do RPS")
10. "Código de verificação" é um código alfanumérico no cabeçalho (ex: FHZSBPES7)
11. CNPJ do prestador e do tomador estão nas seções "PRESTADOR DE SERVIÇOS" e "TOMADOR DE SERVIÇOS"

ESTRUTURA DO JSON (use exatamente estas chaves):
{
  "numeroNf": "número da nota fiscal (campo Número da nota ou N° da NFS-e)",
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
    "nomeRazaoSocial": "razão social completa ou null",
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
    "nomeRazaoSocial": "razão social completa ou null",
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
}`;

// ─── Extração via IA (Claude com PDF nativo — sem conversão para texto) ───────
//
// Em vez de converter o PDF em texto (o que perde a estrutura de tabelas),
// enviamos o PDF diretamente para o Claude via API de documentos.
// O Claude consegue ler o layout real do PDF e extrair todos os campos.

async function extractWithAI(buffer: Buffer): Promise<PdfExtractResult> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const pdfBase64 = buffer.toString('base64');

  // DocumentBlockParam é suportado nativamente pelo SDK (@anthropic-ai/sdk ^0.100.1)
  const docBlock: DocumentBlockParam = {
    type: 'document',
    source: {
      type: 'base64',
      media_type: 'application/pdf',
      data: pdfBase64,
    },
  };

  console.log('[PDF Extractor] Enviando PDF diretamente ao Claude (document API)...');

  const response = await client.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: [
        docBlock,
        { type: 'text', text: EXTRACTION_PROMPT },
      ],
    }],
  });

  const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
  if (!raw) throw new Error('Resposta vazia da IA');

  console.log('[PDF Extractor] Resposta da IA (primeiros 300 chars):', raw.slice(0, 300));

  // Remove possível bloco markdown caso a IA coloque ```json ... ```
  const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/, '').trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Tenta extrair JSON da resposta mesmo com texto antes/depois
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) {
      console.error('[PDF Extractor] JSON não encontrado. Resposta completa:', raw.slice(0, 500));
      throw new Error('JSON não encontrado na resposta da IA');
    }
    parsed = JSON.parse(m[0]);
  }

  console.log('[PDF Extractor] Campos extraídos:', Object.keys(parsed).filter(k => parsed[k] != null && parsed[k] !== 'null').join(', '));
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
    fontesExtracao: ['ia-claude-pdf'],
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

// ─── Extração por regex (fallback sem API key) ────────────────────────────────

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

  console.log('[PDF Extractor] Texto extraído (primeiros 800 chars):\n', text.slice(0, 800));

  const result: PdfExtractResult = {};
  const V = '([\\d.]+,[\\d]{2})';

  // ── Número da nota: rótulo pode estar longe do valor (tabela 2 colunas)
  result.numeroNf = extractReg(text, [
    /N[uú]mero\s+da\s+nota[\s\S]{0,80}?(\b\d{1,6}\b)/i,
    /NFS?-?e\s+N[º°o]?\s*\.?\s*(\d+)/i,
    /N[uú]mero\s+(?:da\s+)?NFS?-?e[:\s]+(\d+)/i,
  ]);

  // ── Número do RPS
  result.numeroRps = extractReg(text, [
    /N[uú]mero\s+do\s+RPS[\s\S]{0,60}?(\b\d+\b)/i,
    /N[uú]mero\s+do\s+RPS[:\s]+(\d+)/i,
  ]);

  // ── Código de verificação: alfanumérico ≥6 chars após o rótulo
  result.codigoVerificacao = extractReg(text, [
    /C[oó]digo\s+de\s+[Vv]erifica[çc][ãa]o[\s\S]{0,80}?([A-Z0-9]{6,20})/i,
    /[Vv]erifica[çc][ãa]o[\s\S]{0,40}?([A-Z]{2,}[0-9]{1,}[A-Z0-9]{1,})/,
  ]);

  // ── Datas — o conteúdo pode estar na mesma linha ou na próxima
  result.dataEmissao = extractDateReg(text, [
    /Data\s+da\s+emiss[ãa]o\s+da\s+nota[\s\S]{0,60}?(\d{2}\/\d{2}\/\d{4})/i,
    /Data\s+(?:e\s+Hora\s+)?(?:de\s+)?[Ee]miss[ãa]o[\s\S]{0,40}?(\d{2}\/\d{2}\/\d{4})/i,
  ]);
  result.dataFatoGerador = extractDateReg(text, [
    /[Ff]ato\s+[Gg]erador[\s\S]{0,60}?(\d{2}\/\d{2}\/\d{4})/i,
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

  result.prestador = parsePessoa(pStart >= 0 ? text.slice(pStart, tStart > pStart ? tStart : pStart + 1500) : text.slice(0, 1500));
  result.tomador   = parsePessoa(tStart >= 0 ? text.slice(tStart, dStart > tStart ? dStart : tStart + 1500) : '');

  result.valorBruto  = extractFloatReg(text, [new RegExp(`Valor\\s+bruto\\s*[=:]\\s*R\\$\\s*${V}`, 'i')]);
  result.valorLiquido = extractFloatReg(text, [new RegExp(`Valor\\s+l[íi]quido\\s*[=:]\\s*R\\$\\s*${V}`, 'i')]);
  result.baseCalculo  = extractFloatReg(text, [new RegExp(`Base\\s+de\\s+[Cc][áa]lculo\\s*\\(?R\\$\\)?[:\\s]*${V}`, 'i')]);
  result.aliquota     = extractFloatReg(text, [/Al[íi]quota\s+do\s+ISS\s+([\d,]+)\s*%/i]);
  result.valorIss     = extractFloatReg(text, [new RegExp(`Valor\\s+ISS\\s*\\(?R\\$\\)?[:\\s]*${V}`, 'i')]);

  const retStart = text.search(/RETEN[ÇC][ÕO]ES\s+FEDERAIS/i);
  const outStart = text.search(/OUTRAS\s+INFORMA[ÇC][ÕO]ES/i);

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
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  console.log('[PDF Extractor] ANTHROPIC_API_KEY presente:', hasKey);

  // Tier 1: PDF direto ao Claude (lê layout real, sem perder tabelas)
  if (hasKey) {
    try {
      const result = await extractWithAI(buffer);
      console.log('[PDF Extractor] ✓ IA com PDF nativo usada com sucesso. numeroNf:', result.numeroNf, '| dataEmissao:', result.dataEmissao);
      return result;
    } catch (err) {
      console.error('[PDF Extractor] ✗ Falha na IA com PDF nativo:', (err as Error).message);
      console.warn('[PDF Extractor] Caindo para regex como fallback...');
    }
  }

  // Tier 2: Regex sobre texto extraído pelo pdf-parse
  console.log('[PDF Extractor] Usando regex (sem API key ou IA falhou)');
  return extractWithRegex(buffer);
}
