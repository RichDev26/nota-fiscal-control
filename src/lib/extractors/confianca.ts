/**
 * Fase 8 — Sistema de Confiança Global, Score por Campo e Score da Nota
 *
 * Agregador puro: recebe os resultados de todas as fases anteriores como input
 * e produz um relatório de confiança estratificado (por campo → seção → nota).
 *
 * NÃO extrai campos. NÃO chama extractores. NÃO reimplementa fases anteriores.
 *
 * Taxonomia de confiança: MUITO_ALTA(≥95%) ALTA(85-94%) MEDIA(70-84%) BAIXA(50-69%) MUITO_BAIXA(<50%)
 * Taxonomia de risco    : BAIXO  MEDIO  ALTO  CRITICO  (independente da confiança)
 * Origem                : TEXTO_DIRETO  OCR  FALLBACK_HEURISTICO  INFERENCIA
 */

import type { FieldResult, ValidationResult, CriticalFieldsResult } from './types';
import type { PrestadorResult }  from './prestador';
import type { TomadorResult }    from './tomador';
import type { ServicoResult }    from './servico';
import type { FinanceiroResult } from './financeiro';
import type { TributarioResult } from './tributario';

// ─── TIPOS PÚBLICOS ───────────────────────────────────────────────────────────

export type NivelConfianca =
  | 'MUITO_ALTA'
  | 'ALTA'
  | 'MEDIA'
  | 'BAIXA'
  | 'MUITO_BAIXA';

export type OrigemExtracao =
  | 'TEXTO_DIRETO'
  | 'OCR'
  | 'FALLBACK_HEURISTICO'
  | 'INFERENCIA';

export type NivelRisco = 'BAIXO' | 'MEDIO' | 'ALTO' | 'CRITICO';

export type SecaoNome =
  | 'cabecalho'
  | 'prestador'
  | 'tomador'
  | 'servicos'
  | 'financeiro'
  | 'fiscal';

export interface CampoConfianca {
  nome:                string;
  secao:               SecaoNome;
  valor:               string | null;
  confianca:           number;
  nivel:               NivelConfianca;
  origem:              OrigemExtracao;
  peso:                number;
  critico:             boolean;
  risco:               NivelRisco;
  motivos:             string[];
  revisao_obrigatoria: boolean;
}

export interface SecaoScore {
  score:                number;
  nivel:                NivelConfianca;
  alertas:              string[];
  revisao_obrigatoria:  boolean;
  campos_problematicos: string[];
}

export interface ConfiancaResult {
  score_global:        number;
  score_ocr:           number;
  score_estrutural:    number;
  score_fiscal:        number;
  nivel_global:        NivelConfianca;
  revisao_obrigatoria: boolean;
  bloqueado:           boolean;
  motivo_bloqueio?:    string;
  secoes: {
    cabecalho:  SecaoScore;
    prestador:  SecaoScore;
    tomador:    SecaoScore;
    servicos:   SecaoScore;
    financeiro: SecaoScore;
    fiscal:     SecaoScore;
  };
  campos:     Record<string, CampoConfianca>;
  explicacao: {
    fatores_positivos:  string[];
    fatores_negativos:  string[];
    acoes_recomendadas: string[];
    metodologia:        string;
  };
  resumo:      string;
  calculoMs:   number;
}

export interface ConfiancaInput {
  critical:   CriticalFieldsResult;
  prestador:  PrestadorResult;
  tomador:    TomadorResult;
  servico:    ServicoResult;
  financeiro: FinanceiroResult;
  tributario: TributarioResult;
}

// ─── CAMPO NORMALIZADO (adaptador interno) ────────────────────────────────────

interface CampoNorm {
  valor:     string | null;
  confianca: number;
  metodo:    string;
  validacoes: ValidationResult[];
}

/** Adapta FieldResult da Fase 2 (nomes em inglês) → CampoNorm */
function fromFieldResult(f: FieldResult): CampoNorm {
  return { valor: f.value, confianca: f.confidence, metodo: f.method, validacoes: f.validations };
}

/** Adapta PrestadorField / TomadorField / ServicoField / FinanceiroField (nomes em português) */
function fromPtField(f: { valor: string | null; confianca: number; metodo: string; validacoes: ValidationResult[] }): CampoNorm {
  return { valor: f.valor, confianca: f.confianca, metodo: f.metodo, validacoes: f.validacoes };
}

/** Cria CampoNorm sintético para campos derivados da fase 7 (sem FieldResult próprio) */
function syntheticField(valor: string | boolean | null, confianca: number, metodo: string): CampoNorm {
  return {
    valor:     valor !== null ? String(valor) : null,
    confianca,
    metodo,
    validacoes: [],
  };
}

// ─── CONFIGURAÇÃO DE PESOS ────────────────────────────────────────────────────

interface CampoConfig { peso: number; critico: boolean; secao: SecaoNome }

/**
 * Tabela de pesos e criticidade por campo.
 * Peso 10-15 → campo de alto impacto fiscal/jurídico.
 * Peso 5-9   → campo importante mas não bloqueante sozinho.
 * Peso 1-4   → campo auxiliar / complementar.
 */
const PESOS: Record<string, CampoConfig> = {
  // ── Cabeçalho ──────────────────────────────────────────────────────────────
  numero_nota:                   { peso: 12, critico: true,  secao: 'cabecalho'  },
  codigo_verificacao:            { peso: 12, critico: true,  secao: 'cabecalho'  },
  data_emissao:                  { peso:  9, critico: true,  secao: 'cabecalho'  },
  data_fato_gerador:             { peso:  8, critico: false, secao: 'cabecalho'  },

  // ── Prestador ──────────────────────────────────────────────────────────────
  cpf_cnpj_prestador:            { peso: 15, critico: true,  secao: 'prestador'  },
  razao_social_prestador:        { peso:  8, critico: true,  secao: 'prestador'  },
  nome_fantasia_prestador:       { peso:  3, critico: false, secao: 'prestador'  },
  inscricao_municipal_prestador: { peso:  5, critico: false, secao: 'prestador'  },
  inscricao_estadual_prestador:  { peso:  4, critico: false, secao: 'prestador'  },
  endereco_prestador:            { peso:  5, critico: false, secao: 'prestador'  },
  numero_prestador:              { peso:  2, critico: false, secao: 'prestador'  },
  complemento_prestador:         { peso:  1, critico: false, secao: 'prestador'  },
  bairro_prestador:              { peso:  2, critico: false, secao: 'prestador'  },
  cep_prestador:                 { peso:  4, critico: false, secao: 'prestador'  },
  municipio_prestador:           { peso:  4, critico: false, secao: 'prestador'  },
  uf_prestador:                  { peso:  3, critico: false, secao: 'prestador'  },
  email_prestador:               { peso:  3, critico: false, secao: 'prestador'  },
  telefone_prestador:            { peso:  3, critico: false, secao: 'prestador'  },
  celular_prestador:             { peso:  2, critico: false, secao: 'prestador'  },
  site_prestador:                { peso:  1, critico: false, secao: 'prestador'  },

  // ── Tomador ────────────────────────────────────────────────────────────────
  cpf_cnpj_tomador:              { peso: 15, critico: true,  secao: 'tomador'    },
  razao_social_tomador:          { peso:  8, critico: true,  secao: 'tomador'    },
  nome_fantasia_tomador:         { peso:  3, critico: false, secao: 'tomador'    },
  inscricao_municipal_tomador:   { peso:  5, critico: false, secao: 'tomador'    },
  inscricao_estadual_tomador:    { peso:  4, critico: false, secao: 'tomador'    },
  endereco_tomador:              { peso:  5, critico: false, secao: 'tomador'    },
  numero_tomador:                { peso:  2, critico: false, secao: 'tomador'    },
  complemento_tomador:           { peso:  1, critico: false, secao: 'tomador'    },
  bairro_tomador:                { peso:  2, critico: false, secao: 'tomador'    },
  cep_tomador:                   { peso:  4, critico: false, secao: 'tomador'    },
  municipio_tomador:             { peso:  4, critico: false, secao: 'tomador'    },
  uf_tomador:                    { peso:  3, critico: false, secao: 'tomador'    },
  email_tomador:                 { peso:  3, critico: false, secao: 'tomador'    },
  telefone_tomador:              { peso:  3, critico: false, secao: 'tomador'    },
  celular_tomador:               { peso:  2, critico: false, secao: 'tomador'    },
  site_tomador:                  { peso:  1, critico: false, secao: 'tomador'    },

  // ── Serviços ───────────────────────────────────────────────────────────────
  descricao_servico:             { peso:  8, critico: false, secao: 'servicos'   },
  of_servico:                    { peso:  4, critico: false, secao: 'servicos'   },
  quantidade_servico:            { peso:  5, critico: false, secao: 'servicos'   },
  valor_unitario_servico:        { peso:  6, critico: false, secao: 'servicos'   },
  valor_servico:                 { peso:  9, critico: true,  secao: 'servicos'   },
  base_calculo_servico:          { peso:  7, critico: false, secao: 'servicos'   },
  aliquota_iss_servico:          { peso:  8, critico: true,  secao: 'servicos'   },
  valor_iss_servico:             { peso: 10, critico: true,  secao: 'servicos'   },
  codigo_servico:                { peso:  7, critico: false, secao: 'servicos'   },

  // ── Financeiro ─────────────────────────────────────────────────────────────
  valor_servico_fin:             { peso:  9, critico: true,  secao: 'financeiro' },
  valor_bruto:                   { peso: 12, critico: true,  secao: 'financeiro' },
  valor_liquido:                 { peso: 12, critico: true,  secao: 'financeiro' },
  base_calculo_fin:              { peso:  7, critico: false, secao: 'financeiro' },
  aliquota_iss_fin:              { peso:  8, critico: true,  secao: 'financeiro' },
  valor_iss_fin:                 { peso: 10, critico: true,  secao: 'financeiro' },
  ir:                            { peso:  5, critico: false, secao: 'financeiro' },
  pis_pasep:                     { peso:  4, critico: false, secao: 'financeiro' },
  cofins:                        { peso:  4, critico: false, secao: 'financeiro' },
  inss:                          { peso:  4, critico: false, secao: 'financeiro' },
  csll:                          { peso:  4, critico: false, secao: 'financeiro' },
  outras_retencoes:              { peso:  3, critico: false, secao: 'financeiro' },
  valor_aproximado_tributos:     { peso:  3, critico: false, secao: 'financeiro' },
  valor_liquido_antecipacao:     { peso:  2, critico: false, secao: 'financeiro' },
  total_tributos_encargos:       { peso:  3, critico: false, secao: 'financeiro' },

  // ── Fiscal ─────────────────────────────────────────────────────────────────
  regime_tributario:             { peso:  6, critico: false, secao: 'fiscal'     },
  iss_retido:                    { peso:  7, critico: true,  secao: 'fiscal'     },
  responsavel_iss:               { peso:  5, critico: false, secao: 'fiscal'     },
  natureza_operacao:             { peso:  4, critico: false, secao: 'fiscal'     },
  situacao_issqn:                { peso:  5, critico: false, secao: 'fiscal'     },
  situacao_nfse:                 { peso:  5, critico: false, secao: 'fiscal'     },
  local_prestacao:               { peso:  3, critico: false, secao: 'fiscal'     },
};

const PESO_SECAO: Record<SecaoNome, number> = {
  cabecalho:  25,
  prestador:  20,
  tomador:    20,
  servicos:   15,
  financeiro: 15,
  fiscal:      5,
};

// ─── UTILITÁRIOS ──────────────────────────────────────────────────────────────

function levelFor(score: number): NivelConfianca {
  if (score >= 95) return 'MUITO_ALTA';
  if (score >= 85) return 'ALTA';
  if (score >= 70) return 'MEDIA';
  if (score >= 50) return 'BAIXA';
  return 'MUITO_BAIXA';
}

function classifyOrigin(metodo: string): OrigemExtracao {
  const m = metodo.toLowerCase();
  if (m === 'campo_ausente' || m === 'nao_presente' || m.startsWith('derivado_')) return 'INFERENCIA';
  if (m.includes('inferido') || m.includes('derivado'))                             return 'INFERENCIA';
  if (m.includes('heuristic') || m.includes('pessoa_fisica_fallback'))              return 'FALLBACK_HEURISTICO';
  if (m.includes('fallback'))                                                        return 'FALLBACK_HEURISTICO';
  if (m.includes('ocr') || m.includes('scanned'))                                   return 'OCR';
  return 'TEXTO_DIRETO';
}

/**
 * Risco combina impacto (criticidade) com probabilidade de erro (confiança + validações).
 * Um campo crítico com 90% de confiança e 1 falha menor = ALTO (não CRÍTICO).
 * CRÍTICO é reservado para: confiança < 50% em campo crítico, ou falha + confiança < 70%.
 */
function calcRisco(
  confianca: number,
  critico: boolean,
  origem: OrigemExtracao,
  temFalhaValidacao: boolean,
): NivelRisco {
  // CRITICO: campo crítico com confiança muito baixa, ou falha + confiança baixa
  if (critico && confianca < 50)                           return 'CRITICO';
  if (temFalhaValidacao && critico && confianca < 70)      return 'CRITICO';
  // ALTO: falha em campo crítico com confiança ainda ok; ou confiança muito baixa em qualquer campo
  if (temFalhaValidacao && critico)                        return 'ALTO';
  if (confianca < 50)                                      return 'ALTO';
  // ALTO: campo crítico com confiança baixa
  if (critico && confianca < 70)                           return 'ALTO';
  // MEDIO: confiança moderada, ou inferência em campo crítico
  if (confianca < 70)                                      return 'MEDIO';
  if (critico && (origem === 'FALLBACK_HEURISTICO' || origem === 'INFERENCIA')) return 'MEDIO';
  if (origem === 'INFERENCIA')                             return 'MEDIO';
  return 'BAIXO';
}

function buildMotivos(
  valor: string | null,
  confiancaAjustada: number,
  confiancaOriginal: number,
  origem: OrigemExtracao,
  metodo: string,
  validacoes: ValidationResult[],
  critico: boolean,
): string[] {
  const m: string[] = [];

  // Origem
  switch (origem) {
    case 'TEXTO_DIRETO':
      m.push('extraído por texto direto do PDF — máxima confiança de origem (+)');
      break;
    case 'OCR':
      m.push('extraído via OCR — possíveis erros de reconhecimento (-)');
      break;
    case 'FALLBACK_HEURISTICO':
      m.push(`extração por fallback heurístico (método: "${metodo}") — posição estimada (-)`);
      break;
    case 'INFERENCIA':
      m.push(`valor inferido ou ausente confirmado (método: "${metodo}") (--)`);
      break;
  }

  // Valor
  if (valor === null) m.push('campo sem valor — não localizado no PDF (--)');
  else                m.push('valor localizado e extraído (+)');

  // Validações
  const falhas  = validacoes.filter(v => !v.passed);
  const passes  = validacoes.filter(v => v.passed);
  if (passes.length > 0)  m.push(`${passes.length} validação(ões) de fase anterior aprovada(s) (+)`);
  falhas.forEach(f => m.push(`validação "${f.rule}" reprovada${f.detail ? `: ${f.detail}` : ''} (-)`));

  // Ajuste Phase 8
  const delta = confiancaAjustada - confiancaOriginal;
  if (delta < 0) m.push(`Fase 8 aplicou penalidade de ${Math.abs(delta).toFixed(1)} pts por origem/validação`);

  // Criticidade
  if (critico && confiancaAjustada >= 85) m.push('campo crítico com confiança suficiente — aprovado (+)');
  if (critico && confiancaAjustada < 70)  m.push('campo crítico com confiança insuficiente — revisão obrigatória (!!)');

  // Método específico
  if (metodo.includes('positional')) m.push('posicionado pelo fluxo do stream PDF — dependente da estrutura do layout');
  if (metodo.includes('anchor') || metodo.includes('label')) m.push('localizado via âncora de label no texto (+)');
  if (metodo.includes('magnitude')) m.push('atribuído por magnitude de valor — inferência de domínio');

  return m;
}

// ─── CÁLCULO POR CAMPO ────────────────────────────────────────────────────────

function computeCampo(nome: string, norm: CampoNorm): CampoConfianca {
  const cfg: CampoConfig = PESOS[nome] ?? { peso: 3, critico: false, secao: 'fiscal' };
  const { peso, critico, secao } = cfg;

  const origem   = classifyOrigin(norm.metodo);
  const original = norm.confianca;

  // Penalidades de Fase 8 sobre a confiança herdada da fase extratora
  let ajustada = original;
  if (origem === 'OCR')                ajustada -= 10;
  if (origem === 'FALLBACK_HEURISTICO') ajustada -= 15;
  if (origem === 'INFERENCIA')          ajustada -= 20;

  // Campo ausente confirma inferência → cap em 45
  if (norm.valor === null && origem === 'INFERENCIA') ajustada = Math.min(ajustada, 45);

  // Validações da fase extratora que falharam
  const falhas = norm.validacoes.filter(v => !v.passed);
  ajustada -= falhas.length * 5;

  ajustada = Math.min(100, Math.max(0, Math.round(ajustada * 10) / 10));

  const nivel = levelFor(ajustada);
  const risco = calcRisco(ajustada, critico, origem, falhas.length > 0 && critico);

  // Revisão mandatória apenas por confiança genuinamente baixa ou risco CRÍTICO.
  // Risco ALTO é reportado mas não bloqueia revisão automaticamente.
  const revisao_obrigatoria =
    (critico && ajustada < 70) ||
    ajustada < 50              ||
    risco === 'CRITICO';

  const motivos = buildMotivos(norm.valor, ajustada, original, origem, norm.metodo, norm.validacoes, critico);

  return { nome, secao, valor: norm.valor, confianca: ajustada, nivel, origem, peso, critico, risco, motivos, revisao_obrigatoria };
}

// ─── SCORE POR SEÇÃO ──────────────────────────────────────────────────────────

function computeSecao(campos: CampoConfianca[]): SecaoScore {
  if (campos.length === 0) {
    return { score: 0, nivel: 'MUITO_BAIXA', alertas: ['seção sem campos'], revisao_obrigatoria: true, campos_problematicos: [] };
  }

  const totalPeso = campos.reduce((s, c) => s + c.peso, 0);
  const score     = campos.reduce((s, c) => s + c.confianca * c.peso, 0) / totalPeso;

  const alertas: string[] = [];
  campos.forEach(c => {
    if (c.critico  && c.confianca < 70)   alertas.push(`Campo crítico "${c.nome}": ${c.confianca.toFixed(1)}%`);
    if (c.risco === 'CRITICO')             alertas.push(`Risco CRÍTICO — "${c.nome}"`);
    else if (c.risco === 'ALTO')           alertas.push(`Risco ALTO — "${c.nome}"`);
  });

  const campos_problematicos = campos
    .filter(c => c.revisao_obrigatoria || c.confianca < 70)
    .map(c => c.nome);

  // Seção requer revisão quando algum campo crítico tem confiança abaixo de 70%
  // (não apenas por risco ALTO, para evitar falsos positivos com campos ausentes não-críticos).
  const revisao_obrigatoria =
    campos.some(c => c.critico && c.confianca < 70) ||
    score < 70;

  return {
    score: Math.round(score * 10) / 10,
    nivel: levelFor(score),
    alertas,
    revisao_obrigatoria,
    campos_problematicos,
  };
}

// ─── SCORE OCR ────────────────────────────────────────────────────────────────

/**
 * Mede qualidade da camada de texto do PDF.
 * PDF digital puro → 100%. PDF com OCR → reduz conforme cobertura OCR.
 * Score ponderado pelo peso do campo para não deixar campos auxiliares mascarar problemas em críticos.
 */
function computeScoreOCR(campos: CampoConfianca[]): number {
  const totalPeso = campos.reduce((s, c) => s + c.peso, 0);
  if (totalPeso === 0) return 0;

  const ocrImpact = campos.reduce((s, c) => {
    let penalidade = 0;
    if (c.origem === 'OCR')                 penalidade = 15;
    else if (c.origem === 'FALLBACK_HEURISTICO') penalidade = 8;
    else if (c.origem === 'INFERENCIA' && c.valor !== null) penalidade = 5;
    return s + penalidade * c.peso;
  }, 0) / totalPeso;

  return Math.min(100, Math.max(0, Math.round((100 - ocrImpact) * 10) / 10));
}

// ─── SCORE ESTRUTURAL ─────────────────────────────────────────────────────────

/**
 * Mede se o motor detectou corretamente as zonas do PDF.
 * 100% → todos os blocos identificados por âncoras semânticas.
 * Penaliza zonas ausentes ou detectadas por fallback posicional.
 */
function computeScoreEstrutural(
  prestador:  PrestadorResult,
  tomador:    TomadorResult,
  servico:    ServicoResult,
  financeiro: FinanceiroResult,
  tributario: TributarioResult,
): number {
  let score = 0;

  // Bloco prestador (20 pts)
  const prestEst = prestador.zona.estrategia.toLowerCase();
  if (!prestEst.includes('nao_detectada') && !prestEst.includes('fallback_posicional')) score += 20;
  else if (prestEst.includes('fallback'))  score += 8;
  else                                     score += 0;

  // Bloco tomador (20 pts)
  const tomEst = tomador.zona.estrategia.toLowerCase();
  if (!tomEst.includes('nao_detectada') && !tomEst.includes('fallback_posicional')) score += 20;
  else if (tomEst.includes('fallback'))   score += 8;
  else                                    score += 0;

  // Bloco serviços (20 pts)
  const srvEst = servico.zona.estrategia.toLowerCase();
  if (!srvEst.includes('nao_detectada') && !srvEst.includes('fallback_posicional')) score += 20;
  else if (srvEst.includes('fallback'))   score += 8;
  else                                    score += 0;

  // Bloco financeiro / retenções (20 pts)
  const finEst = financeiro.zonas.retencao.estrategia.toLowerCase();
  if (!finEst.includes('nao_detectada') && !finEst.includes('fallback_posicional')) score += 20;
  else if (finEst.includes('fallback'))   score += 8;
  else                                    score += 0;

  // Bloco fiscal / OUTRAS INFORMAÇÕES (20 pts)
  const c = tributario.classificacao;
  const camposFiscaisDetectados = [
    c.natureza_operacao, c.situacao_issqn, c.situacao_nfse, c.local_prestacao,
  ].filter(Boolean).length;
  score += Math.round(camposFiscaisDetectados / 4 * 20);

  return Math.min(100, score);
}

// ─── REGRAS DE BLOQUEIO ───────────────────────────────────────────────────────

/**
 * Retorna bloqueado=true quando o risco é demasiado alto para processamento automático.
 * O bloqueio é conservador: preferimos parar do que processar uma nota incorreta.
 *
 * Regras (por ordem de prioridade):
 *  B1 — Campo crítico com risco CRITICO
 *  B2 — Campo crítico com confiança < 50%
 *  B3 — Regra fiscal REPROVADO com severidade CRITICO (do motor tributário)
 *  B4 — Score global < 60%
 */
function checkBloqueio(
  campos:      CampoConfianca[],
  globalScore: number,
  tributario:  TributarioResult,
): { bloqueado: boolean; motivo_bloqueio?: string } {
  // B1
  const critRisco = campos.find(c => c.critico && c.risco === 'CRITICO');
  if (critRisco) {
    return { bloqueado: true, motivo_bloqueio: `[B1] Campo crítico "${critRisco.nome}" com risco CRÍTICO (confiança ${critRisco.confianca.toFixed(1)}%)` };
  }

  // B2
  const critBaixo = campos.find(c => c.critico && c.confianca < 50);
  if (critBaixo) {
    return { bloqueado: true, motivo_bloqueio: `[B2] Campo crítico "${critBaixo.nome}" com confiança ${critBaixo.confianca.toFixed(1)}% abaixo do limite mínimo (50%)` };
  }

  // B3
  const regraFatal = tributario.regras.find(r => r.resultado === 'REPROVADO' && r.severidade === 'CRITICO');
  if (regraFatal) {
    return { bloqueado: true, motivo_bloqueio: `[B3] Regra fiscal crítica reprovada: ${regraFatal.codigo} — ${regraFatal.descricao}` };
  }

  // B4
  if (globalScore < 60) {
    return { bloqueado: true, motivo_bloqueio: `[B4] Score global ${globalScore.toFixed(1)}% abaixo do limite mínimo de 60%` };
  }

  return { bloqueado: false };
}

// ─── EXPLICABILIDADE ──────────────────────────────────────────────────────────

function buildExplicacao(
  campos:     CampoConfianca[],
  global:     number,
  ocr:        number,
  estrutural: number,
  fiscal:     number,
): ConfiancaResult['explicacao'] {
  const positivos: string[] = [];
  const negativos: string[] = [];
  const acoes:     string[] = [];

  // Score global
  if (global >= 95)      positivos.push(`Score global MUITO ALTA: ${global.toFixed(1)}% — nota aprovada para processamento automático`);
  else if (global >= 85) positivos.push(`Score global ALTA: ${global.toFixed(1)}% — nota aprovada com revisão opcional`);
  else if (global >= 70) negativos.push(`Score global MÉDIA: ${global.toFixed(1)}% — nota requer atenção antes do processamento`);
  else                   negativos.push(`Score global BAIXA: ${global.toFixed(1)}% — nota requer revisão obrigatória`);

  // Score OCR
  if (ocr >= 98)       positivos.push(`Score OCR: ${ocr.toFixed(1)}% — PDF digital com texto de alta qualidade`);
  else if (ocr >= 85)  positivos.push(`Score OCR: ${ocr.toFixed(1)}% — extração majoritariamente por texto direto`);
  else if (ocr < 80) { negativos.push(`Score OCR: ${ocr.toFixed(1)}% — alto uso de OCR ou fallback heurístico`); acoes.push('Verificar se o PDF é digitalizado ou contém imagens'); }

  // Score estrutural
  if (estrutural >= 95)      positivos.push(`Score estrutural: ${estrutural.toFixed(1)}% — todos os blocos identificados por âncoras semânticas`);
  else if (estrutural >= 80) positivos.push(`Score estrutural: ${estrutural.toFixed(1)}% — maioria dos blocos identificados`);
  else                     { negativos.push(`Score estrutural: ${estrutural.toFixed(1)}% — um ou mais blocos com dificuldade de identificação`); acoes.push('Revisar o layout do PDF — possível mudança de template'); }

  // Score fiscal
  if (fiscal >= 95)      positivos.push(`Score fiscal: ${fiscal.toFixed(1)}% — todas as regras tributárias aprovadas`);
  else if (fiscal >= 85) positivos.push(`Score fiscal: ${fiscal.toFixed(1)}% — motor tributário aprovado com avisos`);
  else                 { negativos.push(`Score fiscal: ${fiscal.toFixed(1)}% — inconsistências tributárias detectadas`); acoes.push('Verificar regras fiscais reprovadas no motor tributário (Fase 7)'); }

  // Campos críticos
  const critOk   = campos.filter(c => c.critico && c.confianca >= 85);
  const critProb = campos.filter(c => c.critico && c.confianca < 85);
  if (critOk.length > 0) positivos.push(`${critOk.length}/${critOk.length + critProb.length} campos críticos com alta confiança`);
  critProb.forEach(c => {
    negativos.push(`Campo crítico "${c.nome}": ${c.confianca.toFixed(1)}% [${c.nivel}] via ${c.origem}`);
    acoes.push(`Revisar campo "${c.nome}" — origem: ${c.origem}, método: "${campos.find(x => x.nome === c.nome)?.motivos[0] ?? '?'}"`);
  });

  // Origem por tipo
  const porOrigem: Record<OrigemExtracao, number> = {
    TEXTO_DIRETO: 0, OCR: 0, FALLBACK_HEURISTICO: 0, INFERENCIA: 0,
  };
  campos.forEach(c => { porOrigem[c.origem]++; });
  if (porOrigem.TEXTO_DIRETO === campos.length)
    positivos.push('100% dos campos extraídos por texto direto — sem OCR ou fallback');
  if (porOrigem.FALLBACK_HEURISTICO > 0)
    negativos.push(`${porOrigem.FALLBACK_HEURISTICO} campo(s) extraídos por fallback heurístico`);
  if (porOrigem.INFERENCIA > 0 && porOrigem.INFERENCIA > 5)
    negativos.push(`${porOrigem.INFERENCIA} campos ausentes/inferidos — verificar template`);

  if (negativos.length === 0 && acoes.length === 0)
    acoes.push('Nota aprovada — processamento automático habilitado');

  const metodologia =
    'Score global = média ponderada das seções ' +
    '(Cabeçalho 25%, Prestador 20%, Tomador 20%, Serviços 15%, Financeiro 15%, Fiscal 5%). ' +
    'Score por seção = média ponderada dos campos (peso 1-15 conforme criticidade jurídica/fiscal). ' +
    'Score por campo = confiança da fase extratora ajustada pela Fase 8: ' +
    '-20 pts por inferência, -15 pts por fallback heurístico, -10 pts por OCR, ' +
    '-5 pts por falha de validação. ' +
    'Score OCR = impacto ponderado do tipo de extração sobre a qualidade da camada de texto. ' +
    'Score estrutural = soma das zonas detectadas por âncoras semânticas (20 pts/zona, 5 blocos). ' +
    'Score fiscal = confiança calculada pelo motor tributário (Fase 7, 15 regras). ' +
    'Bloqueio ativo em: campo crítico risco CRÍTICO, campo crítico <50%, regra fiscal REPROVADO CRITICO, score global <60%.';

  return { fatores_positivos: positivos, fatores_negativos: negativos, acoes_recomendadas: acoes, metodologia };
}

function buildResumo(
  global:      number,
  block:       { bloqueado: boolean; motivo_bloqueio?: string },
  campos:      CampoConfianca[],
  secoes:      ConfiancaResult['secoes'],
): string {
  if (block.bloqueado) {
    return `BLOQUEADO — ${block.motivo_bloqueio}. Score global: ${global.toFixed(1)}%.`;
  }

  const nivel = levelFor(global);
  const nivelLabels: Record<NivelConfianca, string> = {
    MUITO_ALTA: 'MUITO ALTA', ALTA: 'ALTA', MEDIA: 'MÉDIA', BAIXA: 'BAIXA', MUITO_BAIXA: 'MUITO BAIXA',
  };

  const critOk   = campos.filter(c => c.critico && c.confianca >= 85).length;
  const critTotal = campos.filter(c => c.critico).length;
  const revisao  = Object.values(secoes).some(s => s.revisao_obrigatoria);

  return (
    `NFS-e com confiança ${nivelLabels[nivel]} (${global.toFixed(1)}%). ` +
    `${critOk}/${critTotal} campos críticos aprovados. ` +
    (revisao ? 'Revisão obrigatória identificada em uma ou mais seções.' : 'Nenhuma revisão obrigatória — aprovada para processamento automático.')
  );
}

// ─── ENTRADA PRINCIPAL ────────────────────────────────────────────────────────

/**
 * Calcula o sistema de confiança global a partir dos resultados das fases 2-7.
 *
 * @param input  Objeto com todos os resultados das fases anteriores.
 * @returns      ConfiancaResult com scores por campo, seção, nota e explicação completa.
 */
export function calculateConfiancaGlobal(input: ConfiancaInput): ConfiancaResult {
  const t0 = Date.now();
  const all: CampoConfianca[] = [];

  // ── Fase 2 — Cabeçalho (FieldResult em inglês) ───────────────────────────
  all.push(computeCampo('numero_nota',        fromFieldResult(input.critical.numeroNota)));
  all.push(computeCampo('codigo_verificacao', fromFieldResult(input.critical.codigoVerificacao)));
  all.push(computeCampo('data_emissao',       fromFieldResult(input.critical.dataEmissao)));
  all.push(computeCampo('data_fato_gerador',  fromFieldResult(input.critical.dataFatoGerador)));

  // ── Fase 3 — Prestador ────────────────────────────────────────────────────
  const p = input.prestador.prestador;
  all.push(computeCampo('cpf_cnpj_prestador',            fromPtField(p.cpf_cnpj)));
  all.push(computeCampo('razao_social_prestador',        fromPtField(p.razao_social)));
  all.push(computeCampo('nome_fantasia_prestador',       fromPtField(p.nome_fantasia)));
  all.push(computeCampo('inscricao_municipal_prestador', fromPtField(p.inscricao_municipal)));
  all.push(computeCampo('inscricao_estadual_prestador',  fromPtField(p.inscricao_estadual)));
  all.push(computeCampo('endereco_prestador',            fromPtField(p.endereco)));
  all.push(computeCampo('numero_prestador',              fromPtField(p.numero)));
  all.push(computeCampo('complemento_prestador',         fromPtField(p.complemento)));
  all.push(computeCampo('bairro_prestador',              fromPtField(p.bairro)));
  all.push(computeCampo('cep_prestador',                 fromPtField(p.cep)));
  all.push(computeCampo('municipio_prestador',           fromPtField(p.municipio)));
  all.push(computeCampo('uf_prestador',                  fromPtField(p.uf)));
  all.push(computeCampo('email_prestador',               fromPtField(p.email)));
  all.push(computeCampo('telefone_prestador',            fromPtField(p.telefone)));
  all.push(computeCampo('celular_prestador',             fromPtField(p.celular)));
  all.push(computeCampo('site_prestador',                fromPtField(p.site)));

  // ── Fase 4 — Tomador ──────────────────────────────────────────────────────
  const t = input.tomador.tomador;
  all.push(computeCampo('cpf_cnpj_tomador',              fromPtField(t.cpf_cnpj)));
  all.push(computeCampo('razao_social_tomador',          fromPtField(t.razao_social)));
  all.push(computeCampo('nome_fantasia_tomador',         fromPtField(t.nome_fantasia)));
  all.push(computeCampo('inscricao_municipal_tomador',   fromPtField(t.inscricao_municipal)));
  all.push(computeCampo('inscricao_estadual_tomador',    fromPtField(t.inscricao_estadual)));
  all.push(computeCampo('endereco_tomador',              fromPtField(t.endereco)));
  all.push(computeCampo('numero_tomador',                fromPtField(t.numero)));
  all.push(computeCampo('complemento_tomador',           fromPtField(t.complemento)));
  all.push(computeCampo('bairro_tomador',                fromPtField(t.bairro)));
  all.push(computeCampo('cep_tomador',                   fromPtField(t.cep)));
  all.push(computeCampo('municipio_tomador',             fromPtField(t.municipio)));
  all.push(computeCampo('uf_tomador',                    fromPtField(t.uf)));
  all.push(computeCampo('email_tomador',                 fromPtField(t.email)));
  all.push(computeCampo('telefone_tomador',              fromPtField(t.telefone)));
  all.push(computeCampo('celular_tomador',               fromPtField(t.celular)));
  all.push(computeCampo('site_tomador',                  fromPtField(t.site)));

  // ── Fase 5 — Serviços ─────────────────────────────────────────────────────
  const s = input.servico.servico;
  all.push(computeCampo('descricao_servico',      fromPtField(s.descricao)));
  all.push(computeCampo('of_servico',             fromPtField(s.of)));
  all.push(computeCampo('quantidade_servico',     fromPtField(s.quantidade)));
  all.push(computeCampo('valor_unitario_servico', fromPtField(s.valor_unitario)));
  all.push(computeCampo('valor_servico',          fromPtField(s.valor_servico)));
  all.push(computeCampo('base_calculo_servico',   fromPtField(s.base_calculo)));
  all.push(computeCampo('aliquota_iss_servico',   fromPtField(s.aliquota_iss)));
  all.push(computeCampo('valor_iss_servico',      fromPtField(s.valor_iss)));
  all.push(computeCampo('codigo_servico',         fromPtField(s.codigo_servico)));

  // ── Fase 6 — Financeiro ───────────────────────────────────────────────────
  const f = input.financeiro.financeiro;
  all.push(computeCampo('valor_servico_fin',         fromPtField(f.valor_servico)));
  all.push(computeCampo('valor_bruto',               fromPtField(f.valor_bruto)));
  all.push(computeCampo('valor_liquido',             fromPtField(f.valor_liquido)));
  all.push(computeCampo('base_calculo_fin',          fromPtField(f.base_calculo)));
  all.push(computeCampo('aliquota_iss_fin',          fromPtField(f.aliquota_iss)));
  all.push(computeCampo('valor_iss_fin',             fromPtField(f.valor_iss)));
  all.push(computeCampo('ir',                        fromPtField(f.ir)));
  all.push(computeCampo('pis_pasep',                 fromPtField(f.pis_pasep)));
  all.push(computeCampo('cofins',                    fromPtField(f.cofins)));
  all.push(computeCampo('inss',                      fromPtField(f.inss)));
  all.push(computeCampo('csll',                      fromPtField(f.csll)));
  all.push(computeCampo('outras_retencoes',          fromPtField(f.outras_retencoes)));
  all.push(computeCampo('valor_aproximado_tributos', fromPtField(f.valor_aproximado_tributos)));
  all.push(computeCampo('valor_liquido_antecipacao', fromPtField(f.valor_liquido_antecipacao)));
  all.push(computeCampo('total_tributos_encargos',   fromPtField(f.total_tributos_encargos)));

  // ── Fase 7 — Fiscal (campos classificatórios, sem FieldResult próprio) ────
  const cl = input.tributario.classificacao;

  const confRegime   = cl.regime_tributario   !== 'DESCONHECIDO' ? 88 : 30;
  const metodoRegime = cl.regime_tributario   !== 'DESCONHECIDO' ? 'identificado_por_texto_simples_nacional' : 'campo_ausente';
  all.push(computeCampo('regime_tributario', syntheticField(cl.regime_tributario, confRegime, metodoRegime)));

  const confIssRet   = cl.situacao_issqn !== null ? 92 : 40;
  const metIssRet    = cl.situacao_issqn !== null ? 'derivado_situacao_issqn_retencao' : 'campo_ausente';
  all.push(computeCampo('iss_retido', syntheticField(cl.iss_retido, confIssRet, metIssRet)));

  const confResp     = cl.responsavel_iss !== 'INDEFINIDO' ? 88 : 30;
  const metResp      = cl.responsavel_iss !== 'INDEFINIDO' ? 'derivado_situacao_issqn' : 'campo_ausente';
  all.push(computeCampo('responsavel_iss', syntheticField(cl.responsavel_iss, confResp, metResp)));

  all.push(computeCampo('natureza_operacao', syntheticField(
    cl.natureza_operacao, cl.natureza_operacao !== null ? 90 : 20,
    cl.natureza_operacao !== null ? 'label_natureza_operacao' : 'campo_ausente'
  )));
  all.push(computeCampo('situacao_issqn', syntheticField(
    cl.situacao_issqn, cl.situacao_issqn !== null ? 92 : 20,
    cl.situacao_issqn !== null ? 'label_situacao_issqn' : 'campo_ausente'
  )));
  all.push(computeCampo('situacao_nfse', syntheticField(
    cl.situacao_nfse, cl.situacao_nfse !== null ? 92 : 20,
    cl.situacao_nfse !== null ? 'label_situacao_nfse' : 'campo_ausente'
  )));
  all.push(computeCampo('local_prestacao', syntheticField(
    cl.local_prestacao, cl.local_prestacao !== null ? 90 : 20,
    cl.local_prestacao !== null ? 'label_local_prestacao' : 'campo_ausente'
  )));

  // ── Scores por seção ──────────────────────────────────────────────────────
  const bySec = (sec: SecaoNome) => all.filter(c => c.secao === sec);
  const secoes = {
    cabecalho:  computeSecao(bySec('cabecalho')),
    prestador:  computeSecao(bySec('prestador')),
    tomador:    computeSecao(bySec('tomador')),
    servicos:   computeSecao(bySec('servicos')),
    financeiro: computeSecao(bySec('financeiro')),
    fiscal:     computeSecao(bySec('fiscal')),
  };

  // ── Score global (média ponderada das seções) ─────────────────────────────
  const totalPesoSec   = Object.values(PESO_SECAO).reduce((a, b) => a + b, 0);
  const score_global   = Object.entries(secoes).reduce((sum, [sec, s]) =>
    sum + s.score * PESO_SECAO[sec as SecaoNome] / totalPesoSec, 0);

  // ── Score OCR / Estrutural / Fiscal ───────────────────────────────────────
  const score_ocr        = computeScoreOCR(all);
  const score_estrutural = computeScoreEstrutural(input.prestador, input.tomador, input.servico, input.financeiro, input.tributario);
  const score_fiscal     = input.tributario.confianca_fiscal;

  // ── Bloqueio ──────────────────────────────────────────────────────────────
  const blockResult = checkBloqueio(all, score_global, input.tributario);

  // ── Flag revisão global ───────────────────────────────────────────────────
  const revisao_obrigatoria =
    Object.values(secoes).some(s => s.revisao_obrigatoria) ||
    score_global < 70 ||
    blockResult.bloqueado;

  // ── Mapa de campos ────────────────────────────────────────────────────────
  const campos: Record<string, CampoConfianca> = {};
  all.forEach(c => { campos[c.nome] = c; });

  // ── Explicação e resumo ───────────────────────────────────────────────────
  const explicacao = buildExplicacao(all, score_global, score_ocr, score_estrutural, score_fiscal);
  const resumo     = buildResumo(score_global, blockResult, all, secoes);

  return {
    score_global:        Math.round(score_global   * 10) / 10,
    score_ocr:           Math.round(score_ocr       * 10) / 10,
    score_estrutural:    Math.round(score_estrutural * 10) / 10,
    score_fiscal,
    nivel_global:        levelFor(score_global),
    revisao_obrigatoria,
    ...blockResult,
    secoes,
    campos,
    explicacao,
    resumo,
    calculoMs: Date.now() - t0,
  };
}
