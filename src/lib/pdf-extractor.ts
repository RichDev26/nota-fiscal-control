import type { PdfExtractResult } from '@/types';

// ─── Core helpers ─────────────────────────────────────────────────────────────

function extract(text: string, patterns: RegExp[]): string | undefined {
  for (const p of patterns) {
    const m = text.match(p);
    const val = m?.[1]?.trim();
    if (val) return val;
  }
  return undefined;
}

function extractFloat(text: string, patterns: RegExp[]): number | undefined {
  const raw = extract(text, patterns);
  if (!raw) return undefined;
  // Brazilian format: 50.000,00 → 50000.00
  const cleaned = raw.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? undefined : n;
}

function extractDate(text: string, patterns: RegExp[]): string | undefined {
  const raw = extract(text, patterns);
  if (!raw) return undefined;
  const m = raw.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return undefined;
}

// ─── Main extractor ───────────────────────────────────────────────────────────

export async function extractFromPdfBuffer(buffer: Buffer): Promise<PdfExtractResult> {
  const pdfParse = (await import('pdf-parse')).default;
  const data = await pdfParse(buffer);
  const text = data.text;

  const result: PdfExtractResult = {};
  const missing: string[] = [];

  // ── Número da NF ──────────────────────────────────────────────────────────
  result.numeroNf = extract(text, [
    // "NFS-e Nº 187" / "NFS-e N° 187" / "NFS-e N 187"
    /NFS?-?e\s+N[º°o]?\s*\.?\s*(\d+)/i,
    // "Nota Fiscal de Serviços Eletrônica Nº 187"
    /Nota\s+Fiscal[^#\n]{0,40}N[º°]\s*(\d+)/i,
    // "Número da NFS-e: 187"
    /N[uú]mero\s+da\s+NFS?-?e[:\s]+(\d+)/i,
    // "Nº 187" standalone (common at top of document)
    /^[^\n]*N[º°]\s+(\d+)\s/im,
    // "NF Nº 187"
    /\bNF\s+N[º°]?\s*:?\s*(\d+)/i,
  ]);

  // ── Número RPS ────────────────────────────────────────────────────────────
  result.numeroRps = extract(text, [
    /N[uú]mero\s+do\s+RPS[:\s]+(\d+)/i,
    /RPS\s+N[º°][:\s]*(\d+)/i,
    /N[uú]mero\s+RPS[:\s]+(\d+)/i,
    /\bRPS\b[:\s]+(\d+)/i,
  ]);

  // ── Código de Verificação ─────────────────────────────────────────────────
  result.codigoVerificacao = extract(text, [
    /C[oó]digo\s+de\s+Verifica[çc][ãa]o[:\s]+([A-Z0-9]{6,20})/i,
    /Verifica[çc][ãa]o[:\s]+([A-Z0-9]{6,20})\b/i,
    // Standalone alphanumeric codes like "FHZSBPES7" (2+ uppercase + digits)
    /\b([A-Z]{3,}[0-9]+[A-Z0-9]{0,10})\b/,
  ]);

  // ── Datas ─────────────────────────────────────────────────────────────────
  result.dataEmissao = extractDate(text, [
    // "Data e Hora de Emissão: 19/05/2026 12:01:05"
    /Data\s+(?:e\s+Hora\s+)?de\s+Emiss[ãa]o[:\s]+(\d{2}\/\d{2}\/\d{4})/i,
    /Emiss[ãa]o[:\s]+(\d{2}\/\d{2}\/\d{4})/i,
    /Data\s+Emiss[ãa]o[:\s]+(\d{2}\/\d{2}\/\d{4})/i,
  ]);

  result.dataFatoGerador = extractDate(text, [
    /Fato\s+Gerador[:\s]+(\d{2}\/\d{2}\/\d{4})/i,
    /Data\s+do\s+Fato\s+Gerador[:\s]+(\d{2}\/\d{2}\/\d{4})/i,
    /Compet[eê]ncia[:\s]+(\d{2}\/\d{2}\/\d{4})/i,
  ]);

  // ── Município ─────────────────────────────────────────────────────────────
  result.municipioEmissor = extract(text, [
    /Munic[ií]pio\s+(?:do\s+Prestador|Emissor)[:\s]+([^\n]+)/i,
    // "Dourados/MS" pattern
    /([A-Za-zÀ-ú\s]+\/[A-Z]{2})\s*[-–]/i,
    /Prefeitura\s+(?:Municipal\s+)?de\s+([^\n,]+)/i,
    /SECRET[A-Z\s]+FAZENDA[^–\-\n]*[-–]\s*([^\n]+)/i,
  ]);

  result.tipo = extract(text, [
    /(NFS?-?e|NF-?e|Nota\s+Fiscal\s+de\s+Servi[çc]os)/i,
  ]) || 'NFS-e';

  // ── OF (Ordem de Fornecimento) ─────────────────────────────────────────────
  result.of = extract(text, [
    /\bOF\s*:?\s*(\d+)/i,
    /Ordem\s+de\s+(?:Fornecimento|Servi[çc]o)\s*:?\s*(\d+)/i,
    // "OF 6866682" — OF seguido de número longo
    /\bOF\b[^\n\d]*(\d{6,})/i,
  ]);

  // ── Código do Serviço ─────────────────────────────────────────────────────
  result.codigoServico = extract(text, [
    /C[oó]digo\s+do\s+Servi[çc]o\s*:?\s*([\d]{1,2}\.[\d]{2}[\d\.]*)/i,
    /Item\s+da\s+Lista[^:\n]{0,30}:?\s*([\d]+\.[\d]+)/i,
    // Standalone "14.01" style code
    /\b(\d{2}\.\d{2})\b/,
  ]);

  // ── Blocos de Prestador e Tomador ─────────────────────────────────────────
  const pStart = text.search(/PRESTADOR\s+DE\s+SERVI[ÇC]OS/i);
  const tStart = text.search(/TOMADOR\s+DE\s+SERVI[ÇC]OS/i);
  const descStart = text.search(/DISCRIMINA[ÇC][AÃ]O\s+DOS\s+SERVI[ÇC]OS|DADOS\s+DO\s+SERVI[ÇC]O/i);

  const prestadorBlock = pStart >= 0
    ? text.slice(pStart, tStart > pStart ? tStart : pStart + 1000)
    : text.slice(0, 1000);

  const tomadorBlock = tStart >= 0
    ? text.slice(tStart, descStart > tStart ? descStart : tStart + 1000)
    : '';

  const parsePessoa = (block: string) => ({
    nomeRazaoSocial: extract(block, [
      /Raz[ãa]o\s+Social[:\s]+([^\n]+)/i,
      /Nome\s*[\/]?\s*Raz[ãa]o\s+Social[:\s]+([^\n]+)/i,
      /Nome\s+do\s+(?:Contribuinte|Empresa|Tomador)[:\s]+([^\n]+)/i,
    ]),
    nomeFantasia: extract(block, [/Nome\s+Fantasia[:\s]+([^\n]+)/i]),
    cpfCnpj: extract(block, [
      /CNPJ[:\s]+([\d.\-\/]+)/i,
      /CPF[\/\s]*CNPJ[:\s]+([\d.\-\/]+)/i,
      /CPF[:\s]+([\d.\-]+)/i,
    ]),
    inscricaoMunicipal: extract(block, [
      /Inscri[çc][ãa]o\s+Municipal[:\s]+([\d.\-]+)/i,
      /\bIM\b[:\s]+([\d.\-]+)/i,
    ]),
    inscricaoEstadual: extract(block, [
      /Inscri[çc][ãa]o\s+Estadual[:\s]+([^\n]+)/i,
    ]),
    email: extract(block, [/E-?mail[:\s]+([a-zA-Z0-9._%+\-]+@[^\s,]+)/i]),
    telefone: extract(block, [/Telefone[:\s]+([\(\d\s\)\-]+)/i]),
    celular: extract(block, [/Celular[:\s]+([\(\d\s\)\-]+)/i]),
    endereco: extract(block, [
      /Logradouro[:\s]+([^\n]+)/i,
      /Endere[çc]o[:\s]+([^\n]+)/i,
    ]),
    numero: extract(block, [/N[uú]mero[:\s]+([^\n,]+)/i]),
    complemento: extract(block, [/Complemento[:\s]+([^\n]+)/i]),
    bairro: extract(block, [/Bairro[:\s]+([^\n]+)/i]),
    municipio: extract(block, [/Munic[ií]pio[:\s]+([^\n]+)/i]),
    uf: extract(block, [/\bUF[:\s]+([A-Z]{2})\b/i, /Estado[:\s]+([A-Z]{2})\b/i]),
    cep: extract(block, [/CEP[:\s]+([\d.\-]+)/i]),
    site: extract(block, [/Site[:\s]+([^\s]+)/i]),
  });

  result.prestador = parsePessoa(prestadorBlock);
  result.tomador = parsePessoa(tomadorBlock);

  // ── Descrição do Serviço ──────────────────────────────────────────────────
  result.descricao = extract(text, [
    /Discrimina[çc][ãa]o\s+dos\s+Servi[çc]os[:\s\n]+([^\n]{10,}(?:\n(?![A-Z]{3})[^\n]{0,}){0,4})/i,
    /Descri[çc][ãa]o\s+do\s+Servi[çc]o[:\s]+([^\n]+)/i,
    /Servi[çc]o[:\s]+([^\n]{15,})/i,
  ])?.replace(/\s+/g, ' ').trim();

  // ── Valores ───────────────────────────────────────────────────────────────
  // Brazilian currency: "50.000,00" or "R$ 50.000,00"
  const reaisPat = 'R?\\$?\\s*([\\d.]+,[\\d]{2})';

  result.valorBruto = extractFloat(text, [
    new RegExp(`Valor\\s+(?:Total\\s+)?(?:dos\\s+Servi[çc]os|Bruto)[:\\s]+${reaisPat}`, 'i'),
    new RegExp(`Valor\\s+do\\s+Servi[çc]o[:\\s]+${reaisPat}`, 'i'),
    new RegExp(`TOTAL\\s+DOS\\s+SERVI[ÇC]OS[:\\s]+${reaisPat}`, 'i'),
    new RegExp(`Valor\\s+Total[:\\s]+${reaisPat}`, 'i'),
  ]);

  result.valorLiquido = extractFloat(text, [
    new RegExp(`Valor\\s+L[íi]quido\\s+da\\s+NFS?-?e[:\\s]+${reaisPat}`, 'i'),
    new RegExp(`Valor\\s+L[íi]quido[:\\s]+${reaisPat}`, 'i'),
  ]);

  result.baseCalculo = extractFloat(text, [
    new RegExp(`Base\\s+de\\s+C[áa]lculo[:\\s]+${reaisPat}`, 'i'),
    new RegExp(`BC\\s+ISS[:\\s]+${reaisPat}`, 'i'),
  ]);

  // Alíquota: "5,00%" or "5.00%"
  result.aliquota = extractFloat(text, [
    /Al[íi]quota\s+(?:do\s+)?ISS[:\s]+([\d,\.]+)\s*%/i,
    /Al[íi]quota[:\s]+([\d,\.]+)\s*%/i,
  ]);

  result.valorIss = extractFloat(text, [
    new RegExp(`Valor\\s+(?:do\\s+)?ISS[:\\s]+${reaisPat}`, 'i'),
    new RegExp(`ISS\\s+a\\s+(?:recolher|reter)[:\\s]+${reaisPat}`, 'i'),
    new RegExp(`\\bISS\\b[:\\s]+${reaisPat}`, 'i'),
  ]);

  // ── Retenções federais ────────────────────────────────────────────────────
  const retPat = (label: string) =>
    new RegExp(`${label}[:\\s]+${reaisPat}`, 'i');

  result.ir = extractFloat(text, [
    retPat('IR\\s+Retido'),
    retPat('Imposto\\s+de\\s+Renda'),
    retPat('\\bIR\\b'),
  ]);
  result.pisPasep = extractFloat(text, [
    retPat('PIS\\s*\\/\\s*PASEP'),
    retPat('\\bPIS\\b'),
  ]);
  result.cofins = extractFloat(text, [retPat('COFINS')]);
  result.inss = extractFloat(text, [
    retPat('INSS'),
    retPat('Previd[eê]ncia\\s+Social'),
  ]);
  result.csll = extractFloat(text, [retPat('CSLL')]);
  result.outrasRetencoes = extractFloat(text, [retPat('Outras\\s+Reten[çc][õo]es')]);

  result.valorAproximadoTributos = extractFloat(text, [
    new RegExp(`Valor\\s+Aprox\\.?\\s+(?:dos\\s+)?Tributos(?:\\s+Federal(?:ais)?)?[:\\s]+${reaisPat}`, 'i'),
    new RegExp(`Tributos\\s+Federais[:\\s]+${reaisPat}`, 'i'),
    // "R$ 6.725,00 (13,45%)" — primeiro valor monetário próximo a "federal"
    /[Ff]ederal[^\n]{0,30}R?\$?\s*([\d.]+,\d{2})/i,
  ]);

  // ── Situação fiscal ───────────────────────────────────────────────────────
  result.naturezaOperacao = extract(text, [
    /Natureza\s+da\s+Opera[çc][ãa]o[:\s]+([^\n]+)/i,
    // "Operação Tributável" directly
    /(Opera[çc][ãa]o\s+Tribut[áa]vel|Opera[çc][ãa]o\s+Isenta|Opera[çc][ãa]o\s+Imune)/i,
  ]);

  result.situacaoTributariaIssqn = extract(text, [
    /Situa[çc][ãa]o\s+Tribut[áa]ria\s+(?:do\s+)?ISSQN[:\s]+([^\n]+)/i,
    /Exigibilidade\s+(?:do\s+)?ISS[:\s]+([^\n]+)/i,
    // "Retenção" as standalone value
    /(Reten[çc][ãa]o|Exig[íi]vel|Isento|Imune|Exporta[çc][ãa]o)/i,
  ]);

  result.localPrestacao = extract(text, [
    /Local\s+da\s+Presta[çc][ãa]o[:\s]+([^\n]+)/i,
    /Local\s+da\s+Obra[:\s]+([^\n]+)/i,
  ]);

  result.situacaoNfse = extract(text, [
    /Situa[çc][ãa]o\s+da\s+NFS?-?e[:\s]+([^\n]+)/i,
    // "Retida" / "Normal" / "Cancelada"
    /(Retida|Normal|Cancelada)/i,
  ]);

  result.regimeTributario = extract(text, [
    /Regime\s+(?:Especial\s+de\s+)?Tributa[çc][ãa]o[:\s]+([^\n]+)/i,
    /Regime\s+Tribut[áa]rio[:\s]+([^\n]+)/i,
  ]);

  result.indicacaoRetencao = extract(text, [
    /Indica[çc][ãa]o\s+de\s+Reten[çc][ãa]o[:\s]+([^\n]+)/i,
    /Respons[áa]vel\s+pelo\s+Recolhimento[:\s]+([^\n]+)/i,
  ]);

  result.observacoesFiscais = extract(text, [
    /Observa[çc][õo]es\s+Fiscais[:\s]+([^\n]+)/i,
    /Mensagem\s+Fiscal[:\s]+([^\n]+)/i,
  ]);

  result.observacoesAutenticidade = extract(text, [
    /Observa[çc][õo]es\s+de\s+Autenticidade[:\s]+([^\n]+)/i,
  ]);

  // ── Quantidade e Valor Unitário ───────────────────────────────────────────
  result.quantidade = extractFloat(text, [
    /Quantidade[:\s]+([\d.,]+)/i,
    /Qtd?\.?[:\s]+([\d.,]+)/i,
  ]);

  result.valorUnitario = extractFloat(text, [
    new RegExp(`Valor\\s+Unit[áa]rio[:\\s]+${reaisPat}`, 'i'),
    new RegExp(`Pre[çc]o\\s+Unit[áa]rio[:\\s]+${reaisPat}`, 'i'),
  ]);

  // ── Nome organizador sugerido ─────────────────────────────────────────────
  const tomadorNome = result.tomador?.nomeRazaoSocial || result.tomador?.nomeFantasia;
  if (result.numeroNf && tomadorNome) {
    result.nomeOrganizador = `NF ${result.numeroNf} – ${tomadorNome.slice(0, 35)}`;
  } else if (result.numeroNf) {
    result.nomeOrganizador = `NF ${result.numeroNf}`;
  }

  // ── Campos não encontrados ────────────────────────────────────────────────
  const required: Array<[keyof PdfExtractResult, string]> = [
    ['numeroNf', 'Número da NF'],
    ['dataEmissao', 'Data de Emissão'],
    ['valorBruto', 'Valor Bruto'],
    ['valorLiquido', 'Valor Líquido'],
  ];
  result.camposNaoEncontrados = required
    .filter(([k]) => !result[k])
    .map(([, label]) => label);

  return result;
}
