/**
 * Fase 7 — Motor Tributário e Validação Fiscal
 *
 * Responsabilidades:
 *   • Extrair campos fiscais de OUTRAS INFORMAÇÕES (novos — não cobertos nas fases anteriores)
 *   • Classificar o regime tributário, tipo de prestador, responsável pelo ISS
 *   • Validar ISS (alíquota legal, cálculo, balanço bruto→líquido, consistência de situação)
 *   • Validar retenções federais à luz do regime tributário identificado
 *   • Validar balanço financeiro geral
 *   • Validar dados IBPT conforme Lei 12.741/2012
 *   • Gerar alertas por severidade (CRITICO / MEDIO / BAIXO)
 *   • Calcular confiança fiscal (0-100)
 *   • Emitir parecer de auditoria com recomendações
 *
 * Referências legais utilizadas:
 *   LC 116/2003  — Lista de serviços, alíquotas ISS (min 2%, max 5%)
 *   Lei 8.212/91 — INSS retenção por cessão de mão de obra / empreitada
 *   Lei 9.430/96 — IR/PIS/COFINS/CSLL retidos na fonte
 *   LC 123/2006  — Simples Nacional (DAS unificado, vedação de retenções adicionais)
 *   Lei 12.741/2012 — Divulgação de tributos aproximados (IBPT)
 *   Decreto 8.264/2014 — Regulamenta Lei 12.741/2012
 *
 * Uso:
 *   const resultado = await analyzeTributario(pdfBuffer, {
 *     valor_bruto, valor_liquido, valor_iss, base_calculo, aliquota_iss,
 *     ir, pis_pasep, cofins, inss, csll, outras_retencoes, codigo_servico,
 *   });
 */

import pdfParse from 'pdf-parse';

// ─── TIPOS ────────────────────────────────────────────────────────────────────

export type RegimeTributario =
  | 'SIMPLES_NACIONAL'
  | 'LUCRO_PRESUMIDO'
  | 'LUCRO_REAL'
  | 'MEI'
  | 'PESSOA_FISICA'
  | 'DESCONHECIDO';

export type TipoPrestador =
  | 'MEI'
  | 'ME_EPP'
  | 'PESSOA_FISICA'
  | 'EMPRESA_GERAL'
  | 'DESCONHECIDO';

export type ResponsavelISS = 'TOMADOR' | 'PRESTADOR' | 'INDEFINIDO';

export type ResultadoRegra = 'APROVADO' | 'REPROVADO' | 'AVISO' | 'NAO_APLICAVEL';

export type SeveridadeAlerta = 'CRITICO' | 'MEDIO' | 'BAIXO';

export type NivelAuditoria =
  | 'APROVADO'
  | 'ALERTA_BAIXO'
  | 'ALERTA_MEDIO'
  | 'ALERTA_CRITICO'
  | 'IRREGULAR';

export interface ClassificacaoFiscal {
  regime_tributario:    RegimeTributario;
  tipo_prestador:       TipoPrestador;
  iss_retido:           boolean;
  responsavel_iss:      ResponsavelISS;
  natureza_operacao:    string | null;
  situacao_issqn:       string | null;
  situacao_nfse:        string | null;
  local_prestacao:      string | null;
  municipio_incidencia: string | null;
  simples_nacional:     boolean;
}

export interface IBPTInfo {
  federal_val:  string | null;
  federal_pct:  string | null;
  estadual_val: string | null;
  estadual_pct: string | null;
  municipal_val: string | null;
  municipal_pct: string | null;
}

export interface RegraFiscal {
  codigo:     string;
  descricao:  string;
  resultado:  ResultadoRegra;
  severidade: SeveridadeAlerta;
  detalhe:    string;
}

export interface AlertaFiscal {
  codigo:     string;
  descricao:  string;
  severidade: SeveridadeAlerta;
  campo?:     string;
  detalhe?:   string;
}

export interface ValoresExtrados {
  valor_bruto:      string | null;
  valor_liquido:    string | null;
  valor_iss:        string | null;
  base_calculo:     string | null;
  aliquota_iss:     string | null;
  ir:               string | null;
  pis_pasep:        string | null;
  cofins:           string | null;
  inss:             string | null;
  csll:             string | null;
  outras_retencoes: string | null;
  codigo_servico?:  string | null;
}

export interface TributarioResult {
  classificacao:      ClassificacaoFiscal;
  ibpt:               IBPTInfo;
  regras:             RegraFiscal[];
  alertas:            AlertaFiscal[];
  confianca_fiscal:   number;
  possui_inconsistencias: boolean;
  auditoria: {
    nivel:          NivelAuditoria;
    score:          number;
    resumo:         string;
    recomendacoes:  string[];
  };
  extractionMs: number;
}

// ─── CONSTANTES LEGAIS ────────────────────────────────────────────────────────

/** LC 116/2003 Art. 8-A — alíquota mínima ISS */
const ISS_ALIQ_MIN = 2.0;
/** LC 116/2003 Art. 8, §1 — alíquota máxima ISS */
const ISS_ALIQ_MAX = 5.0;
/** Tolerância monetária para comparações (R$) */
const TOL_MONET = 0.05;
/** Tolerância para percentuais IBPT */
const TOL_PCT = 0.02;

// ─── PADRÕES ──────────────────────────────────────────────────────────────────

const RE_OUTRAS_INFO   = /outras\s+informa[çc][oõ]es/i;
const RE_NATUREZA      = /Natureza da opera[çc][aã]o:\s*(.+)/i;
const RE_SIT_ISSQN     = /Situa[çc][aã]o tribut[aá]ria do ISSQN:\s*(.+)/i;
const RE_LOCAL         = /Local da presta[çc][aã]o do servi[çc]o:\s*(.+)/i;
const RE_SIT_NFSE      = /Situa[çc][aã]o desta NFS-e:\s*(.+)/i;
const RE_SIMPLES       = /optante pelo Simples Nacional/i;
const RE_ME_EPP        = /ME\s+ou\s+EPP/i;
const RE_MEI           = /Microempreendedor\s+Individual|optante\s+pelo\s+MEI/i;
const RE_IBPT_LINE     = /Valor\s+aproximado\s+do\s+tributo/i;
const RE_FED_VAL       = /federal\s*[-–]\s*R\$\s*([\d.,]+)/i;
const RE_FED_PCT       = /federal\s*[-–]\s*R\$\s*[\d.,]+\s*\((\d+(?:,\d+)?)\%\)/i;
const RE_EST_VAL       = /estadual\s*[-–]\s*R\$\s*([\d.,]+)/i;
const RE_EST_PCT       = /estadual\s*[-–]\s*R\$\s*[\d.,]+\s*\((\d+(?:,\d+)?)\%\)/i;
const RE_MUN_VAL       = /municipal\s*[-–]\s*R\$\s*([\d.,]+)/i;
const RE_MUN_PCT       = /municipal\s*[-–]\s*R\$\s*[\d.,]+\s*\((\d+(?:,\d+)?)\%\)/i;

// ─── UTILITÁRIOS ─────────────────────────────────────────────────────────────

function brToFloat(v: string | null | undefined): number {
  if (!v) return 0;
  return parseFloat(v.replace(/\./g, '').replace(',', '.')) || 0;
}

function toBrFormat(n: number): string {
  const [int, dec] = Math.abs(n).toFixed(2).split('.');
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + dec;
}

function toSegments(raw: string): string[] {
  return raw.split('\n').map(s => s.trim()).filter(s => s.length > 0);
}

function approx(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

function regra(
  codigo: string,
  descricao: string,
  resultado: ResultadoRegra,
  severidade: SeveridadeAlerta,
  detalhe: string,
): RegraFiscal {
  return { codigo, descricao, resultado, severidade, detalhe };
}

function aprovado(codigo: string, descricao: string, sev: SeveridadeAlerta, detalhe: string): RegraFiscal {
  return regra(codigo, descricao, 'APROVADO', sev, detalhe);
}

function reprovado(codigo: string, descricao: string, sev: SeveridadeAlerta, detalhe: string): RegraFiscal {
  return regra(codigo, descricao, 'REPROVADO', sev, detalhe);
}

function aviso(codigo: string, descricao: string, detalhe: string): RegraFiscal {
  return regra(codigo, descricao, 'AVISO', 'BAIXO', detalhe);
}

function naoAplicavel(codigo: string, descricao: string, detalhe: string): RegraFiscal {
  return regra(codigo, descricao, 'NAO_APLICAVEL', 'BAIXO', detalhe);
}

// ─── EXTRAÇÃO: CLASSIFICAÇÃO FISCAL ──────────────────────────────────────────

function extractClassificacao(segs: string[]): ClassificacaoFiscal {
  const start = Math.max(0, segs.findIndex(s => RE_OUTRAS_INFO.test(s)));

  let natureza_operacao:    string | null = null;
  let situacao_issqn:       string | null = null;
  let local_prestacao:      string | null = null;
  let situacao_nfse:        string | null = null;
  let simples_nacional      = false;
  let isMEEPP               = false;
  let isMEI                 = false;

  for (let i = start; i < segs.length; i++) {
    const s = segs[i];
    const mNat   = s.match(RE_NATUREZA);   if (mNat)  natureza_operacao = mNat[1].trim();
    const mISSQN = s.match(RE_SIT_ISSQN);  if (mISSQN) situacao_issqn = mISSQN[1].trim();
    const mLocal = s.match(RE_LOCAL);       if (mLocal) local_prestacao = mLocal[1].trim();
    const mNFSe  = s.match(RE_SIT_NFSE);   if (mNFSe)  situacao_nfse = mNFSe[1].trim();
    if (RE_SIMPLES.test(s)) simples_nacional = true;
    if (RE_ME_EPP.test(s))  isMEEPP = true;
    if (RE_MEI.test(s))     isMEI   = true;
  }

  const iss_retido = (
    /reten[çc][aã]o/i.test(situacao_issqn ?? '') ||
    /retida/i.test(situacao_nfse ?? '')
  );

  let regime_tributario: RegimeTributario = 'DESCONHECIDO';
  if (isMEI)            regime_tributario = 'MEI';
  else if (simples_nacional) regime_tributario = 'SIMPLES_NACIONAL';

  let tipo_prestador: TipoPrestador = 'DESCONHECIDO';
  if (isMEI)                      tipo_prestador = 'MEI';
  else if (isMEEPP)               tipo_prestador = 'ME_EPP';
  else if (simples_nacional)      tipo_prestador = 'EMPRESA_GERAL';

  const responsavel_iss: ResponsavelISS = iss_retido ? 'TOMADOR' : 'PRESTADOR';

  return {
    regime_tributario,
    tipo_prestador,
    iss_retido,
    responsavel_iss,
    natureza_operacao,
    situacao_issqn,
    situacao_nfse,
    local_prestacao,
    municipio_incidencia: local_prestacao,
    simples_nacional,
  };
}

// ─── EXTRAÇÃO: IBPT ───────────────────────────────────────────────────────────

function extractIBPT(segs: string[]): IBPTInfo {
  const idx = segs.findIndex(s => RE_IBPT_LINE.test(s));
  if (idx === -1) {
    return {
      federal_val: null, federal_pct: null,
      estadual_val: null, estadual_pct: null,
      municipal_val: null, municipal_pct: null,
    };
  }

  const text = segs.slice(idx, Math.min(segs.length, idx + 3)).join(' ');

  return {
    federal_val:  text.match(RE_FED_VAL)?.[1]  ?? null,
    federal_pct:  text.match(RE_FED_PCT)?.[1]  ?? null,
    estadual_val: text.match(RE_EST_VAL)?.[1]  ?? null,
    estadual_pct: text.match(RE_EST_PCT)?.[1]  ?? null,
    municipal_val: text.match(RE_MUN_VAL)?.[1] ?? null,
    municipal_pct: text.match(RE_MUN_PCT)?.[1] ?? null,
  };
}

// ─── VALIDAÇÃO: ISS ───────────────────────────────────────────────────────────

/**
 * R001 — Alíquota ISS dentro do intervalo legal (LC 116/2003)
 *   Mínimo: 2% (Art. 8-A) | Máximo: 5% (Art. 8, §1)
 *   Exceções tratadas:
 *   - 0%: válido quando há isenção, exportação ou imunidade declarada
 *   - 1-2%: aviso (possível alíquota municipal reduzida autorizada)
 */
function validarAliquotaISS(
  aliquota:          string | null,
  situacaoISSQN?:    string | null,
  naturezaOperacao?: string | null,
): RegraFiscal {
  const cod = 'R001';
  const desc = `Alíquota ISS dentro do intervalo legal [${ISS_ALIQ_MIN}%–${ISS_ALIQ_MAX}%] (LC 116/2003)`;
  if (!aliquota) return reprovado(cod, desc, 'MEDIO', 'alíquota ISS não extraída');

  const pct = brToFloat(aliquota);

  // 3.4 — ISS 0%: válido quando há justificativa legal declarada
  if (pct === 0) {
    const contexto = [situacaoISSQN ?? '', naturezaOperacao ?? ''].join(' ');
    const temJustificativa = /expor|isent|imun|suspens/i.test(contexto);
    if (temJustificativa) {
      return aprovado(cod, desc, 'CRITICO',
        `ISS 0% com justificativa legal declarada: "${situacaoISSQN || naturezaOperacao || 'N/A'}"`);
    }
    return aviso(cod, desc,
      `ISS 0% sem justificativa de isenção/exportação/imunidade declarada — verificar fundamento legal`);
  }

  // 3.5 — ISS entre 1% e 2%: aviso (possível alíquota municipal reduzida)
  if (pct >= 1 && pct < ISS_ALIQ_MIN) {
    return aviso(cod, desc,
      `${aliquota}% abaixo do mínimo geral de ${ISS_ALIQ_MIN}% (LC 116/2003 Art. 8-A) — verificar se município possui alíquota reduzida autorizada`);
  }

  if (pct >= ISS_ALIQ_MIN && pct <= ISS_ALIQ_MAX) {
    return aprovado(cod, desc, 'CRITICO', `${aliquota}% — dentro do intervalo legal`);
  }

  return reprovado(cod, desc, 'CRITICO',
    `${aliquota}% fora do intervalo [${ISS_ALIQ_MIN}%–${ISS_ALIQ_MAX}%] — revisar alíquota municipal`);
}

/**
 * R002 — Cálculo ISS: base_calculo × alíquota / 100 ≈ valor_iss
 */
function validarCalculoISS(
  base: string | null,
  aliquota: string | null,
  valorISS: string | null,
): RegraFiscal {
  const cod = 'R002';
  const desc = 'Cálculo ISS: base_calculo × alíquota / 100 = valor_iss';
  if (!base || !aliquota || !valorISS) {
    return reprovado(cod, desc, 'CRITICO', `dados insuficientes (base=${base}, aliq=${aliquota}, iss=${valorISS})`);
  }
  const calc     = brToFloat(base) * brToFloat(aliquota) / 100;
  const expected = brToFloat(valorISS);
  if (approx(calc, expected, TOL_MONET)) {
    return aprovado(cod, desc, 'CRITICO',
      `${base} × ${aliquota}% / 100 = R$ ${toBrFormat(calc)} ≈ R$ ${valorISS}`);
  }
  return reprovado(cod, desc, 'CRITICO',
    `calculado R$ ${toBrFormat(calc)} ≠ declarado R$ ${valorISS} (diferença R$ ${toBrFormat(Math.abs(calc - expected))})`);
}

/**
 * R003 — Balanço ISS: valor_bruto − valor_iss ≈ valor_liquido (quando retenções federais = R$ 0)
 */
function validarBalancoISS(
  bruto: string | null,
  iss: string | null,
  liquido: string | null,
  totalFederais: number,
): RegraFiscal {
  const cod = 'R003';
  const desc = 'Balanço: valor_bruto − valor_iss − retenções_federais = valor_liquido';
  if (!bruto || !iss || !liquido) {
    return reprovado(cod, desc, 'CRITICO', `dados insuficientes para validação de balanço`);
  }
  const calc = brToFloat(bruto) - brToFloat(iss) - totalFederais;
  const exp  = brToFloat(liquido);
  if (approx(calc, exp, TOL_MONET)) {
    return aprovado(cod, desc, 'CRITICO',
      `${bruto} − ${iss} − ${toBrFormat(totalFederais)} = R$ ${toBrFormat(calc)} ≈ R$ ${liquido}`);
  }
  return reprovado(cod, desc, 'CRITICO',
    `saldo calculado R$ ${toBrFormat(calc)} ≠ valor líquido declarado R$ ${liquido}`);
}

/**
 * R004 — Consistência situação ISSQN vs. campo iss_retido
 *   "Retenção" → iss_retido = true e situação NFS-e = "Retida"
 */
function validarSituacaoISS(
  situacaoISSQN: string | null,
  situacaoNFSe:  string | null,
  issRetido:     boolean,
): RegraFiscal {
  const cod = 'R004';
  const desc = 'Consistência entre situação ISSQN, situação NFS-e e indicador iss_retido';
  const retencaoNoISSQN = /reten[çc][aã]o/i.test(situacaoISSQN ?? '');
  const retidaNFSe      = /retida/i.test(situacaoNFSe ?? '');

  if (retencaoNoISSQN === retidaNFSe && retencaoNoISSQN === issRetido) {
    return aprovado(cod, desc, 'MEDIO',
      `ISSQN="${situacaoISSQN ?? 'N/A'}", NFS-e="${situacaoNFSe ?? 'N/A'}", iss_retido=${issRetido} — consistentes`);
  }
  return reprovado(cod, desc, 'MEDIO',
    `divergência: ISSQN="${situacaoISSQN}", NFS-e="${situacaoNFSe}", iss_retido=${issRetido}`);
}

// ─── VALIDAÇÃO: RETENÇÕES FEDERAIS ────────────────────────────────────────────

/**
 * Para empresas do Simples Nacional, as retenções federais (IR, PIS/COFINS, CSLL)
 * são vedadas na fonte, pois já estão unificadas no DAS (LC 123/2006 Art. 3, §1).
 * Exceções: decisão judicial, serviços de cessão de mão de obra (INSS).
 */
function validarRetencoesSimples(
  vals: ValoresExtrados,
  simples: boolean,
): RegraFiscal[] {
  if (!simples) {
    return [
      naoAplicavel('R005', 'IR — vedação Simples Nacional', 'empresa não é optante do Simples Nacional'),
      naoAplicavel('R006', 'PIS/PASEP — vedação Simples Nacional', 'empresa não é optante'),
      naoAplicavel('R007', 'COFINS — vedação Simples Nacional', 'empresa não é optante'),
      naoAplicavel('R008', 'CSLL — vedação Simples Nacional', 'empresa não é optante'),
      naoAplicavel('R009', 'INSS — avaliação Simples Nacional', 'empresa não é optante'),
    ];
  }

  const result: RegraFiscal[] = [];

  // R005: IR deve ser 0 para SN (vedação LC 123/2006)
  const ir = brToFloat(vals.ir);
  result.push(ir < TOL_MONET
    ? aprovado('R005', 'IR zerado — coerente com Simples Nacional (LC 123/2006)', 'MEDIO',
        `IR = R$ ${vals.ir ?? '0,00'} — correto, empresa SN não sujeita a retenção de IR na fonte`)
    : reprovado('R005', 'IR retido de empresa Simples Nacional', 'MEDIO',
        `IR = R$ ${vals.ir} — vedado para SN salvo decisão judicial (LC 123/2006 Art. 3, §1)`),
  );

  // R006: PIS deve ser 0 para SN
  const pis = brToFloat(vals.pis_pasep);
  result.push(pis < TOL_MONET
    ? aprovado('R006', 'PIS/PASEP zerado — coerente com Simples Nacional', 'MEDIO',
        `PIS/PASEP = R$ ${vals.pis_pasep ?? '0,00'} — correto`)
    : reprovado('R006', 'PIS/PASEP retido de empresa Simples Nacional', 'MEDIO',
        `PIS = R$ ${vals.pis_pasep} — vedado para SN (LC 123/2006)`),
  );

  // R007: COFINS deve ser 0 para SN
  const cofins = brToFloat(vals.cofins);
  result.push(cofins < TOL_MONET
    ? aprovado('R007', 'COFINS zerada — coerente com Simples Nacional', 'MEDIO',
        `COFINS = R$ ${vals.cofins ?? '0,00'} — correto`)
    : reprovado('R007', 'COFINS retida de empresa Simples Nacional', 'MEDIO',
        `COFINS = R$ ${vals.cofins} — vedado para SN (LC 123/2006)`),
  );

  // R008: CSLL deve ser 0 para SN
  const csll = brToFloat(vals.csll);
  result.push(csll < TOL_MONET
    ? aprovado('R008', 'CSLL zerada — coerente com Simples Nacional', 'MEDIO',
        `CSLL = R$ ${vals.csll ?? '0,00'} — correto`)
    : reprovado('R008', 'CSLL retida de empresa Simples Nacional', 'MEDIO',
        `CSLL = R$ ${vals.csll} — vedado para SN (LC 123/2006)`),
  );

  // R009: INSS — aviso condicional (pode ser retido dependendo do serviço e CNAE)
  const inss = brToFloat(vals.inss);
  result.push(inss < TOL_MONET
    ? aviso('R009', 'INSS zerado — verificar obrigatoriedade para o serviço',
        `INSS = R$ ${vals.inss ?? '0,00'} — aceitável para SN, mas serviços de cessão/empreitada ` +
        `(ex. manutenção, limpeza) podem exigir retenção de 11% (Lei 8.212/91 Art. 31). ` +
        `Confirme se o CNAE está sujeito à retenção previdenciária.`)
    : aviso('R009', 'INSS retido — verificar compatibilidade com Simples Nacional',
        `INSS = R$ ${vals.inss} — verifique se a empresa optou pela exclusão do INSS do DAS e ` +
        `se o serviço é listado no Art. 31 da Lei 8.212/91`),
  );

  return result;
}

// ─── VALIDAÇÃO: BALANÇO FINANCEIRO GERAL ─────────────────────────────────────

/**
 * R010 — Soma das retenções: Σ(federais) coerente com total declarado
 */
function validarSomaRetencoes(vals: ValoresExtrados): RegraFiscal {
  const cod = 'R010';
  const desc = 'Soma retenções federais: IR + PIS + COFINS + INSS + CSLL + Outras';
  const soma = [vals.ir, vals.pis_pasep, vals.cofins, vals.inss, vals.csll, vals.outras_retencoes]
    .reduce((acc, v) => acc + brToFloat(v), 0);
  return aprovado(cod, desc, 'MEDIO',
    `Σ = R$ ${toBrFormat(soma)} ` +
    `(IR=${vals.ir} + PIS=${vals.pis_pasep} + COFINS=${vals.cofins} + ` +
    `INSS=${vals.inss} + CSLL=${vals.csll} + Outras=${vals.outras_retencoes})`);
}

// ─── VALIDAÇÃO: IBPT ──────────────────────────────────────────────────────────

/**
 * R011 — IBPT municipal: pct_municipal × base_calculo ≈ valor_municipal
 *   Para serviços, o tributo municipal é exclusivamente o ISS.
 *   Portanto: pct_municipal × base ≈ valor_iss
 */
function validarIBPTMunicipal(ibpt: IBPTInfo, base: string | null, valorISS: string | null): RegraFiscal {
  const cod = 'R011';
  const desc = 'IBPT municipal: percentual municipal × base ≈ tributo municipal (= ISS para serviços)';
  if (!ibpt.municipal_pct || !ibpt.municipal_val || !base) {
    return aviso(cod, desc, 'dados IBPT municipal ausentes — impossível validar');
  }
  const calc = brToFloat(ibpt.municipal_pct) / 100 * brToFloat(base);
  const decl = brToFloat(ibpt.municipal_val);
  const issF = brToFloat(valorISS);

  if (approx(calc, decl, TOL_MONET)) {
    const issMatch = approx(decl, issF, TOL_MONET)
      ? ` — coincide com valor_iss (R$ ${valorISS}), como esperado para serviços`
      : ` — diverge do valor_iss declarado (R$ ${valorISS}), revisar`;
    return approx(decl, issF, TOL_MONET)
      ? aprovado(cod, desc, 'BAIXO',
          `${ibpt.municipal_pct}% × ${base} = R$ ${toBrFormat(calc)} ≈ R$ ${ibpt.municipal_val}${issMatch}`)
      : aviso(cod, desc,
          `${ibpt.municipal_pct}% × ${base} = R$ ${toBrFormat(calc)} mas valor_iss = R$ ${valorISS}${issMatch}`);
  }
  return reprovado(cod, desc, 'BAIXO',
    `calculado R$ ${toBrFormat(calc)} ≠ declarado R$ ${ibpt.municipal_val}`);
}

/**
 * R012 — IBPT estadual: deve ser R$ 0,00 para serviços (ISS ≠ ICMS)
 *   Serviços são tributados por ISS (municipal), não por ICMS (estadual).
 *   IBPT estadual deve ser zero ou muito baixo.
 */
function validarIBPTEstadual(ibpt: IBPTInfo): RegraFiscal {
  const cod = 'R012';
  const desc = 'IBPT estadual zerado — serviços sujeitos ao ISS não geram ICMS (estadual)';
  if (!ibpt.estadual_val) return aviso(cod, desc, 'valor estadual IBPT não encontrado');
  const v = brToFloat(ibpt.estadual_val);
  return v < TOL_MONET
    ? aprovado(cod, desc, 'BAIXO', `IBPT estadual = R$ ${ibpt.estadual_val} — correto para serviços`)
    : aviso(cod, desc, `IBPT estadual = R$ ${ibpt.estadual_val} — revisar (serviços normalmente não geram ICMS)`);
}

/**
 * R013 — IBPT federal: pct_federal × base_calculo ≈ valor_federal
 *   Verifica a consistência interna da declaração IBPT.
 */
function validarIBPTFederal(ibpt: IBPTInfo, base: string | null): RegraFiscal {
  const cod = 'R013';
  const desc = 'IBPT federal: percentual federal × base ≈ valor federal declarado';
  if (!ibpt.federal_pct || !ibpt.federal_val || !base) {
    return aviso(cod, desc, 'dados IBPT federal ausentes — impossível validar');
  }
  const calc = brToFloat(ibpt.federal_pct) / 100 * brToFloat(base);
  const decl = brToFloat(ibpt.federal_val);
  if (approx(calc, decl, TOL_MONET)) {
    return aprovado(cod, desc, 'BAIXO',
      `${ibpt.federal_pct}% × ${base} = R$ ${toBrFormat(calc)} ≈ R$ ${ibpt.federal_val}`);
  }
  return reprovado(cod, desc, 'BAIXO',
    `calculado R$ ${toBrFormat(calc)} ≠ declarado R$ ${ibpt.federal_val}`);
}

// ─── VALIDAÇÃO: CÓDIGO DO SERVIÇO ─────────────────────────────────────────────

/**
 * R014 — Código do serviço no formato LC 116/2003 (X.XX ou XX.XX)
 */
function validarCodigoServico(codigo: string | null | undefined): RegraFiscal {
  const cod = 'R014';
  const desc = 'Código de serviço no formato LC 116/2003 (XX.XX)';
  if (!codigo) return naoAplicavel(cod, desc, 'código de serviço não fornecido');
  if (/^\d{1,2}\.\d{2,4}$/.test(codigo)) {
    return aprovado(cod, desc, 'BAIXO', `código "${codigo}" — formato válido LC 116/2003`);
  }
  return reprovado(cod, desc, 'BAIXO', `código "${codigo}" fora do formato X.XX ou XX.XX`);
}

/**
 * R015 — Natureza da operação declarada
 */
function validarNaturezaOperacao(natureza: string | null): RegraFiscal {
  const cod = 'R015';
  const desc = 'Natureza da operação declarada na nota';
  if (!natureza) return reprovado(cod, desc, 'BAIXO', 'natureza da operação ausente no documento');
  return aprovado(cod, desc, 'BAIXO', `"${natureza}" — campo presente e declarado`);
}

// ─── MOTOR DE ALERTAS ─────────────────────────────────────────────────────────

function gerarAlertas(regras: RegraFiscal[]): AlertaFiscal[] {
  return regras
    .filter(r => r.resultado === 'REPROVADO')
    .map(r => ({
      codigo:     r.codigo,
      descricao:  r.descricao,
      severidade: r.severidade,
      detalhe:    r.detalhe,
    }));
}

// ─── CONFIANÇA FISCAL ─────────────────────────────────────────────────────────

/**
 * Pontuação inicial: 100
 * CRITICO reprovado: -30 por regra
 * MEDIO  reprovado: -15 por regra
 * BAIXO  reprovado:  -5 por regra
 * AVISO:             -2 por regra
 */
function calcularConfiancaFiscal(regras: RegraFiscal[]): number {
  const PENALIDADE: Record<string, Record<string, number>> = {
    REPROVADO: { CRITICO: -30, MEDIO: -15, BAIXO: -5 },
    AVISO:     { CRITICO:  -2, MEDIO:  -2, BAIXO: -2 },
  };
  const score = regras.reduce((acc, r) => {
    const pen = PENALIDADE[r.resultado]?.[r.severidade] ?? 0;
    return acc + pen;
  }, 100);
  return Math.max(0, Math.min(100, score));
}

// ─── MOTOR DE AUDITORIA ───────────────────────────────────────────────────────

function gerarAuditoria(
  score: number,
  alertas: AlertaFiscal[],
  classificacao: ClassificacaoFiscal,
  vals: ValoresExtrados,
): TributarioResult['auditoria'] {
  let nivel: NivelAuditoria;
  if      (score >= 90) nivel = 'APROVADO';
  else if (score >= 75) nivel = 'ALERTA_BAIXO';
  else if (score >= 50) nivel = 'ALERTA_MEDIO';
  else if (score >= 25) nivel = 'ALERTA_CRITICO';
  else                  nivel = 'IRREGULAR';

  const criticos = alertas.filter(a => a.severidade === 'CRITICO').length;
  const medios   = alertas.filter(a => a.severidade === 'MEDIO').length;
  const baixos   = alertas.filter(a => a.severidade === 'BAIXO').length;

  let resumo: string;
  if (alertas.length === 0) {
    resumo = `NFS-e aprovada — todos os campos fiscais são consistentes. ` +
      `Regime: ${classificacao.regime_tributario}. ` +
      `ISS ${classificacao.iss_retido ? 'retido pelo Tomador' : 'a recolher pelo Prestador'}. ` +
      `Confiança fiscal: ${score}%.`;
  } else {
    resumo = `NFS-e com ${alertas.length} alerta(s): ${criticos} crítico(s), ${medios} médio(s), ${baixos} baixo(s). ` +
      `Confiança fiscal: ${score}%. Revisar os campos sinalizados antes de processar o pagamento.`;
  }

  const recomendacoes: string[] = [];

  if (alertas.length === 0) {
    if (classificacao.iss_retido && classificacao.responsavel_iss === 'TOMADOR') {
      recomendacoes.push(
        `ISS retido: o Tomador deve recolher R$ ${vals.valor_iss ?? '?'} ao município de ` +
        `${classificacao.municipio_incidencia ?? 'prestação'} via DARM/GNRE até o vencimento.`,
      );
      recomendacoes.push(
        `Valor líquido a pagar ao Prestador: R$ ${vals.valor_liquido ?? '?'} ` +
        `(deduzido o ISS retido de R$ ${vals.valor_iss ?? '?'}).`,
      );
    }
    if (classificacao.simples_nacional) {
      recomendacoes.push(
        'Prestador optante pelo Simples Nacional: não realizar retenção de IR, PIS, COFINS, CSLL ' +
        '(LC 123/2006 Art. 3, §1). Verifique INSS conforme serviço e CNAE.',
      );
    }
    recomendacoes.push(
      'Tributos aproximados declarados conforme Lei 12.741/2012 — informação transparente ao consumidor.',
    );
    recomendacoes.push(
      'Mantenha o comprovante de inscrição no Simples Nacional atualizado para fins de auditoria.',
    );
  } else {
    for (const a of alertas) {
      recomendacoes.push(`[${a.severidade}] ${a.codigo}: ${a.detalhe}`);
    }
    if (criticos > 0) {
      recomendacoes.push('ATENÇÃO: existem alertas críticos — não processar o pagamento sem revisão fiscal.');
    }
  }

  return { nivel, score, resumo, recomendacoes };
}

// ─── ENTRY POINT ─────────────────────────────────────────────────────────────

export async function analyzeTributario(
  pdfBuffer: Buffer,
  valores: ValoresExtrados,
): Promise<TributarioResult> {
  const t0   = Date.now();
  const raw  = await pdfParse(pdfBuffer);
  const segs = toSegments(raw.text);

  // ── Extração: campos fiscais novos (não cobertos nas fases anteriores) ──────
  const classificacao = extractClassificacao(segs);
  const ibpt          = extractIBPT(segs);

  // ── Total de retenções federais para uso no balanço ────────────────────────
  const totalFederais =
    brToFloat(valores.ir) +
    brToFloat(valores.pis_pasep) +
    brToFloat(valores.cofins) +
    brToFloat(valores.inss) +
    brToFloat(valores.csll) +
    brToFloat(valores.outras_retencoes);

  // ── Aplicação das regras fiscais ───────────────────────────────────────────
  const regras: RegraFiscal[] = [
    // ISS
    validarAliquotaISS(valores.aliquota_iss, classificacao.situacao_issqn, classificacao.natureza_operacao),
    validarCalculoISS(valores.base_calculo, valores.aliquota_iss, valores.valor_iss),
    validarBalancoISS(valores.valor_bruto, valores.valor_iss, valores.valor_liquido, totalFederais),
    validarSituacaoISS(classificacao.situacao_issqn, classificacao.situacao_nfse, classificacao.iss_retido),

    // Retenções federais (Simples Nacional)
    ...validarRetencoesSimples(valores, classificacao.simples_nacional),

    // Balanço financeiro
    validarSomaRetencoes(valores),

    // IBPT
    validarIBPTMunicipal(ibpt, valores.base_calculo, valores.valor_iss),
    validarIBPTEstadual(ibpt),
    validarIBPTFederal(ibpt, valores.base_calculo),

    // Campos complementares
    validarCodigoServico(valores.codigo_servico),
    validarNaturezaOperacao(classificacao.natureza_operacao),
  ];

  const alertas             = gerarAlertas(regras);
  const confianca_fiscal    = calcularConfiancaFiscal(regras);
  const possui_inconsistencias = alertas.length > 0;
  const auditoria           = gerarAuditoria(confianca_fiscal, alertas, classificacao, valores);

  return {
    classificacao,
    ibpt,
    regras,
    alertas,
    confianca_fiscal,
    possui_inconsistencias,
    auditoria,
    extractionMs: Date.now() - t0,
  };
}
