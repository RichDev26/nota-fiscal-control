import type { PdfExtractResult } from '@/types';

function extract(text: string, patterns: RegExp[]): string | undefined {
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return undefined;
}

function extractFloat(text: string, patterns: RegExp[]): number | undefined {
  const raw = extract(text, patterns);
  if (!raw) return undefined;
  const cleaned = raw.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? undefined : n;
}

function extractDate(text: string, patterns: RegExp[]): string | undefined {
  const raw = extract(text, patterns);
  if (!raw) return undefined;
  const m = raw.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return raw;
}

export async function extractFromPdfBuffer(buffer: Buffer): Promise<PdfExtractResult> {
  // Dynamically import pdf-parse only server-side
  const pdfParse = (await import('pdf-parse')).default;
  const data = await pdfParse(buffer);
  const text = data.text;

  const result: PdfExtractResult = {};
  const missing: string[] = [];

  // --- Identificação da nota ---
  result.numeroNf = extract(text, [
    /Número\s+da\s+NFS?-?e[:\s]+([0-9]+)/i,
    /N[uú]mero\s+da\s+Nota[:\s]+([0-9]+)/i,
    /NFS-e\s+N[oº][:\s]*([0-9]+)/i,
    /Nota\s+Fiscal\s+N[oº]?[:\s]*([0-9]+)/i,
  ]);

  result.numeroRps = extract(text, [
    /Número\s+do\s+RPS[:\s]+([0-9]+)/i,
    /RPS\s+N[oº][:\s]*([0-9]+)/i,
    /N[uú]mero\s+RPS[:\s]+([0-9]+)/i,
  ]);

  result.codigoVerificacao = extract(text, [
    /C[oó]digo\s+de\s+Verifica[cç][aã]o[:\s]+([A-Z0-9\-]+)/i,
    /Verifica[cç][aã]o[:\s]+([A-Z0-9\-]+)/i,
    /C[oó]d\.?\s*Verif[:\s]+([A-Z0-9\-]+)/i,
  ]);

  result.dataEmissao = extractDate(text, [
    /Data\s+(?:e\s+Hora\s+)?de\s+Emiss[aã]o[:\s]+(\d{2}\/\d{2}\/\d{4})/i,
    /Emiss[aã]o[:\s]+(\d{2}\/\d{2}\/\d{4})/i,
    /Data\s+Emiss[aã]o[:\s]+(\d{2}\/\d{2}\/\d{4})/i,
  ]);

  result.dataFatoGerador = extractDate(text, [
    /Data\s+do\s+Fato\s+Gerador[:\s]+(\d{2}\/\d{2}\/\d{4})/i,
    /Fato\s+Gerador[:\s]+(\d{2}\/\d{2}\/\d{4})/i,
    /Compet[eê]ncia[:\s]+(\d{2}\/\d{2}\/\d{4})/i,
  ]);

  result.municipioEmissor = extract(text, [
    /Munic[ií]pio\s+Emissor[:\s]+([^\n]+)/i,
    /Prefeitura\s+(?:Municipal\s+)?de\s+([^\n]+)/i,
    /SECRET[A-Z]+\s+DA\s+FAZENDA[^-\n]*[-—]\s*([^\n]+)/i,
  ]);

  result.tipo = extract(text, [
    /Tipo\s+da\s+Nota[:\s]+([^\n]+)/i,
    /Tipo[:\s]+(NFS-e|NFe|NF-e|Nota Fiscal[^\n]*)/i,
  ]) || 'NFS-e';

  // --- Prestador ---
  const prestadorStart = text.search(/PRESTADOR\s+DE\s+SERVI[CÇ]OS/i);
  const tomadorStart = text.search(/TOMADOR\s+DE\s+SERVI[CÇ]OS/i);
  const prestadorBlock = prestadorStart >= 0
    ? text.slice(prestadorStart, tomadorStart > prestadorStart ? tomadorStart : prestadorStart + 800)
    : text.slice(0, 800);

  const tomadorEnd = text.search(/DISCRIMINA[CÇ][AÃ]O\s+DOS\s+SERVI[CÇ]OS|DADOS\s+DO\s+SERVI[CÇO]/i);
  const tomadorBlock = tomadorStart >= 0
    ? text.slice(tomadorStart, tomadorEnd > tomadorStart ? tomadorEnd : tomadorStart + 800)
    : '';

  result.prestador = {
    nomeRazaoSocial: extract(prestadorBlock, [
      /Raz[aã]o\s+Social[:\s]+([^\n]+)/i,
      /Nome\s*\/?\s*Raz[aã]o\s+Social[:\s]+([^\n]+)/i,
      /Nome[:\s]+([^\n]{5,})/i,
    ]),
    nomeFantasia: extract(prestadorBlock, [/Nome\s+Fantasia[:\s]+([^\n]+)/i]),
    cpfCnpj: extract(prestadorBlock, [
      /CNPJ[:\s]+([\d.\-\/]+)/i,
      /CPF\s*\/?\s*CNPJ[:\s]+([\d.\-\/]+)/i,
      /CPF[:\s]+([\d.\-]+)/i,
    ]),
    inscricaoMunicipal: extract(prestadorBlock, [
      /Inscri[cç][aã]o\s+Municipal[:\s]+([^\n]+)/i,
      /IM[:\s]+([0-9.\-]+)/i,
    ]),
    inscricaoEstadual: extract(prestadorBlock, [/Inscri[cç][aã]o\s+Estadual[:\s]+([^\n]+)/i]),
    email: extract(prestadorBlock, [/E-?mail[:\s]+([a-zA-Z0-9._%+\-]+@[^\s]+)/i]),
    telefone: extract(prestadorBlock, [/Telefone[:\s]+([\(\d\s\)\-]+)/i]),
    endereco: extract(prestadorBlock, [
      /Logradouro[:\s]+([^\n]+)/i,
      /Endere[cç]o[:\s]+([^\n]+)/i,
    ]),
    bairro: extract(prestadorBlock, [/Bairro[:\s]+([^\n]+)/i]),
    municipio: extract(prestadorBlock, [/Munic[ií]pio[:\s]+([^\n]+)/i]),
    uf: extract(prestadorBlock, [/\bUF[:\s]+([A-Z]{2})\b/i, /Estado[:\s]+([A-Z]{2})\b/i]),
    cep: extract(prestadorBlock, [/CEP[:\s]+([\d.\-]+)/i]),
  };

  result.tomador = {
    nomeRazaoSocial: extract(tomadorBlock, [
      /Raz[aã]o\s+Social[:\s]+([^\n]+)/i,
      /Nome\s*\/?\s*Raz[aã]o\s+Social[:\s]+([^\n]+)/i,
      /Nome[:\s]+([^\n]{5,})/i,
    ]),
    nomeFantasia: extract(tomadorBlock, [/Nome\s+Fantasia[:\s]+([^\n]+)/i]),
    cpfCnpj: extract(tomadorBlock, [
      /CNPJ[:\s]+([\d.\-\/]+)/i,
      /CPF\s*\/?\s*CNPJ[:\s]+([\d.\-\/]+)/i,
      /CPF[:\s]+([\d.\-]+)/i,
    ]),
    inscricaoMunicipal: extract(tomadorBlock, [/Inscri[cç][aã]o\s+Municipal[:\s]+([^\n]+)/i]),
    inscricaoEstadual: extract(tomadorBlock, [/Inscri[cç][aã]o\s+Estadual[:\s]+([^\n]+)/i]),
    email: extract(tomadorBlock, [/E-?mail[:\s]+([a-zA-Z0-9._%+\-]+@[^\s]+)/i]),
    telefone: extract(tomadorBlock, [/Telefone[:\s]+([\(\d\s\)\-]+)/i]),
    endereco: extract(tomadorBlock, [
      /Logradouro[:\s]+([^\n]+)/i,
      /Endere[cç]o[:\s]+([^\n]+)/i,
    ]),
    bairro: extract(tomadorBlock, [/Bairro[:\s]+([^\n]+)/i]),
    municipio: extract(tomadorBlock, [/Munic[ií]pio[:\s]+([^\n]+)/i]),
    uf: extract(tomadorBlock, [/\bUF[:\s]+([A-Z]{2})\b/i]),
    cep: extract(tomadorBlock, [/CEP[:\s]+([\d.\-]+)/i]),
  };

  // --- Serviço ---
  result.descricao = extract(text, [
    /Discrimina[cç][aã]o\s+dos\s+Servi[cç]os[:\s\n]+([^\n]{10,}(?:\n[^\n]{5,}){0,3})/i,
    /Descri[cç][aã]o\s+do\s+Servi[cç]o[:\s]+([^\n]+)/i,
    /SERVI[CÇ]O[:\s]+([^\n]+)/i,
  ]);

  result.codigoServico = extract(text, [
    /C[oó]digo\s+do\s+Servi[cç]o[:\s]+([^\n]+)/i,
    /CNAE[:\s]+([^\n]+)/i,
    /C[oó]d\.?\s*Serv[:\s]+([^\n]+)/i,
  ]);

  result.of = extract(text, [
    /\bOF[:\s]+([A-Z0-9\-]+)/i,
    /Ordem\s+de\s+Fornecimento[:\s]+([^\n]+)/i,
  ]);

  result.quantidade = extractFloat(text, [
    /Quantidade[:\s]+([\d.,]+)/i,
    /Qtd?[\.:\s]+([\d.,]+)/i,
  ]);

  result.valorUnitario = extractFloat(text, [
    /Valor\s+Unit[aá]rio[:\s]+R?\$?\s*([\d.,]+)/i,
    /Pre[cç]o\s+Unit[aá]rio[:\s]+R?\$?\s*([\d.,]+)/i,
  ]);

  // --- Valores ---
  result.valorBruto = extractFloat(text, [
    /Valor\s+(?:Total\s+)?(?:dos\s+Servi[cç]os|Bruto)[:\s]+R?\$?\s*([\d.,]+)/i,
    /Valor\s+Total[:\s]+R?\$?\s*([\d.,]+)/i,
    /TOTAL\s+DOS\s+SERVI[CÇ]OS[:\s]+R?\$?\s*([\d.,]+)/i,
  ]);

  result.valorLiquido = extractFloat(text, [
    /Valor\s+L[ií]quido\s+da\s+NFS?-?e[:\s]+R?\$?\s*([\d.,]+)/i,
    /Valor\s+L[ií]quido[:\s]+R?\$?\s*([\d.,]+)/i,
  ]);

  result.baseCalculo = extractFloat(text, [
    /Base\s+de\s+C[aá]lculo[:\s]+R?\$?\s*([\d.,]+)/i,
    /BC\s+ISS[:\s]+R?\$?\s*([\d.,]+)/i,
  ]);

  result.aliquota = extractFloat(text, [
    /Al[ií]quota\s+(?:do\s+)?ISS[:\s]+([\d.,]+)\s*%?/i,
    /Al[ií]quota[:\s]+([\d.,]+)\s*%/i,
  ]);

  result.valorIss = extractFloat(text, [
    /Valor\s+(?:do\s+)?ISS[:\s]+R?\$?\s*([\d.,]+)/i,
    /ISS\s+a\s+recolher[:\s]+R?\$?\s*([\d.,]+)/i,
    /ISS[:\s]+R?\$?\s*([\d.,]+)/i,
  ]);

  // --- Retenções ---
  result.ir = extractFloat(text, [
    /IR\s+Retido[:\s]+R?\$?\s*([\d.,]+)/i,
    /Imposto\s+de\s+Renda[:\s]+R?\$?\s*([\d.,]+)/i,
    /\bIR\b[:\s]+R?\$?\s*([\d.,]+)/i,
  ]);

  result.pisPasep = extractFloat(text, [
    /PIS\s*\/?\s*PASEP[:\s]+R?\$?\s*([\d.,]+)/i,
    /\bPIS\b[:\s]+R?\$?\s*([\d.,]+)/i,
  ]);

  result.cofins = extractFloat(text, [
    /COFINS[:\s]+R?\$?\s*([\d.,]+)/i,
  ]);

  result.inss = extractFloat(text, [
    /INSS[:\s]+R?\$?\s*([\d.,]+)/i,
    /Previd[eê]ncia\s+Social[:\s]+R?\$?\s*([\d.,]+)/i,
  ]);

  result.csll = extractFloat(text, [
    /CSLL[:\s]+R?\$?\s*([\d.,]+)/i,
  ]);

  result.outrasRetencoes = extractFloat(text, [
    /Outras\s+Reten[cç][oõ]es[:\s]+R?\$?\s*([\d.,]+)/i,
  ]);

  result.valorAproximadoTributos = extractFloat(text, [
    /Valor\s+Aproximado\s+(?:dos\s+)?Tributos[:\s]+R?\$?\s*([\d.,]+)/i,
    /Tributos\s+Aproximados[:\s]+R?\$?\s*([\d.,]+)/i,
  ]);

  // --- Fiscal ---
  result.naturezaOperacao = extract(text, [
    /Natureza\s+da\s+Opera[cç][aã]o[:\s]+([^\n]+)/i,
  ]);

  result.situacaoTributariaIssqn = extract(text, [
    /Situa[cç][aã]o\s+Tribut[aá]ria\s+(?:do\s+)?ISSQN[:\s]+([^\n]+)/i,
    /Exigibilidade\s+(?:do\s+)?ISS[:\s]+([^\n]+)/i,
  ]);

  result.localPrestacao = extract(text, [
    /Local\s+da\s+Presta[cç][aã]o[:\s]+([^\n]+)/i,
    /Local\s+da\s+Obra[:\s]+([^\n]+)/i,
  ]);

  result.situacaoNfse = extract(text, [
    /Situa[cç][aã]o\s+da\s+NFS?-?e[:\s]+([^\n]+)/i,
    /Situa[cç][aã]o[:\s]+([^\n]+)/i,
  ]);

  result.regimeTributario = extract(text, [
    /Regime\s+(?:Especial\s+de\s+)?Tributa[cç][aã]o[:\s]+([^\n]+)/i,
    /Regime\s+Tribut[aá]rio[:\s]+([^\n]+)/i,
  ]);

  result.indicacaoRetencao = extract(text, [
    /Indica[cç][aã]o\s+de\s+Reten[cç][aã]o[:\s]+([^\n]+)/i,
    /Respons[aá]vel\s+pelo\s+Recolhimento[:\s]+([^\n]+)/i,
  ]);

  result.observacoesFiscais = extract(text, [
    /Observa[cç][oõ]es\s+Fiscais[:\s]+([^\n]+)/i,
    /Mensagem\s+Fiscal[:\s]+([^\n]+)/i,
  ]);

  result.observacoesAutenticidade = extract(text, [
    /Observa[cç][oõ]es\s+de\s+Autenticidade[:\s]+([^\n]+)/i,
    /Autentica[cç][aã]o[:\s]+([^\n]+)/i,
  ]);

  // Verificar campos não encontrados
  const requiredFields: Array<[keyof PdfExtractResult, string]> = [
    ['numeroNf', 'Número da NF'],
    ['dataEmissao', 'Data de Emissão'],
    ['valorBruto', 'Valor Bruto'],
    ['valorLiquido', 'Valor Líquido'],
  ];

  for (const [field, label] of requiredFields) {
    if (!result[field]) missing.push(label);
  }

  result.camposNaoEncontrados = missing;

  // Sugerir nome organizador baseado no tomador ou número
  if (!result.nomeOrganizador) {
    const tomadorNome = result.tomador?.nomeRazaoSocial || result.tomador?.nomeFantasia;
    if (tomadorNome && result.numeroNf) {
      result.nomeOrganizador = `NF ${result.numeroNf} - ${tomadorNome.slice(0, 30)}`;
    }
  }

  return result;
}
