import type { PdfExtractResult } from '@/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** First capture group that matches and has content. */
function extract(text: string, patterns: RegExp[]): string | undefined {
  for (const p of patterns) {
    const v = text.match(p)?.[1]?.trim();
    if (v && v.length > 0) return v;
  }
}

/** Extract first match and convert Brazilian currency to float. */
function extractFloat(text: string, patterns: RegExp[]): number | undefined {
  const raw = extract(text, patterns);
  if (!raw) return undefined;
  const n = parseFloat(raw.replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? undefined : n;
}

/** Extract date string "dd/mm/yyyy" → "yyyy-mm-dd". Ignores time suffix. */
function extractDate(text: string, patterns: RegExp[]): string | undefined {
  const raw = extract(text, patterns);
  if (!raw) return undefined;
  const m = raw.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Brazilian "1.234,56" string → float. */
function brl2n(s: string): number | undefined {
  const n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? undefined : n;
}

// ─── Pessoa Parser ────────────────────────────────────────────────────────────
// Handles the NFS-e layout where multiple fields appear on a single line, e.g.:
// "Endereço: R VEREADOR ATAULFO DE MATTOS Número: 6430 Bairro: JARDIM JOAO PAULO II CEP: 79841-090"

function parsePessoa(block: string) {
  const endLine = block.match(/[Ee]ndere[çc]o[:\s]+([^\n]+)/i)?.[1] ?? '';

  // Strip sub-fields from the address line to get just the street
  const enderecoBase = endLine
    .replace(/\s*N[uú]mero[:\s].+$/i, '')
    .replace(/\s*Logradouro[:\s]/i, '')
    .trim();

  const numero = endLine.match(/N[uú]mero[:\s]+([^\s,]+)/i)?.[1]?.trim()
    ?? block.match(/N[uú]mero[:\s]+([^\n,\s]+)/i)?.[1]?.trim();

  const bairro = endLine.match(/Bairro[:\s]+([^\n]+?)(?:\s{2,}|\s*CEP|$)/i)?.[1]?.trim()
    ?? block.match(/Bairro[:\s]+([^\n]+?)(?:\s{2,}|\s*CEP|$)/i)?.[1]?.trim();

  const cep = endLine.match(/CEP[:\s]*([\d]{5}-?[\d]{3})/i)?.[1]?.trim()
    ?? block.match(/CEP[:\s]*([\d]{5}-?[\d]{3})/i)?.[1]?.trim();

  // Municipality may be followed by spaces then "UF:XX"
  const municipioRaw = block.match(/Munic[ií]pio[:\s]+([^\n\t]+?)(?:\s{3,}|UF\s*:|$)/i)?.[1]?.trim();
  const ufRaw = block.match(/\bUF[:\s]*([A-Z]{2})\b/)?.[1];

  const siteRaw = extract(block, [/[Ss]ite[:\s]+([^\s\n]+)/i]);

  const clean = (s?: string | null) => (s?.replace(/\s+/g, ' ').trim() || undefined);

  return {
    nomeRazaoSocial: clean(extract(block, [
      /Nome\s*\/?\s*Raz[ãa]o\s+[Ss]ocial[:\s]+([^\n]+)/i,
      /Raz[ãa]o\s+[Ss]ocial[:\s]+([^\n]+)/i,
    ])),
    nomeFantasia: clean(extract(block, [/Nome\s+[Ff]antasia[:\s]+([^\n]+)/i])),
    cpfCnpj: extract(block, [
      /CPF\s*\/\s*CNPJ[:\s]*([\d.\/\-]{11,18})/i,
      /CNPJ[:\s]*([\d.\/\-]{14,18})/i,
      /CPF[:\s]*([\d.\-]{11,14})/i,
    ])?.trim(),
    inscricaoMunicipal: extract(block, [
      /Inscri[çc][ãa]o\s+[Mm]unicipal[:\s]*([\d.\-\/]+)/i,
    ])?.trim(),
    inscricaoEstadual: (() => {
      const v = extract(block, [/Inscri[çc][ãa]o\s+[Ee]stadual[:\s]+([^\s\n\t]+)/i])?.replace(/[:\s]+$/, '').trim();
      return (v && v.length > 1) ? v : undefined;
    })(),
    email: extract(block, [/E-?[Mm]ail[:\s]+([a-zA-Z0-9._%+\-]+@[^\s\n,]+)/i])?.trim(),
    telefone: extract(block, [/Telefone[:\s]+([\(\d\s\)\-\.]{7,20})/i])?.trim(),
    celular: (() => {
      const v = extract(block, [/Celular[:\s]+([\(\d\s\)\-\.]{7,20})/i])?.trim();
      return (v && /\d{4,}/.test(v)) ? v : undefined;
    })(),
    endereco: enderecoBase || undefined,
    numero,
    complemento: (() => {
      const v = extract(block, [/Complemento[:\s]+([^\n\t]+)/i])?.trim();
      return (v && v !== '**' && v.length > 0) ? v : undefined;
    })(),
    bairro: bairro || undefined,
    cep: cep || undefined,
    municipio: municipioRaw || undefined,
    uf: ufRaw || undefined,
    site: (siteRaw && siteRaw.length > 3) ? siteRaw : undefined,
  };
}

// ─── Main Extractor ────────────────────────────────────────────────────────────

export async function extractFromPdfBuffer(buffer: Buffer): Promise<PdfExtractResult> {
  const pdfParse = (await import('pdf-parse')).default;
  const raw = (await pdfParse(buffer)).text ?? '';
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const result: PdfExtractResult = {};
  const lowConf: string[] = [];
  const issues: string[] = [];

  // ── Currency capture group (reused throughout) ───────────────────────────────
  const V = '([\\d.]+,[\\d]{2})';

  // ─── Número da nota ──────────────────────────────────────────────────────────
  result.numeroNf = extract(text, [
    /N[uú]mero\s+da\s+nota\s*\n+\s*(\d+)/i,           // valor na linha seguinte
    /NFS?-?e\s+N[º°o]?\s*\.?\s*(\d+)/i,
    /N[uú]mero\s+(?:da\s+)?NFS?-?e[:\s]+(\d+)/i,
    /Nota\s+Fiscal[^\n]{0,40}N[º°]\s*(\d+)/i,
    /\bNF\s+N[º°]?\s*:?\s*(\d+)\b/i,
  ]);

  // ─── Número RPS ──────────────────────────────────────────────────────────────
  result.numeroRps = extract(text, [
    /N[uú]mero\s+do\s+RPS\s*\n+\s*(\d+)/i,
    /N[uú]mero\s+do\s+RPS[:\s]+(\d+)/i,
    /RPS\s*N[º°]?\s*[:\s]*(\d+)/i,
  ]);

  // ─── Código de verificação ───────────────────────────────────────────────────
  // Pattern: multi-char uppercase + digit(s) + more alphanum — e.g. FHZSBPES7
  result.codigoVerificacao = extract(text, [
    /C[oó]digo\s+de\s+[Vv]erifica[çc][ãa]o\s*\n+\s*([A-Z0-9]{6,20})/i,
    /C[oó]digo\s+de\s+[Vv]erifica[çc][ãa]o[:\s]+([A-Z0-9]{6,20})/i,
    /Verifica[çc][ãa]o[:\s\n]+([A-Z0-9]{6,20})/i,
    // Standalone codes like "FHZSBPES7": 3+ uppercase letters, then digits, then optionally more
    /\b([A-Z]{3,}[0-9]+[A-Z0-9]{1,12})\b/,
  ]);

  // ─── Datas ───────────────────────────────────────────────────────────────────
  result.dataEmissao = extractDate(text, [
    /Data\s+da\s+emiss[ãa]o\s+da\s+nota\s*\n+\s*(\d{2}\/\d{2}\/\d{4})/i,
    /Data\s+(?:e\s+Hora\s+)?(?:de\s+)?[Ee]miss[ãa]o[:\s]+(\d{2}\/\d{2}\/\d{4})/i,
    /[Ee]miss[ãa]o\s+da\s+[Nn]ota[:\s]+(\d{2}\/\d{2}\/\d{4})/i,
    /[Ee]miss[ãa]o[:\s]+(\d{2}\/\d{2}\/\d{4})/i,
  ]);

  result.dataFatoGerador = extractDate(text, [
    /Data\s+do\s+fato\s+gerador\s*\n+\s*(\d{2}\/\d{2}\/\d{4})/i,
    /[Ff]ato\s+[Gg]erador[:\s]+(\d{2}\/\d{2}\/\d{4})/i,
    /[Cc]ompet[eê]ncia[:\s]+(\d{2}\/\d{2}\/\d{4})/i,
  ]);

  // ─── Tipo ────────────────────────────────────────────────────────────────────
  result.tipo = extract(text, [/(NFS?-?e)/i, /(NF-?e)/i]) ?? 'NFS-e';

  // ─── Município emissor ───────────────────────────────────────────────────────
  result.municipioEmissor = extract(text, [
    /MUNIC[IÍ]PIO\s+DE\s+([A-ZÀ-Ú][^\n\r,]+)/i,
    /Prefeitura\s+(?:Municipal\s+)?de\s+([^\n,\r]+)/i,
  ])?.trim();

  // ─── OF (Ordem de Fornecimento) ──────────────────────────────────────────────
  result.of = extract(text, [
    /\bOF\s*[:\s.]+(\d{6,})/i,
    /Ordem\s+de\s+(?:Fornecimento|Servi[çc]o)\s*:?\s*(\d+)/i,
    /\bOF\b[^\d\n]{0,5}(\d{6,})/i,
  ]);

  // ─── Código do serviço ───────────────────────────────────────────────────────
  result.codigoServico = extract(text, [
    /C[oó]digos?\s+dos?\s+[Ss]ervi[çc]os?\s*[:\n\r]+\s*([\d]{1,2}\.[\d]{2})/i,
    /C[oó]digo\s+do\s+[Ss]ervi[çc]o[:\s]+([\d]{1,2}\.[\d]{2}[\d.]*)/i,
    // "14.01 - Descrição..." — service list code
    /\b(1[0-9]\.\d{2})\s*[-–]/,
    /\b(\d{2}\.\d{2})\s*[-–]/,
  ]);

  // ─── Localizar blocos da nota ─────────────────────────────────────────────────
  const pStart   = text.search(/PRESTADOR\s+DE\s+SERVI[ÇC]OS/i);
  const tStart   = text.search(/TOMADOR\s+DE\s+SERVI[ÇC]OS/i);
  const dStart   = text.search(/DISCRIMINA[ÇC][AÃ]O\s+DOS\s+SERVI[ÇC]OS|DADOS\s+DO\s+SERVI[ÇC]O/i);
  const retStart = text.search(/RETEN[ÇC][ÕO]ES\s+FEDERAIS/i);
  const outStart = text.search(/OUTRAS\s+INFORMA[ÇC][ÕO]ES/i);

  const prestadorBlock = pStart >= 0
    ? text.slice(pStart, tStart > pStart ? tStart : pStart + 1500)
    : text.slice(0, 1500);

  const tomadorBlock = tStart >= 0
    ? text.slice(tStart, dStart > tStart ? dStart : tStart + 1500)
    : '';

  const descBlock = dStart >= 0
    ? text.slice(dStart, retStart > dStart ? retStart : dStart + 1200)
    : '';

  const retBlock = retStart >= 0
    ? text.slice(retStart, retStart + 700)
    : text;

  const outrasBlock = outStart >= 0
    ? text.slice(outStart)
    : text.slice(-2000);

  result.prestador = parsePessoa(prestadorBlock);
  result.tomador   = parsePessoa(tomadorBlock);

  // ─── Descrição do serviço ─────────────────────────────────────────────────────
  // The first free-text line after the section + column header lines
  if (descBlock) {
    const lines = descBlock.split('\n').map(l => l.trim()).filter(Boolean);
    // Skip section header and column header lines
    const contentIdx = lines.findIndex(l =>
      l.length > 10
      && !/DISCRIMINA|Valor\s+unit|Qtd\.?|Base\s+de\s+c[áa]lculo|ISS$/i.test(l)
      && !/^[\d.,\s]+$/.test(l)          // purely numeric lines
      && !/^R\$/i.test(l)
    );
    if (contentIdx >= 0) {
      const descLine = lines[contentIdx];
      // Accept if it looks like a real description (not a code line)
      if (!/^\d{2}\.\d{2}/.test(descLine)) {
        result.descricao = descLine.slice(0, 400);
      }
    }
  }
  if (!result.descricao) {
    result.descricao = extract(text, [
      /[Rr]eferente\s+[àa]\s+([^\n.]{10,300})/i,
      /[Dd]iscrimina[çc][ãa]o[^\n]*\n([^\n]{10,300})/i,
    ])?.trim();
  }

  // ─── Valores ──────────────────────────────────────────────────────────────────

  // "Valor bruto = R$ 50.000,00"  OR  "Valor bruto: R$ 50.000,00"
  result.valorBruto = extractFloat(text, [
    new RegExp(`Valor\\s+bruto\\s*[=:]\\s*R\\$\\s*${V}`, 'i'),
    new RegExp(`Valor\\s+(?:Total\\s+)?(?:dos\\s+Servi[çc]os|[Bb]ruto)[:\\s]+R?\\$?\\s*${V}`, 'i'),
    new RegExp(`TOTAL\\s+DOS\\s+SERVI[ÇC]OS[:\\s]+R?\\$?\\s*${V}`, 'i'),
    new RegExp(`Valor\\s+Total[:\\s]+R?\\$?\\s*${V}`, 'i'),
  ]);

  // "Valor líquido = R$ 47.500,00"
  result.valorLiquido = extractFloat(text, [
    new RegExp(`Valor\\s+l[íi]quido\\s*[=:]\\s*R\\$\\s*${V}`, 'i'),
    new RegExp(`Valor\\s+L[íi]quido\\s+da\\s+NFS?-?e[:\\s]+R?\\$?\\s*${V}`, 'i'),
    new RegExp(`Valor\\s+L[íi]quido[:\\s]+R?\\$?\\s*${V}`, 'i'),
  ]);

  // "Base de cálculo(R$)" in the final table
  result.baseCalculo = extractFloat(text, [
    new RegExp(`Base\\s+de\\s+[Cc][áa]lculo\\s*\\(?R\\$\\)?[:\\s]*${V}`, 'i'),
    new RegExp(`Base\\s+de\\s+[Cc][áa]lculo[:\\s]+R?\\$?\\s*${V}`, 'i'),
    new RegExp(`\\bBC\\s+ISS[:\\s]+R?\\$?\\s*${V}`, 'i'),
  ]);

  // Alíquota: "Al...ISS 5%" or from "50.000,00x5,00 = 2.500,00" inline calculation
  result.aliquota = extractFloat(text, [
    /Al[íi]quota\s+do\s+ISS\s+([\d,]+)\s*%/i,
    /Al[íi]quota[:\s]+([\d,]+)\s*%/i,
    // "...50.000,0000  1.0000  50.000,0000  50.000,00x5,00= 2.500,00"
    /[\d.]+,\d{2}x([\d,]+)\s*[= ]/,
  ]);

  // "Valor ISS(R$)" or from "= 2.500,00" result of the x calculation
  result.valorIss = extractFloat(text, [
    new RegExp(`Valor\\s+ISS\\s*\\(?R\\$\\)?[:\\s]*${V}`, 'i'),
    new RegExp(`Valor\\s+(?:do\\s+)?ISS[:\\s]+R?\\$?\\s*${V}`, 'i'),
    // From inline calc: "50.000,00x5,00= 2.500,00"
    /[\d.]+,\d{2}x[\d,]+\s*=\s*([\d.]+,\d{2})/,
    new RegExp(`\\bISS\\b[:\\s]+R?\\$?\\s*${V}`, 'i'),
  ]);

  result.quantidade = extractFloat(text, [
    /\bQtd?\.?\s+([\d,]+(?:\.\d+)?)\b/i,
    /Quantidade[:\s]+([\d,]+(?:\.\d+)?)/i,
  ]);

  result.valorUnitario = extractFloat(text, [
    new RegExp(`Valor\\s+unit[áa]rio[:\\s]+R?\\$?\\s*${V}`, 'i'),
    new RegExp(`Pre[çc]o\\s+unit[áa]rio[:\\s]+R?\\$?\\s*${V}`, 'i'),
  ]);

  // Descontos e deduções (mostrados na revisão, mas não gravados no banco)
  result.desconto = extractFloat(text, [
    new RegExp(`Desc\\.?\\s+condicionado\\s*\\(?R\\$\\)?[:\\s]*${V}`, 'i'),
    new RegExp(`Desconto\\s+condicionado[:\\s]+R?\\$?\\s*${V}`, 'i'),
  ]);

  result.descontoIncondicionado = extractFloat(text, [
    new RegExp(`Desc\\.?\\s+incondicionado\\s*\\(?R\\$\\)?[:\\s]*${V}`, 'i'),
    new RegExp(`Desconto\\s+incondicionado[:\\s]+R?\\$?\\s*${V}`, 'i'),
  ]);

  result.deducoes = extractFloat(text, [
    new RegExp(`Dedu[çc][õo]es\\s*\\(?R\\$\\)?[:\\s]*${V}`, 'i'),
    new RegExp(`Dedu[çc][ãa]o[:\\s]+R?\\$?\\s*${V}`, 'i'),
  ]);

  // ─── Retenções federais ───────────────────────────────────────────────────────
  // Try: label + inline value; then label + next-line value; then table fallback

  const retP = (label: string) => [
    new RegExp(`${label}\\s+R\\$\\s*(${V.slice(1, -1)})`, 'i'),
    new RegExp(`${label}[:\\s]*\\n\\s*R?\\$?\\s*(${V.slice(1, -1)})`, 'i'),
    new RegExp(`${label}[:\\s]+(${V.slice(1, -1)})`, 'i'),
  ];

  result.pisPasep      = extractFloat(retBlock, retP('PIS\\s*\\/\\s*PASEP').concat(retP('\\bPIS\\b')));
  result.cofins        = extractFloat(retBlock, retP('COFINS'));
  result.inss          = extractFloat(retBlock, retP('INSS'));
  result.ir            = extractFloat(retBlock, retP('\\bIR\\b'));
  result.csll          = extractFloat(retBlock, retP('CSLL'));
  result.outrasRetencoes = extractFloat(retBlock, retP('Outras\\s+Reten[çc][õo]es'));

  // Fallback: table layout — extract all "R$ X" in order (PIS, COFINS, INSS, IR, CSLL, Outras)
  if (result.pisPasep == null && result.cofins == null) {
    const allVals = Array.from(retBlock.matchAll(/R\$\s*([\d.]+,\d{2})/g)).map(m => brl2n(m[1]));
    if (allVals.length >= 6) {
      result.pisPasep        ??= allVals[0];
      result.cofins          ??= allVals[1];
      result.inss            ??= allVals[2];
      result.ir              ??= allVals[3];
      result.csll            ??= allVals[4];
      result.outrasRetencoes ??= allVals[5];
    }
  }

  // ─── Tributos aproximados ─────────────────────────────────────────────────────
  // "Valor aproximado do tributo federal - R$ 6.725,00 (13,45%), estadual - R$ 0,00 ..., municipal - R$ 2.500,00"
  result.valorAproximadoTributosFederal = extractFloat(text, [
    /federal\s*[-–]\s*R\$\s*([\d.]+,\d{2})/i,
  ]);
  result.valorAproximadoTributosEstadual = extractFloat(text, [
    /estadual\s*[-–]\s*R\$\s*([\d.]+,\d{2})/i,
  ]);
  result.valorAproximadoTributosMunicipal = extractFloat(text, [
    /municipal\s*[-–]\s*R\$\s*([\d.]+,\d{2})/i,
  ]);
  // Valor total = federal (first one found, most relevant for display)
  result.valorAproximadoTributos =
    result.valorAproximadoTributosFederal
    ?? extractFloat(text, [
      /[Tt]ributos[^\n]{0,80}R\$\s*([\d.]+,\d{2})/i,
    ]);

  // ─── Situação fiscal ──────────────────────────────────────────────────────────
  result.naturezaOperacao = extract(outrasBlock, [
    /[Nn]atureza\s+da\s+[Oo]pera[çc][ãa]o[:\s]+([^\n]+)/i,
    /(Opera[çc][ãa]o\s+Tribut[áa]vel|Opera[çc][ãa]o\s+Isenta|Opera[çc][ãa]o\s+Imune)/i,
  ])?.trim();

  result.situacaoTributariaIssqn = extract(outrasBlock, [
    /[Ss]itua[çc][ãa]o\s+[Tt]ributária\s+do\s+ISSQN[:\s]+([^\n]+)/i,
    /[Ee]xigibilidade\s+(?:do\s+)?ISS[:\s]+([^\n]+)/i,
    /(Reten[çc][ãa]o|Exig[íi]vel|Isento|Imune)/i,
  ])?.trim();

  result.localPrestacao = extract(outrasBlock, [
    /[Ll]ocal\s+da\s+presta[çc][ãa]o\s+do\s+servi[çc]o[:\s]+([^\n]+)/i,
    /[Ll]ocal\s+da\s+[Pp]resta[çc][ãa]o[:\s]+([^\n]+)/i,
  ])?.trim();

  result.situacaoNfse = extract(outrasBlock, [
    /[Ss]itua[çc][ãa]o\s+desta\s+NFS?-?e[:\s]+([^\n.]+)/i,
    /[Ss]itua[çc][ãa]o\s+da\s+NFS?-?e[:\s]+([^\n]+)/i,
    /(Retida|Normal|Cancelada)/i,
  ])?.trim();

  result.regimeTributario = extract(outrasBlock, [
    /[Rr]egime\s+(?:Especial\s+de\s+)?[Tt]ributa[çc][ãa]o[:\s]+([^\n]+)/i,
    /(Simples\s+Nacional|Lucro\s+Real|Lucro\s+Presumido)/i,
  ])?.trim();

  result.simplesNacional = /[Ss]imples\s+[Nn]acional/i.test(text);

  result.observacoesFiscais = extract(outrasBlock, [
    /[Oo]bserva[çc][õo]es\s+[Ff]iscais[:\s]+([^\n]+)/i,
  ])?.trim();

  result.observacoesAutenticidade = extract(text, [
    /[Oo]bserva[çc][õo]es\s+de\s+[Aa]utenticidade[:\s]+([^\n]+)/i,
  ])?.trim();

  result.indicacaoRetencao = extract(text, [
    /[Ii]ndica[çc][ãa]o\s+de\s+[Rr]eten[çc][ãa]o[:\s]+([^\n]+)/i,
    /[Rr]espons[áa]vel\s+pelo\s+[Rr]ecolhimento[:\s]+([^\n]+)/i,
  ])?.trim();

  // ─── Nome organizador sugerido ────────────────────────────────────────────────
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

  // ─── Validação de consistência ────────────────────────────────────────────────
  if (result.valorBruto && result.valorLiquido && result.valorIss != null) {
    const totalRet =
      (result.valorIss     ?? 0)
      + (result.ir         ?? 0)
      + (result.pisPasep   ?? 0)
      + (result.cofins     ?? 0)
      + (result.inss       ?? 0)
      + (result.csll       ?? 0)
      + (result.outrasRetencoes ?? 0);
    const expected = result.valorBruto - totalRet;
    if (Math.abs(expected - result.valorLiquido) > 1) {
      issues.push(
        `Valor líquido: esperado R$ ${expected.toFixed(2)}, PDF contém R$ ${result.valorLiquido.toFixed(2)}`
      );
    }
  }

  if (result.baseCalculo && result.aliquota && result.valorIss) {
    const calcIss = (result.baseCalculo * result.aliquota) / 100;
    if (Math.abs(calcIss - result.valorIss) > 0.1) {
      issues.push(
        `ISS calculado: R$ ${calcIss.toFixed(2)}, PDF contém: R$ ${result.valorIss.toFixed(2)}`
      );
    }
  }

  // ─── Campos ausentes ──────────────────────────────────────────────────────────
  const req: Array<[keyof PdfExtractResult, string]> = [
    ['numeroNf',    'Número da NF'],
    ['dataEmissao', 'Data de Emissão'],
    ['valorBruto',  'Valor Bruto'],
    ['valorLiquido','Valor Líquido'],
  ];
  result.camposNaoEncontrados = req
    .filter(([k]) => result[k] == null)
    .map(([, l]) => l);

  // ─── Campos de baixa confiança ────────────────────────────────────────────────
  if (!result.codigoVerificacao) lowConf.push('Código de Verificação');
  if (!result.tomador?.cpfCnpj)   lowConf.push('CNPJ do Tomador');
  if (!result.prestador?.cpfCnpj) lowConf.push('CNPJ do Prestador');
  if (!result.of)                  lowConf.push('Número OF');

  result.camposBaixaConfianca = lowConf;
  result.inconsistencias      = issues;
  result.fontesExtracao       = ['pdf-text'];

  // ─── Resumo legível ───────────────────────────────────────────────────────────
  const ps: string[] = [];
  if (result.numeroNf)   ps.push(`NF ${result.numeroNf}`);
  if (tNome)             ps.push(tNome);
  if (result.valorBruto) ps.push(`R$ ${result.valorBruto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
  if (result.dataEmissao) {
    try { ps.push(new Date(result.dataEmissao + 'T12:00:00').toLocaleDateString('pt-BR')); } catch { /**/ }
  }
  result.resumo = ps.join(' | ');

  return result;
}
