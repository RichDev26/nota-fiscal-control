/**
 * Extrator DANFSe Nacional v1.0 (Portal Nacional NFS-e)
 *
 * Layout completamente diferente da NFS-e municipal: cabeçalho com chave de
 * acesso de 50 dígitos, campos DPS, seções emitente/tomador com labels distintos,
 * tributação municipal e federal separadas, etc.
 *
 * Chamado pelo extrator-router.ts quando detectarLayoutNfse() retorna 'DANFSE_NACIONAL'.
 * As validações pós-extração (cancelada, CNPJ, Simples, fatoGerador) são aplicadas
 * no router — o mesmo conjunto usado pelo pipeline municipal.
 */
import type { PdfExtractResult } from '@/types';
import { parseNumeroBR } from '@/lib/validators';
import { stripAccents } from './ocr-normalizer';

// ─── HELPERS INTERNOS ─────────────────────────────────────────────────────────

/** Valor na linha imediatamente após o label. Retorna null para '-' (placeholders). */
function nextVal(text: string, labelRe: RegExp): string | null {
  const re = new RegExp(labelRe.source + '[^\\n]*\\n([^\\n]+)', 'i');
  const m  = text.match(re);
  const v  = m?.[1]?.trim();
  return (!v || v === '-') ? null : v;
}

/** Primeiro valor monetário (R$ NNN,NN) na linha após o label. */
function nextMoney(text: string, labelRe: RegExp): number | null {
  const line = nextVal(text, labelRe);
  if (!line) return null;
  const m = line.match(/R\$\s*([\d.]+,\d{2})/);
  return m ? parseNumeroBR('R$ ' + m[1]) : parseNumeroBR(line);
}

/** Fatia do texto entre dois padrões (primeira ocorrência de cada). */
function section(text: string, from: RegExp, to: RegExp): string {
  const start = text.search(from);
  if (start === -1) return '';
  const sub = text.slice(start);
  const end = sub.search(to);
  return end === -1 ? sub : sub.slice(0, end);
}

/** "Cidade - UF" ou "Cidade - UF CEP" → { municipio, uf }. */
function parseMuniUf(raw: string | null): { municipio?: string; uf?: string } {
  if (!raw) return {};
  const m = raw.match(/^(.+?)\s*[-–]\s*([A-Z]{2})\b/);
  return m ? { municipio: m[1].trim(), uf: m[2] } : { municipio: raw.trim() };
}

const RE_CNPJ = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/;
const RE_CPF  = /\d{3}\.\d{3}\.\d{3}-\d{2}/;

// ─── EXTRAÇÃO ─────────────────────────────────────────────────────────────────

export function extrairDanfseNacional(rawText: string): PdfExtractResult {
  // Ordem real do texto extraído pelo pdf-parse (difere da ordem visual do PDF):
  // EMITENTE → [chave+header] → TOMADOR → INTERMEDIÁRIO → NBS
  //   → TRIBUTAÇÃO FEDERAL → VALOR TOTAL (inclui TOTAIS e INFO COMPLEMENTARES)
  //   → TRIBUTAÇÃO MUNICIPAL → SERVIÇO PRESTADO

  const secEmitente = section(rawText, /EMITENTE\s+DA\s+NFS-?e/i, /TOMADOR\s+DO\s+SERVI[ÇC]O/i);
  const secTomador  = section(rawText, /TOMADOR\s+DO\s+SERVI[ÇC]O/i, /INTERMEDI[AÁ]RIO/i);
  const secTribFed  = section(rawText, /TRIBUTA[ÇC][AÃ]O\s+FEDERAL/i, /VALOR\s+TOTAL\s+DA\s+NFS-?e/i);
  // VALOR TOTAL estende-se através de TOTAIS e INFO COMPLEMENTARES até TRIBUTAÇÃO MUNICIPAL
  const secTotal    = section(rawText, /VALOR\s+TOTAL\s+DA\s+NFS-?e/i, /TRIBUTA[ÇC][AÃ]O\s+MUNICIPAL/i);
  const secTribMuni = section(rawText, /TRIBUTA[ÇC][AÃ]O\s+MUNICIPAL/i, /SERVI[ÇC]O\s+PRESTADO/i);
  const idxServico  = rawText.search(/SERVI[ÇC]O\s+PRESTADO/i);
  const secServico  = idxServico >= 0 ? rawText.slice(idxServico) : '';

  // ── Chave de Acesso (50 dígitos) ────────────────────────────────────────────
  const chaveAcessoNfse = rawText.match(/\b(\d{50})\b/)?.[1];

  // Bloco de header após a chave (números, datas)
  const posChave    = chaveAcessoNfse ? rawText.indexOf(chaveAcessoNfse) : -1;
  const headerBlock = posChave >= 0 ? rawText.slice(posChave, posChave + 600) : '';
  const headerLines = headerBlock.split('\n').map(l => l.trim()).filter(Boolean).slice(1);

  // Número da NFS-e: primeiro inteiro isolado (1-10 dígitos) após a chave
  const numeroNf = headerLines.find(l => /^\d{1,10}$/.test(l));

  // DPS: "194 1" (número e série na mesma linha)
  const dpsSerieLine = headerLines.find(l => /^\d{1,10}\s+\d{1,5}$/.test(l));
  const [numeroDps, serieDps] = dpsSerieLine ? dpsSerieLine.split(/\s+/) : [];

  // Competência: data-only antes de um datetime na mesma linha
  // ex: "10/07/2026 10/07/2026 14:47:16" → Competência = "10/07/2026"
  const competenciaNfse = headerBlock
    .match(/(\d{2}\/\d{2}\/\d{4})\s+\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}/)?.[1];

  const allDatetimes: string[] = [];
  const dtRe = /\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}/g;
  let dtM: RegExpExecArray | null;
  while ((dtM = dtRe.exec(headerBlock)) !== null) allDatetimes.push(dtM[0]);
  const dataEmissaoNfse = allDatetimes[0];
  const dataEmissaoDps  = allDatetimes[1] ?? allDatetimes[0];

  // ── Prestador (EMITENTE) ─────────────────────────────────────────────────────
  const prestadorCnpj   = secEmitente.match(RE_CNPJ)?.[0] ?? secEmitente.match(RE_CPF)?.[0];
  const prestadorNome   = nextVal(secEmitente, /Nome\s*\/\s*Nome\s+Empresarial/i);
  const prestadorEmail  = nextVal(secEmitente, /E-?mail/i);
  const prestadorFone   = nextVal(secEmitente, /Telefone/i);
  const prestadorInscMu = nextVal(secEmitente, /Inscri[çc][aã]o\s+Municipal/i);
  const prestadorEnder  = nextVal(secEmitente, /Endere[çc]o/i);
  const prestadorCep    = secEmitente.match(/(\d{5}-\d{3})/)?.[1];
  const { municipio: prestMuni, uf: prestUf } = parseMuniUf(
    nextVal(secEmitente, /Munic[íi]pio\b/i),
  );

  const simpNacRaw      = nextVal(secEmitente, /Simples\s+Nacional\s+na\s+Data\s+de\s+Compet[eê]ncia/i);
  const simplesNacional = simpNacRaw != null ? /optante/i.test(simpNacRaw) : undefined;
  const regimeApuracao  = nextVal(secEmitente, /Regime\s+de\s+Apura[çc][aã]o\s+Tribut[aá]ria/i) ?? undefined;

  // ── Tomador ──────────────────────────────────────────────────────────────────
  const tomadorCnpj   = secTomador.match(RE_CNPJ)?.[0] ?? secTomador.match(RE_CPF)?.[0];
  const tomadorNome   = nextVal(secTomador, /Nome\s*\/\s*Nome\s+Empresarial/i);
  const tomadorEmail  = nextVal(secTomador, /E-?mail/i);
  const tomadorFone   = nextVal(secTomador, /Telefone/i);
  const tomadorInscMu = nextVal(secTomador, /Inscri[çc][aã]o\s+Municipal/i);
  const tomadorEnder  = nextVal(secTomador, /Endere[çc]o/i);
  const tomadorCep    = secTomador.match(/(\d{5}-\d{3})/)?.[1];
  const { municipio: tomMuni, uf: tomUf } = parseMuniUf(
    nextVal(secTomador, /Munic[íi]pio\b/i),
  );

  // ── Tributação Federal ───────────────────────────────────────────────────────
  const ir     = nextMoney(secTribFed, /IRRF/i) ?? undefined;
  const inss   = nextMoney(secTribFed, /Contribui[çc][aã]o\s+Previdenci[aá]ria/i) ?? undefined;
  const pis    = nextMoney(secTribFed, /PIS\s*[-–]/i) ?? undefined;
  const cofins = nextMoney(secTribFed, /COFINS\s*[-–]/i) ?? undefined;

  // ── Tributação Municipal ─────────────────────────────────────────────────────
  const tributacaoIssqn             = nextVal(secTribMuni, /Tributa[çc][aã]o\s+do\s+ISSQN/i) ?? undefined;
  const tipoImunidade               = nextVal(secTribMuni, /Tipo\s+de\s+Imunidade/i) ?? undefined;
  const suspensaoExigibilidadeIssqn = nextVal(secTribMuni, /Suspens[aã]o\s+da\s+Exigibilidade\s+do\s+ISSQN/i) ?? undefined;
  const numeroProcessoSuspensao     = nextVal(secTribMuni, /N[uú]mero\s+Processo\s+Suspens[aã]o/i) ?? undefined;
  const beneficioMunicipal          = nextVal(secTribMuni, /Benef[íi]cio\s+Municipal/i) ?? undefined;
  const baseCalculo                 = nextMoney(secTribMuni, /BC\s+ISSQN/i) ?? undefined;

  const aliquotaStr = nextVal(secTribMuni, /Al[íi]quota\s+Aplicada/i);
  const aliquota    = aliquotaStr ? parseNumeroBR(aliquotaStr.replace('%', '')) ?? undefined : undefined;

  // Município de Incidência do ISSQN (label e valor podem estar na mesma linha composta)
  const municipioIncidenciaIssqn = secTribMuni
    .match(/Munic[íi]pio\s+de\s+Incid[eê]ncia\s+do\s+ISSQN[^\n]*\n([^\n]+)/i)?.[1]?.trim() ?? undefined;

  // País Resultado da Prestação
  const resultadoPrestacao = secTribMuni
    .match(/Pa[íi]s\s+Resultado[^\n]*\n([^\n]+)/i)?.[1]?.trim() ?? undefined;

  // Regime Especial: pode ter "-" antes do valor real ("Nenhum") na linha seguinte
  const regimeParts = secTribMuni.match(
    /Regime\s+Especial\s+de\s+Tributa[çc][aã]o[^\n]*\n([^\n]+)(?:\n([^\n]+))?/i,
  );
  let regimeEspecialTributacao: string | undefined;
  if (regimeParts) {
    const v1 = regimeParts[1]?.trim();
    const v2 = regimeParts[2]?.trim();
    regimeEspecialTributacao = (!v1 || v1 === '-') ? (v2 && v2 !== '-' ? v2 : undefined) : v1;
  }

  // ISSQN Apurado: "Não Retido R$ 2.400,00" ou "Retido R$ 2.400,00"
  const issqnApuradoLine = nextVal(secTribMuni, /ISSQN\s+Apurado/i);
  const issqnMoneyM      = issqnApuradoLine?.match(/R\$\s*([\d.]+,\d{2})/);
  const valorIss         = issqnMoneyM ? parseNumeroBR('R$ ' + issqnMoneyM[1]) ?? undefined : undefined;
  const issRetido        = issqnApuradoLine != null ? !/n[aã]o\s*retido/i.test(issqnApuradoLine) : undefined;

  // ── Valores Totais ───────────────────────────────────────────────────────────
  // secTotal contém valores R$ em ordem: valorBruto primeiro, valorLiquido por último
  const moneyInTotal: string[] = [];
  const monRe = /R\$\s*([\d.]+,\d{2})/g;
  let monM: RegExpExecArray | null;
  while ((monM = monRe.exec(secTotal)) !== null) moneyInTotal.push(monM[1]);
  const valorBruto   = moneyInTotal[0]
    ? parseNumeroBR('R$ ' + moneyInTotal[0]) ?? undefined
    : baseCalculo;
  const valorLiquido = moneyInTotal.length > 1
    ? parseNumeroBR('R$ ' + moneyInTotal[moneyInTotal.length - 1]) ?? undefined
    : valorBruto;

  // Percentual federal para aproximação de tributos
  const pctM = secTotal.match(/(\d+,\d+)\s*%\s+(\d+,\d+)\s*%\s+(\d+,\d+)\s*%/);
  const pctFed = pctM ? parseNumeroBR(pctM[1]) : undefined;
  const valorAproximadoTributos = (pctFed != null && valorBruto != null)
    ? Math.round(valorBruto * pctFed / 100 * 100) / 100
    : undefined;

  // ── Serviço Prestado ─────────────────────────────────────────────────────────
  const codigoTributacaoNacional  = nextVal(secServico, /C[oó]digo\s+de\s+Tributa[çc][aã]o\s+Nacional/i) ?? undefined;
  const codigoTributacaoMunicipal = nextVal(secServico, /C[oó]digo\s+de\s+Tributa[çc][aã]o\s+Municipal/i) ?? undefined;
  const localPrestacao            = nextVal(secServico, /Local\s+da\s+Presta[çc][aã]o/i) ?? undefined;
  const paisPrestacao             = nextVal(secServico, /Pa[íi]s\s+da\s+Presta[çc][aã]o/i) ?? undefined;
  const descricao                 = nextVal(secServico, /Descri[çc][aã]o\s+do\s+Servi[çc]o/i) ?? undefined;

  // ── NBS (aparece após INTERMEDIÁRIO no texto extraído) ──────────────────────
  const nbs = rawText.match(/NBS:\s*(\d+)/i)?.[1] ?? undefined;

  // ── Derivados ────────────────────────────────────────────────────────────────
  const indicacaoRetencao = issRetido === true
    ? 'Retido pelo Tomador'
    : issRetido === false ? 'Devido pelo Prestador' : undefined;

  const regimeTributario = simplesNacional ? 'SIMPLES_NACIONAL' : regimeApuracao;

  const camposNaoEncontrados: string[] = [];
  if (!prestadorCnpj)   camposNaoEncontrados.push('prestador.cpf_cnpj');
  if (!tomadorCnpj)     camposNaoEncontrados.push('tomador.cpf_cnpj');
  if (!numeroNf)         camposNaoEncontrados.push('numero_nota');
  if (!valorBruto)       camposNaoEncontrados.push('valor_bruto');
  if (!dataEmissaoNfse)  camposNaoEncontrados.push('data_emissao');
  if (!chaveAcessoNfse)  camposNaoEncontrados.push('chave_acesso_nfse');

  return {
    tipo:                        'NFS-e',
    layoutNfse:                  'DANFSE_NACIONAL',
    chaveAcessoNfse,
    codigoVerificacao:           chaveAcessoNfse,   // chave serve como autenticação
    numeroNf,
    competenciaNfse,
    dataEmissao:                 dataEmissaoNfse,
    dataFatoGerador:             competenciaNfse,   // competência = fato gerador no DANFSe
    numeroDps,
    serieDps,
    dataEmissaoDps,
    municipioEmissor:            prestMuni,
    prestador: {
      cpfCnpj:            prestadorCnpj,
      nomeRazaoSocial:    prestadorNome ?? undefined,
      email:              prestadorEmail ?? undefined,
      telefone:           prestadorFone ?? undefined,
      inscricaoMunicipal: prestadorInscMu ?? undefined,
      endereco:           prestadorEnder ?? undefined,
      cep:                prestadorCep ?? undefined,
      municipio:          prestMuni,
      uf:                 prestUf,
    },
    tomador: {
      cpfCnpj:            tomadorCnpj,
      nomeRazaoSocial:    tomadorNome ?? undefined,
      email:              tomadorEmail ?? undefined,
      telefone:           tomadorFone ?? undefined,
      inscricaoMunicipal: tomadorInscMu ?? undefined,
      endereco:           tomadorEnder ?? undefined,
      cep:                tomadorCep ?? undefined,
      municipio:          tomMuni,
      uf:                 tomUf,
    },
    simplesNacional,
    regimeTributario,
    regimeApuracao,
    descricao,
    naturezaOperacao:            codigoTributacaoNacional,
    codigoTributacaoNacional,
    codigoTributacaoMunicipal,
    localPrestacao,
    paisPrestacao,
    tributacaoIssqn,
    situacaoTributariaIssqn:     tributacaoIssqn,
    municipioIncidenciaIssqn,
    resultadoPrestacao,
    regimeEspecialTributacao,
    tipoImunidade,
    suspensaoExigibilidadeIssqn,
    numeroProcessoSuspensao,
    beneficioMunicipal,
    valorBruto,
    valorLiquido,
    baseCalculo,
    aliquota,
    valorIss,
    indicacaoRetencao,
    ir,
    inss,
    pisPasep:                    pis,
    cofins,
    valorAproximadoTributos,
    nbs,
    fontesExtracao:              ['danfse-nacional-v1'],
    camposNaoEncontrados:        camposNaoEncontrados.length ? camposNaoEncontrados : undefined,
    resumo: `DANFSe Nacional v1.0 | NFS-e nº ${numeroNf ?? '?'} | ${prestadorNome ?? prestadorCnpj ?? '?'} | R$ ${valorBruto ?? '?'}`,
  };
}
