/**
 * Extrator DANFSe v2.0 (Documento Auxiliar da NFS-e — padrão nacional com IBS/CBS)
 *
 * Terceiro layout de NFS-e do motor, ao lado do municipal e do DANFSe v1.0.
 * Não é um extrator independente: recebe texto, devolve PdfExtractResult e o
 * roteador aplica as MESMAS validações pós-extração usadas pelos outros
 * layouts (cancelada, documentos fiscais, Simples, fato gerador).
 *
 * ── Estrutura do texto ──────────────────────────────────────────────────────
 * Ao contrário do v1.0, onde rótulo e valor às vezes dividem a linha, o v2.0 é
 * rigorosamente "rótulo numa linha, valor na linha seguinte":
 *
 *     Nome / Nome Empresarial
 *     JM INOX MANUTENCAO INDUSTRIAL LTDA
 *
 * Por isso toda leitura passa por nextVal() (rótulo + contexto), nunca por
 * posição absoluta. Campos ausentes vêm como "-" e viram null — nenhum campo é
 * preenchido por inferência ou herdado de outro bloco.
 *
 * ── Zonas ───────────────────────────────────────────────────────────────────
 * Prestador e Tomador têm rótulos IDÊNTICOS entre si (ambos têm "Telefone",
 * "E-mail", "Endereço"...). A separação é feita fatiando o texto em seções
 * disjuntas antes de qualquer leitura, de modo que é estruturalmente impossível
 * o e-mail do prestador vazar para o tomador: a busca do tomador só enxerga
 * bytes da seção do tomador. No PDF modelo o e-mail do tomador é "-" e precisa
 * permanecer ausente.
 */
import type { PdfExtractResult } from '@/types';
import { parseNumeroBR } from '@/lib/validators';
import { nextVal, nextMoney, section, RE_CNPJ, RE_CPF, AUSENTE } from './danfse-comum';

// ─── HELPERS ESPECÍFICOS DO LAYOUT v2.0 ──────────────────────────────────────

/**
 * Rótulos compostos do v2.0 ("Município / Sigla UF", "CST / cClassTrib") trazem
 * os valores numa única linha separados por barra. Devolve a posição pedida,
 * já tratando "-" como ausente.
 */
function parteBarra(linha: string | null, indice: number): string | undefined {
  if (!linha) return undefined;
  const p = linha.split('/').map(s => s.trim());
  const v = p[indice];
  return (!v || v === AUSENTE) ? undefined : v;
}

/** Valor percentual na linha após o rótulo ("5,00%" → 5). */
function nextPct(text: string, labelRe: RegExp): number | undefined {
  const linha = nextVal(text, labelRe);
  if (!linha) return undefined;
  const m = linha.match(/(\d+(?:\.\d{3})*(?:,\d+)?)\s*%/);
  return m ? parseNumeroBR(m[1]) ?? undefined : undefined;
}

/**
 * CEP do v2.0 vem pontuado ("79.841-090"). Normaliza para a forma canônica
 * usada pelo resto do sistema ("79841-090"); devolve undefined se não houver.
 */
function normalizarCep(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const d = raw.replace(/\D/g, '');
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : undefined;
}

/**
 * Lê uma seção de pessoa (prestador ou tomador). Mesma função para as duas
 * porque os rótulos são os mesmos — o que muda é exclusivamente a fatia de
 * texto recebida, e é isso que garante o isolamento entre as zonas.
 */
function lerPessoa(sec: string) {
  const muniUf = nextVal(sec, /Munic[íi]pio\s*\/\s*Sigla\s*UF/i);
  const ibgeCep = nextVal(sec, /C[oó]digo\s*IBGE\s*\/\s*CEP/i);
  return {
    cpfCnpj:            sec.match(RE_CNPJ)?.[0] ?? sec.match(RE_CPF)?.[0],
    inscricaoMunicipal: nextVal(sec, /Indicador\s*Municipal\s*\(\s*Inscri[çc][aã]o/i) ?? undefined,
    telefone:           nextVal(sec, /Telefone/i) ?? undefined,
    nomeRazaoSocial:    nextVal(sec, /Nome\s*\/\s*Nome\s*Empresarial/i) ?? undefined,
    municipio:          parteBarra(muniUf, 0),
    uf:                 parteBarra(muniUf, 1),
    codigoIbge:         parteBarra(ibgeCep, 0),
    cep:                normalizarCep(parteBarra(ibgeCep, 1)),
    endereco:           nextVal(sec, /Endere[çc]o/i) ?? undefined,
    email:              nextVal(sec, /E-?mail/i) ?? undefined,
  };
}

// ─── EXTRAÇÃO ─────────────────────────────────────────────────────────────────

export function extrairDanfseV2(rawText: string): PdfExtractResult {
  // Seções disjuntas, na ordem em que aparecem no texto do v2.0.
  const RE_PRESTADOR = /PRESTADOR\s*\/\s*FORNECEDOR/i;
  const RE_TOMADOR   = /TOMADOR\s*\/\s*ADQUIRENTE/i;
  const RE_POS_TOM   = /DESTINAT[ÁA]RIO\s*DA\s*OPERA[ÇC][ÃA]O|INTERMEDI[ÁA]RIO\s*DA\s*OPERA[ÇC][ÃA]O|SERVI[ÇC]O\s*PRESTADO/i;
  const RE_SERVICO   = /SERVI[ÇC]O\s*PRESTADO/i;
  const RE_TRIB_MUNI = /TRIBUTA[ÇC][ÃA]O\s*MUNICIPAL/i;
  const RE_TRIB_FED  = /TRIBUTA[ÇC][ÃA]O\s*FEDERAL/i;
  const RE_IBS_CBS   = /TRIBUTA[ÇC][ÃA]O\s*IBS\s*\/\s*CBS/i;
  const RE_TOTAL     = /VALOR\s*TOTAL\s*DA\s*NFS-?e/i;
  const RE_INFO      = /INFORMA[ÇC][ÕO]ES\s*COMPLEMENTARES/i;

  const secHeader   = section(rawText, /^/, RE_PRESTADOR);
  const secPrest    = section(rawText, RE_PRESTADOR, RE_TOMADOR);
  const secTomador  = section(rawText, RE_TOMADOR, RE_POS_TOM);
  const secServico  = section(rawText, RE_SERVICO, RE_TRIB_MUNI);
  const secTribMuni = section(rawText, RE_TRIB_MUNI, RE_TRIB_FED);
  const secTribFed  = section(rawText, RE_TRIB_FED, RE_IBS_CBS);
  const secIbsCbs   = section(rawText, RE_IBS_CBS, RE_TOTAL);
  const secTotal    = section(rawText, RE_TOTAL, RE_INFO);
  const idxInfo     = rawText.search(RE_INFO);
  const secInfo     = idxInfo >= 0 ? rawText.slice(idxInfo) : '';

  // ── Identificação ───────────────────────────────────────────────────────────
  const chaveAcessoNfse = rawText.match(/\b(\d{50})\b/)?.[1];
  const numeroNf        = nextVal(secHeader, /N[ÚU]MERO\s*DA\s*NFS-?e/i) ?? undefined;
  const competenciaNfse = nextVal(secHeader, /COMPET[ÊE]NCIA\s*DA\s*NFS-?e/i) ?? undefined;
  const dataEmissao     = nextVal(secHeader, /DATA\s*E\s*HORA\s*DA\s*EMISS[ÃA]O\s*DA\s*NFS-?e/i) ?? undefined;
  const numeroDps       = nextVal(secHeader, /N[ÚU]MERO\s*DA\s*DPS/i) ?? undefined;
  const serieDps        = nextVal(secHeader, /S[ÉE]RIE\s*DA\s*DPS/i) ?? undefined;
  const dataEmissaoDps  = nextVal(secHeader, /DATA\s*E\s*HORA\s*DA\s*EMISS[ÃA]O\s*DA\s*DPS/i) ?? undefined;
  const emitenteNfse    = nextVal(secHeader, /EMITENTE\s*DA\s*NFS-?e/i) ?? undefined;
  const situacaoNfse    = nextVal(secHeader, /SITUA[ÇC][ÃA]O\s*DA\s*NFS-?e/i) ?? undefined;
  const finalidadeNfse  = nextVal(secHeader, /FINALIDADE/i) ?? undefined;

  // "Município: Dourados - MS" — rótulo e valor na MESMA linha, exceção no v2.0.
  const muniDoc     = secHeader.match(/Munic[íi]pio:\s*([^\n]+)/i)?.[1]?.trim();
  const municipioEmissor = muniDoc?.split(/\s*-\s*/)[0]?.trim() || undefined;

  // ── Prestador e Tomador (zonas isoladas) ────────────────────────────────────
  const prest = lerPessoa(secPrest);
  const tom   = lerPessoa(secTomador);

  const simpNacRaw      = nextVal(secPrest, /Simples\s*Nacional\s*na\s*Data\s*de\s*Compet[êe]ncia/i);
  const simplesNacional = simpNacRaw != null ? /optante/i.test(simpNacRaw) : undefined;
  const regimeApuracao  = nextVal(secPrest, /Regime\s*de\s*Apura[çc][ãa]o\s*Tribut[áa]ria/i) ?? undefined;

  // ── Serviço ─────────────────────────────────────────────────────────────────
  const codTrib   = nextVal(secServico, /C[óo]digo\s*de\s*Tributa[çc][ãa]o\s*Nacional\s*\/\s*Municipal/i);
  const localUfPais = nextVal(secServico, /Local\s*da\s*Presta[çc][ãa]o\s*\/\s*Sigla\s*UF\s*\/\s*Pa[íi]s/i);

  const codigoTributacaoNacional  = parteBarra(codTrib, 0);
  const codigoTributacaoMunicipal = parteBarra(codTrib, 1);
  const nbs           = nextVal(secServico, /C[óo]digo\s*da\s*NBS/i) ?? undefined;
  const localPrestacao = parteBarra(localUfPais, 0);
  const ufPrestacao    = parteBarra(localUfPais, 1);
  const paisPrestacao  = parteBarra(localUfPais, 2);
  const descricao      = nextVal(secServico, /Descri[çc][ãa]o\s*do\s*Servi[çc]o/i) ?? undefined;

  // ── Tributação municipal (ISSQN) ────────────────────────────────────────────
  const tributacaoIssqn = nextVal(secTribMuni, /Tipo\s*de\s*Tributa[çc][ãa]o\s*do\s*ISSQN/i) ?? undefined;
  const incidencia      = nextVal(secTribMuni, /Munic[íi]pio\s*\/\s*Sigla\s*UF\s*\/\s*Pa[íi]s\s*de\s*Incid[êe]ncia/i);
  const baseCalculo     = nextMoney(secTribMuni, /BC\s*ISSQN/i) ?? undefined;
  const aliquota        = nextPct(secTribMuni, /Al[íi]quota\s*Aplicada/i);
  const retencaoIssqn   = nextVal(secTribMuni, /Reten[çc][ãa]o\s*do\s*ISSQN/i) ?? undefined;
  const valorIss        = nextMoney(secTribMuni, /ISSQN\s*Apurado/i) ?? undefined;

  const tipoImunidade               = nextVal(secTribMuni, /Tipo\s*de\s*Imunidade/i) ?? undefined;
  const suspensaoExigibilidadeIssqn = nextVal(secTribMuni, /Suspens[ãa]o\s*da\s*Exigibilidade/i) ?? undefined;
  const numeroProcessoSuspensao     = nextVal(secTribMuni, /N[úu]mero\s*(?:do\s*)?Processo\s*(?:de\s*)?Suspens[ãa]o/i) ?? undefined;
  const regimeEspecialTributacao    = nextVal(secTribMuni, /Regime\s*Especial\s*de\s*Tributa[çc][ãa]o/i) ?? undefined;
  const beneficioMunicipal          = nextVal(secTribMuni, /Benef[íi]cio\s*Municipal/i) ?? undefined;

  // ── Tributação federal (exceto CBS) ─────────────────────────────────────────
  const ir      = nextMoney(secTribFed, /IRRF/i) ?? undefined;
  const inss    = nextMoney(secTribFed, /Contribui[çc][ãa]o\s*Previdenci[áa]ria/i) ?? undefined;
  // "Contribuições Sociais - Retidas" é o AGREGADO PIS/COFINS/CSLL, não a CSLL
  // isolada. Gravar em `csll` diria que a CSLL vale esse número — campo próprio.
  const contribuicoesSociaisRetidas = nextMoney(secTribFed, /Contribui[çc][õo]es\s*Sociais\s*-\s*Retidas/i) ?? undefined;
  const pisPasep = nextMoney(secTribFed, /PIS\s*-/i) ?? undefined;
  const cofins  = nextMoney(secTribFed, /COFINS\s*-/i) ?? undefined;
  const descricaoContribSociais = nextVal(secTribFed, /Descri[çc][ãa]o\s*Contrib\.?\s*Sociais/i) ?? undefined;

  // ── Tributação IBS/CBS (bloco exclusivo do v2.0) ────────────────────────────
  const cstClass   = nextVal(secIbsCbs, /CST\s*\/\s*cClassTrib/i);
  const indOperacao = nextVal(secIbsCbs, /Indicador\s*de\s*Opera[çc][ãa]o\s*\/\s*C[óo]digo\s*IBGE/i);
  const redAliq    = nextVal(secIbsCbs, /Red\.?\s*Al[íi]quota\s*IBS\s*\/\s*Red\.?\s*Al[íi]quota\s*CBS/i);
  const aliqIbs    = nextVal(secIbsCbs, /Al[íi]quota\s*-\s*IBS\s*UF\s*\/\s*IBS\s*Mun/i);

  const ibsCbs = {
    cst:                    parteBarra(cstClass, 0),
    cClassTrib:             parteBarra(cstClass, 1),
    indicadorOperacao:      parteBarra(indOperacao, 0),
    codigoIbgeIncidencia:   parteBarra(indOperacao, 1),
    municipioIncidencia:    parteBarra(indOperacao, 2),
    ufIncidencia:           parteBarra(indOperacao, 3),
    exclusoesReducoesBc:    nextMoney(secIbsCbs, /Exclus[õo]es\s*e\s*Redu[çc][õo]es\s*da\s*Base/i) ?? undefined,
    baseCalculoAposExclusoes: nextMoney(secIbsCbs, /Base\s*de\s*C[áa]lculo\s*Ap[óo]s\s*Exclus[õo]es/i) ?? undefined,
    reducaoAliquotaIbs:     parteBarra(redAliq, 0),
    reducaoAliquotaCbs:     parteBarra(redAliq, 1),
    aliquotaIbsUf:          parteBarra(aliqIbs, 0),
    aliquotaIbsMun:         parteBarra(aliqIbs, 1),
    aliquotaEfetivaMunicipalIbs: nextVal(secIbsCbs, /Al[íi]q\.?\s*Efetiva\s*Municipal\s*-\s*IBS/i) ?? undefined,
    valorApuradoMunicipalIbs:    nextMoney(secIbsCbs, /Valor\s*Apurado\s*Municipal\s*-\s*IBS/i) ?? undefined,
    aliquotaEfetivaEstadualIbs:  nextVal(secIbsCbs, /Al[íi]q\.?\s*Efetiva\s*Estadual\s*-\s*IBS/i) ?? undefined,
    valorApuradoEstadualIbs:     nextMoney(secIbsCbs, /Valor\s*Apurado\s*Estadual\s*-\s*IBS/i) ?? undefined,
    valorTotalApuradoIbs:        nextMoney(secIbsCbs, /Valor\s*Total\s*Apurado\s*-\s*IBS/i) ?? undefined,
    aliquotaCbs:                 nextVal(secIbsCbs, /Al[íi]quota\s*-\s*CBS/i) ?? undefined,
    aliquotaEfetivaCbs:          nextVal(secIbsCbs, /Al[íi]quota\s*Efetiva\s*-\s*CBS/i) ?? undefined,
    valorTotalApuradoCbs:        nextMoney(secIbsCbs, /Valor\s*Total\s*Apurado\s*-\s*CBS/i) ?? undefined,
  };
  const temIbsCbs = Object.values(ibsCbs).some(v => v !== undefined);

  // ── Totais ──────────────────────────────────────────────────────────────────
  const valorBruto             = nextMoney(secTotal, /VALOR\s*DA\s*OPERA[ÇC][ÃA]O\s*\/\s*SERVI[ÇC]O/i) ?? undefined;
  const descontoIncondicionado = nextMoney(secTotal, /Desconto\s*Incondicionado/i) ?? undefined;
  const descontoCondicionado   = nextMoney(secTotal, /Desconto\s*Condicionado/i) ?? undefined;
  const totalRetencoes         = nextMoney(secTotal, /Total\s*das\s*Reten[çc][õo]es/i) ?? undefined;
  const valorLiquido           = nextMoney(secTotal, /VALOR\s*L[ÍI]QUIDO\s*DA\s*NFS-?e(?!\s*\+)/i) ?? undefined;
  const totalIbsCbs            = nextMoney(secTotal, /Total\s*do\s*IBS\s*\/?\s*CBS/i) ?? undefined;
  const valorLiquidoComIbsCbs  = nextMoney(secTotal, /VALOR\s*L[ÍI]QUIDO\s*DA\s*NFS-?e\s*\+\s*IBS\s*\/?\s*CBS/i) ?? undefined;

  const informacoesComplementares = secInfo
    .split('\n').slice(1).map(l => l.trim()).filter(Boolean).join(' ') || undefined;

  // ── Derivados ───────────────────────────────────────────────────────────────
  // "Retido pelo Tomador" / "Não Retido" — lido do rótulo próprio, não inferido.
  const issRetido = retencaoIssqn != null ? !/n[ãa]o\s*retido/i.test(retencaoIssqn) : undefined;
  const indicacaoRetencao = issRetido === true ? retencaoIssqn
    : issRetido === false ? 'Devido pelo Prestador' : undefined;

  const regimeTributario = simplesNacional ? 'SIMPLES_NACIONAL' : regimeApuracao;

  const camposNaoEncontrados: string[] = [];
  if (!prest.cpfCnpj)    camposNaoEncontrados.push('prestador.cpf_cnpj');
  if (!tom.cpfCnpj)      camposNaoEncontrados.push('tomador.cpf_cnpj');
  if (!numeroNf)         camposNaoEncontrados.push('numero_nota');
  if (!valorBruto)       camposNaoEncontrados.push('valor_bruto');
  if (!dataEmissao)      camposNaoEncontrados.push('data_emissao');
  if (!chaveAcessoNfse)  camposNaoEncontrados.push('chave_acesso_nfse');

  return {
    tipo:       'NFS-e',
    layoutNfse: 'DANFSE_V2',

    chaveAcessoNfse,
    codigoVerificacao: chaveAcessoNfse,   // a chave é o elemento de autenticação
    numeroNf,
    competenciaNfse,
    dataEmissao,
    dataFatoGerador: competenciaNfse,     // competência = fato gerador no DANFSe
    numeroDps,
    serieDps,
    dataEmissaoDps,
    emitenteNfse,
    situacaoNfse,
    finalidadeNfse,
    municipioEmissor,

    prestador: {
      cpfCnpj:            prest.cpfCnpj,
      nomeRazaoSocial:    prest.nomeRazaoSocial,
      email:              prest.email,
      telefone:           prest.telefone,
      inscricaoMunicipal: prest.inscricaoMunicipal,
      endereco:           prest.endereco,
      cep:                prest.cep,
      municipio:          prest.municipio,
      uf:                 prest.uf,
    },
    prestadorCodigoIbge: prest.codigoIbge,

    tomador: {
      cpfCnpj:            tom.cpfCnpj,
      nomeRazaoSocial:    tom.nomeRazaoSocial,
      email:              tom.email,
      telefone:           tom.telefone,
      inscricaoMunicipal: tom.inscricaoMunicipal,
      endereco:           tom.endereco,
      cep:                tom.cep,
      municipio:          tom.municipio,
      uf:                 tom.uf,
    },
    tomadorCodigoIbge: tom.codigoIbge,

    simplesNacional,
    regimeTributario,
    regimeApuracao,

    descricao,
    naturezaOperacao: codigoTributacaoNacional,
    codigoTributacaoNacional,
    codigoTributacaoMunicipal,
    nbs,
    localPrestacao,
    ufPrestacao,
    paisPrestacao,

    tributacaoIssqn,
    situacaoTributariaIssqn: tributacaoIssqn,
    municipioIncidenciaIssqn: parteBarra(incidencia, 0),
    ufIncidenciaIssqn:        parteBarra(incidencia, 1),
    paisIncidenciaIssqn:      parteBarra(incidencia, 2),
    baseCalculo,
    aliquota,
    valorIss,
    retencaoIssqn,
    indicacaoRetencao,
    tipoImunidade,
    suspensaoExigibilidadeIssqn,
    numeroProcessoSuspensao,
    regimeEspecialTributacao,
    beneficioMunicipal,

    ir,
    inss,
    contribuicoesSociaisRetidas,
    pisPasep,
    cofins,
    descricaoContribSociais,

    ibsCbs: temIbsCbs ? ibsCbs : undefined,

    valorBruto,
    descontoIncondicionado,
    descontoCondicionado,
    totalRetencoes,
    valorLiquido,
    totalIbsCbs,
    valorLiquidoComIbsCbs,
    observacoesFiscais: informacoesComplementares,

    fontesExtracao: ['danfse-v2'],
    camposNaoEncontrados: camposNaoEncontrados.length ? camposNaoEncontrados : undefined,
    resumo: `DANFSe v2.0 | NFS-e nº ${numeroNf ?? '?'} | ${prest.nomeRazaoSocial ?? prest.cpfCnpj ?? '?'} | R$ ${valorBruto ?? '?'}`,
  };
}
