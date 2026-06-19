/**
 * Fase 9 — Dupla Extração, Validação Cruzada e Resolução de Conflitos
 *
 * Orquestra dois caminhos de extração independentes:
 *   Método A — Extração Estrutural (âncoras + zonas, Fases 2-7)
 *   Método B — Extração Semântica (padrões de rótulo, full-text, ordinal)
 *
 * Compara campo a campo, classifica concordância, resolve conflitos e
 * produz um resultado final consolidado com rastreabilidade completa.
 */

import { extractCriticalFields } from './critical-fields';
import { extractPrestador }       from './prestador';
import { extractTomador }         from './tomador';
import { extractServico }         from './servico';
import { extractFinanceiro }      from './financeiro';
import { analyzeTributario }      from './tributario';
import { extractMetodoB }         from './extracao-b';
import { classifyConcordance }    from './normalizador';
import type { NormTipo, TipoConcordancia } from './normalizador';

// ─── TIPOS PÚBLICOS ───────────────────────────────────────────────────────────

export type OrigemCampo = 'EXPLICITO' | 'DERIVADO' | 'INFERIDO' | 'AUSENTE';

export interface NF9CampoResult {
  valor:     string | null;
  confianca: number;
  metodo:    string;
  origem:    OrigemCampo;
}

export interface NF9Resultado {
  cabecalho: {
    numero_nota:        NF9CampoResult;
    codigo_verificacao: NF9CampoResult;
    data_emissao:       NF9CampoResult;
    data_fato_gerador:  NF9CampoResult;
  };
  prestador: {
    razao_social:        NF9CampoResult;
    nome_fantasia:       NF9CampoResult;
    cpf_cnpj:            NF9CampoResult;
    inscricao_municipal: NF9CampoResult;
    municipio:           NF9CampoResult;
    uf:                  NF9CampoResult;
    email:               NF9CampoResult;
    telefone:            NF9CampoResult;
    endereco:            NF9CampoResult;
    cep:                 NF9CampoResult;
  };
  tomador: {
    razao_social:        NF9CampoResult;
    nome_fantasia:       NF9CampoResult;
    cpf_cnpj:            NF9CampoResult;
    inscricao_municipal: NF9CampoResult;
    municipio:           NF9CampoResult;
    uf:                  NF9CampoResult;
    email:               NF9CampoResult;
    telefone:            NF9CampoResult;
    endereco:            NF9CampoResult;
    cep:                 NF9CampoResult;
  };
  servico: {
    descricao:      NF9CampoResult;
    of:             NF9CampoResult;
    quantidade:     NF9CampoResult;
    valor_unitario: NF9CampoResult;
    valor_servico:  NF9CampoResult;
    codigo_servico: NF9CampoResult;
  };
  financeiro: {
    valor_bruto:               NF9CampoResult;
    valor_liquido:             NF9CampoResult;
    base_calculo:              NF9CampoResult;
    aliquota_iss:              NF9CampoResult;
    valor_iss:                 NF9CampoResult;
    ir:                        NF9CampoResult;
    pis_pasep:                 NF9CampoResult;
    cofins:                    NF9CampoResult;
    inss:                      NF9CampoResult;
    csll:                      NF9CampoResult;
    outras_retencoes:          NF9CampoResult;
    valor_aproximado_tributos: NF9CampoResult;
    valor_servico_fin:         NF9CampoResult;
  };
  fiscal: {
    natureza_operacao: NF9CampoResult;
    situacao_issqn:    NF9CampoResult;
    local_prestacao:   NF9CampoResult;
    situacao_nfse:     NF9CampoResult;
    iss_retido:        NF9CampoResult;
    regime_tributario: NF9CampoResult;
  };
  extractionMs: number;
}

export interface CampoComparado {
  campo:             string;
  secao:             string;
  critico:           boolean;
  metodo_a:          NF9CampoResult;
  metodo_b:          NF9CampoResult;
  valor_norm_a:      string | null;
  valor_norm_b:      string | null;
  tipo_concordancia: TipoConcordancia;
  resultado_final: {
    valor:           string | null;
    confianca:       number;
    metodo_vencedor: 'A' | 'B' | 'AMBOS' | 'NENHUM';
    origem:          OrigemCampo;
  };
  revisao_obrigatoria: boolean;
  explicacao:          string;
}

export interface ValidacaoCruzadaResult {
  metodo_a:   NF9Resultado;
  metodo_b:   NF9Resultado;
  comparacao: CampoComparado[];
  resultado_final_consolidado: {
    campos:              Record<string, { valor: string | null; confianca: number; origem: OrigemCampo; secao: string }>;
    confianca_global:    number;
    revisao_obrigatoria: boolean;
    campos_derivados:    string[];
    alertas:             string[];
    bloqueado:           boolean;
    motivo_bloqueio?:    string;
  };
  estatisticas: {
    total_campos:          number;
    concordancia_total:    number;
    concordancia_funcional: number;
    divergencia_leve:      number;
    divergencia_moderada:  number;
    divergencia_critica:   number;
    taxa_concordancia:     number;
  };
  extractionMs: number;
}

// ─── MAPEAMENTO DE CAMPOS PARA COMPARAÇÃO ────────────────────────────────────

interface CampoMeta {
  secao:   string;
  critico: boolean;
  norm:    NormTipo;
}

const CAMPO_META: Record<string, CampoMeta> = {
  // Cabeçalho
  numero_nota:                   { secao: 'cabecalho',  critico: true,  norm: 'raw'     },
  codigo_verificacao:            { secao: 'cabecalho',  critico: true,  norm: 'raw'     },
  data_emissao:                  { secao: 'cabecalho',  critico: true,  norm: 'date'    },
  data_fato_gerador:             { secao: 'cabecalho',  critico: false, norm: 'date'    },
  // Prestador
  'prestador.razao_social':      { secao: 'prestador',  critico: true,  norm: 'text'    },
  'prestador.nome_fantasia':     { secao: 'prestador',  critico: false, norm: 'text'    },
  'prestador.cpf_cnpj':          { secao: 'prestador',  critico: true,  norm: 'cnpj'    },
  'prestador.inscricao_municipal': { secao: 'prestador', critico: false, norm: 'raw'    },
  'prestador.municipio':         { secao: 'prestador',  critico: false, norm: 'text'    },
  'prestador.uf':                { secao: 'prestador',  critico: false, norm: 'raw'     },
  'prestador.email':             { secao: 'prestador',  critico: false, norm: 'raw'     },
  'prestador.telefone':          { secao: 'prestador',  critico: false, norm: 'raw'     },
  'prestador.endereco':          { secao: 'prestador',  critico: false, norm: 'text'    },
  'prestador.cep':               { secao: 'prestador',  critico: false, norm: 'raw'     },
  // Tomador
  'tomador.razao_social':        { secao: 'tomador',    critico: true,  norm: 'text'    },
  'tomador.nome_fantasia':       { secao: 'tomador',    critico: false, norm: 'text'    },
  'tomador.cpf_cnpj':            { secao: 'tomador',    critico: true,  norm: 'cnpj'    },
  'tomador.inscricao_municipal': { secao: 'tomador',    critico: false, norm: 'raw'     },
  'tomador.municipio':           { secao: 'tomador',    critico: false, norm: 'text'    },
  'tomador.uf':                  { secao: 'tomador',    critico: false, norm: 'raw'     },
  'tomador.email':               { secao: 'tomador',    critico: false, norm: 'raw'     },
  'tomador.telefone':            { secao: 'tomador',    critico: false, norm: 'raw'     },
  'tomador.endereco':            { secao: 'tomador',    critico: false, norm: 'text'    },
  'tomador.cep':                 { secao: 'tomador',    critico: false, norm: 'raw'     },
  // Serviços
  'servico.descricao':           { secao: 'servicos',   critico: false, norm: 'text'    },
  'servico.of':                  { secao: 'servicos',   critico: false, norm: 'raw'     },
  'servico.quantidade':          { secao: 'servicos',   critico: false, norm: 'money'   },
  'servico.valor_unitario':      { secao: 'servicos',   critico: false, norm: 'money'   },
  'servico.valor_servico':       { secao: 'servicos',   critico: true,  norm: 'money'   },
  'servico.codigo_servico':      { secao: 'servicos',   critico: false, norm: 'raw'     },
  // Financeiro
  valor_bruto:                   { secao: 'financeiro', critico: true,  norm: 'money'   },
  valor_liquido:                 { secao: 'financeiro', critico: true,  norm: 'money'   },
  base_calculo:                  { secao: 'financeiro', critico: false, norm: 'money'   },
  aliquota_iss:                  { secao: 'financeiro', critico: true,  norm: 'percent' },
  valor_iss:                     { secao: 'financeiro', critico: true,  norm: 'money'   },
  ir:                            { secao: 'financeiro', critico: false, norm: 'money'   },
  pis_pasep:                     { secao: 'financeiro', critico: false, norm: 'money'   },
  cofins:                        { secao: 'financeiro', critico: false, norm: 'money'   },
  inss:                          { secao: 'financeiro', critico: false, norm: 'money'   },
  csll:                          { secao: 'financeiro', critico: false, norm: 'money'   },
  outras_retencoes:              { secao: 'financeiro', critico: false, norm: 'money'   },
  valor_aproximado_tributos:     { secao: 'financeiro', critico: false, norm: 'money'   },
  valor_servico_fin:             { secao: 'financeiro', critico: true,  norm: 'money'   },
  // Fiscal
  natureza_operacao:             { secao: 'fiscal',     critico: false, norm: 'text'    },
  situacao_issqn:                { secao: 'fiscal',     critico: false, norm: 'text'    },
  local_prestacao:               { secao: 'fiscal',     critico: false, norm: 'text'    },
  situacao_nfse:                 { secao: 'fiscal',     critico: false, norm: 'text'    },
  iss_retido:                    { secao: 'fiscal',     critico: true,  norm: 'boolean' },
  regime_tributario:             { secao: 'fiscal',     critico: false, norm: 'raw'     },
};

// ─── MÉTODO A — WRAPPER ───────────────────────────────────────────────────────

function wrapField(
  valor: string | null,
  confianca: number,
  metodo: string,
  origem: OrigemCampo = 'EXPLICITO',
): NF9CampoResult {
  return { valor, confianca, metodo, origem };
}

function origemFromMetodo(metodo: string): OrigemCampo {
  const m = metodo.toLowerCase();
  if (m === 'campo_ausente' || m === 'nao_presente') return 'AUSENTE';
  if (m.startsWith('derivado_') || m.includes('derivado')) return 'DERIVADO';
  if (m.includes('inferido') || m.includes('heuristic_fallback') || m.includes('pessoa_fisica_fallback')) return 'INFERIDO';
  return 'EXPLICITO';
}

async function buildMetodoA(pdfBuffer: Buffer): Promise<NF9Resultado> {
  const t0 = Date.now();

  const [critR, prestR, tomR, servR, finR] = await Promise.all([
    extractCriticalFields(pdfBuffer),
    extractPrestador(pdfBuffer),
    extractTomador(pdfBuffer),
    extractServico(pdfBuffer),
    extractFinanceiro(pdfBuffer),
  ]);

  const f   = finR.financeiro;
  const s   = servR.servico;
  const p   = prestR.prestador;
  const t   = tomR.tomador;
  const cr  = critR;

  const valores = {
    valor_bruto:      f.valor_bruto.valor,
    valor_liquido:    f.valor_liquido.valor,
    valor_iss:        f.valor_iss.valor,
    base_calculo:     f.base_calculo.valor,
    aliquota_iss:     f.aliquota_iss.valor,
    ir:               f.ir.valor,
    pis_pasep:        f.pis_pasep.valor,
    cofins:           f.cofins.valor,
    inss:             f.inss.valor,
    csll:             f.csll.valor,
    outras_retencoes: f.outras_retencoes.valor,
    codigo_servico:   s.codigo_servico.valor,
  };
  const tribR = await analyzeTributario(pdfBuffer, valores);
  const cl    = tribR.classificacao;

  const pt = (f: { valor: string | null; confianca: number; metodo: string }): NF9CampoResult =>
    wrapField(f.valor, f.confianca, f.metodo, origemFromMetodo(f.metodo));

  const ptCrit = (f: { value: string | null; confidence: number; method: string }): NF9CampoResult =>
    wrapField(f.value, f.confidence, f.method, origemFromMetodo(f.method));

  const clCampo = (valor: string | null, conf: number, met: string, orig: OrigemCampo): NF9CampoResult =>
    wrapField(valor, conf, met, orig);

  return {
    cabecalho: {
      numero_nota:        ptCrit(cr.numeroNota),
      codigo_verificacao: ptCrit(cr.codigoVerificacao),
      data_emissao:       ptCrit(cr.dataEmissao),
      data_fato_gerador:  ptCrit(cr.dataFatoGerador),
    },
    prestador: {
      razao_social:        pt(p.razao_social),
      nome_fantasia:       pt(p.nome_fantasia),
      cpf_cnpj:            pt(p.cpf_cnpj),
      inscricao_municipal: pt(p.inscricao_municipal),
      municipio:           pt(p.municipio),
      uf:                  pt(p.uf),
      email:               pt(p.email),
      telefone:            pt(p.telefone),
      endereco:            pt(p.endereco),
      cep:                 pt(p.cep),
    },
    tomador: {
      razao_social:        pt(t.razao_social),
      nome_fantasia:       pt(t.nome_fantasia),
      cpf_cnpj:            pt(t.cpf_cnpj),
      inscricao_municipal: pt(t.inscricao_municipal),
      municipio:           pt(t.municipio),
      uf:                  pt(t.uf),
      email:               pt(t.email),
      telefone:            pt(t.telefone),
      endereco:            pt(t.endereco),
      cep:                 pt(t.cep),
    },
    servico: {
      descricao:      pt(s.descricao),
      of:             pt(s.of),
      quantidade:     pt(s.quantidade),
      valor_unitario: pt(s.valor_unitario),
      valor_servico:  pt(s.valor_servico),
      codigo_servico: pt(s.codigo_servico),
    },
    financeiro: {
      valor_bruto:               pt(f.valor_bruto),
      valor_liquido:             pt(f.valor_liquido),
      base_calculo:              pt(f.base_calculo),
      aliquota_iss:              pt(f.aliquota_iss),
      valor_iss:                 pt(f.valor_iss),
      ir:                        pt(f.ir),
      pis_pasep:                 pt(f.pis_pasep),
      cofins:                    pt(f.cofins),
      inss:                      pt(f.inss),
      csll:                      pt(f.csll),
      outras_retencoes:          pt(f.outras_retencoes),
      valor_aproximado_tributos: pt(f.valor_aproximado_tributos),
      valor_servico_fin:         pt(f.valor_servico),  // valor_servico no bloco financeiro
    },
    fiscal: {
      natureza_operacao: clCampo(cl.natureza_operacao, cl.natureza_operacao ? 90 : 0,
        'label_natureza_operacao_a', cl.natureza_operacao ? 'EXPLICITO' : 'AUSENTE'),
      situacao_issqn:    clCampo(cl.situacao_issqn, cl.situacao_issqn ? 92 : 0,
        'label_situacao_issqn_a', cl.situacao_issqn ? 'EXPLICITO' : 'AUSENTE'),
      local_prestacao:   clCampo(cl.local_prestacao, cl.local_prestacao ? 90 : 0,
        'label_local_prestacao_a', cl.local_prestacao ? 'EXPLICITO' : 'AUSENTE'),
      situacao_nfse:     clCampo(cl.situacao_nfse, cl.situacao_nfse ? 92 : 0,
        'label_situacao_nfse_a', cl.situacao_nfse ? 'EXPLICITO' : 'AUSENTE'),
      iss_retido:        clCampo(String(cl.iss_retido), cl.situacao_issqn ? 92 : 40,
        'derivado_situacao_issqn_a', 'DERIVADO'),
      regime_tributario: clCampo(cl.regime_tributario !== 'DESCONHECIDO' ? cl.regime_tributario : null,
        cl.regime_tributario !== 'DESCONHECIDO' ? 88 : 30,
        'identificado_texto_a', cl.regime_tributario !== 'DESCONHECIDO' ? 'EXPLICITO' : 'AUSENTE'),
    },
    extractionMs: Date.now() - t0,
  };
}

// ─── EXTRAÇÃO DOS PARES DE CAMPOS ────────────────────────────────────────────

/** Achata NF9Resultado em pares (chave → {a, b}) para comparação */
function flattenPair(a: NF9Resultado, b: NF9Resultado): Record<string, { fa: NF9CampoResult; fb: NF9CampoResult }> {
  const pairs: Record<string, { fa: NF9CampoResult; fb: NF9CampoResult }> = {};

  const add = (key: string, fa: NF9CampoResult, fb: NF9CampoResult) => { pairs[key] = { fa, fb }; };

  // Cabeçalho
  add('numero_nota',        a.cabecalho.numero_nota,        b.cabecalho.numero_nota);
  add('codigo_verificacao', a.cabecalho.codigo_verificacao, b.cabecalho.codigo_verificacao);
  add('data_emissao',       a.cabecalho.data_emissao,       b.cabecalho.data_emissao);
  add('data_fato_gerador',  a.cabecalho.data_fato_gerador,  b.cabecalho.data_fato_gerador);

  // Prestador
  for (const k of ['razao_social','nome_fantasia','cpf_cnpj','inscricao_municipal','municipio','uf','email','telefone','endereco','cep'] as const)
    add(`prestador.${k}`, (a.prestador as Record<string, NF9CampoResult>)[k], (b.prestador as Record<string, NF9CampoResult>)[k]);

  // Tomador
  for (const k of ['razao_social','nome_fantasia','cpf_cnpj','inscricao_municipal','municipio','uf','email','telefone','endereco','cep'] as const)
    add(`tomador.${k}`, (a.tomador as Record<string, NF9CampoResult>)[k], (b.tomador as Record<string, NF9CampoResult>)[k]);

  // Serviços
  for (const k of ['descricao','of','quantidade','valor_unitario','valor_servico','codigo_servico'] as const)
    add(`servico.${k}`, (a.servico as Record<string, NF9CampoResult>)[k], (b.servico as Record<string, NF9CampoResult>)[k]);

  // Financeiro
  for (const k of ['valor_bruto','valor_liquido','base_calculo','aliquota_iss','valor_iss','ir','pis_pasep','cofins','inss','csll','outras_retencoes','valor_aproximado_tributos','valor_servico_fin'] as const)
    add(k, (a.financeiro as Record<string, NF9CampoResult>)[k], (b.financeiro as Record<string, NF9CampoResult>)[k]);

  // Fiscal
  for (const k of ['natureza_operacao','situacao_issqn','local_prestacao','situacao_nfse','iss_retido','regime_tributario'] as const)
    add(k, (a.fiscal as Record<string, NF9CampoResult>)[k], (b.fiscal as Record<string, NF9CampoResult>)[k]);

  return pairs;
}

// ─── RESOLUÇÃO DE CONFLITO ────────────────────────────────────────────────────

/**
 * Decide o valor final com base em prioridades objetivas:
 *  P1: âncora estrutural forte (Método A com alta confiança)
 *  P2: maior confiança
 *  P3: consistência matemática / fiscal (conferida antes de chamar esta função)
 *  P4: múltiplas evidências (ambos concordam)
 *  P5: derivação com regra estável
 *  P6: inferência controlada como último recurso
 */
function resolveConflict(
  fa: NF9CampoResult,
  fb: NF9CampoResult,
  tipo: TipoConcordancia,
  critico: boolean,
  normA: string | null,
  normB: string | null,
): CampoComparado['resultado_final'] & { revisao_obrigatoria: boolean; explicacao: string } {
  // CONCORDÂNCIA → usa o método com maior confiança (tiebreak: A)
  if (tipo === 'CONCORDANCIA_TOTAL' || tipo === 'CONCORDANCIA_FUNCIONAL') {
    const best = fa.confianca >= fb.confianca ? fa : fb;
    const who: 'A' | 'B' | 'AMBOS' = fa.valor === fb.valor ? 'AMBOS' : (fa.confianca >= fb.confianca ? 'A' : 'B');
    return {
      valor:           best.valor,
      confianca:       Math.round((fa.confianca + fb.confianca) / 2 * 10) / 10,
      metodo_vencedor: who,
      origem:          fa.origem !== 'AUSENTE' ? fa.origem : fb.origem,
      revisao_obrigatoria: false,
      explicacao:      tipo === 'CONCORDANCIA_TOTAL'
        ? 'Ambos os métodos concordam exatamente — aprovado automaticamente'
        : `Concordância funcional após normalização (A:"${normA}" ↔ B:"${normB}") — aprovado`,
    };
  }

  // DIVERGÊNCIA LEVE → método com maior confiança, sem revisão obrigatória
  if (tipo === 'DIVERGENCIA_LEVE') {
    const winA = fa.confianca >= fb.confianca;
    const winner = winA ? fa : fb;
    return {
      valor:           winner.valor,
      confianca:       Math.round(winner.confianca * 0.90),
      metodo_vencedor: winA ? 'A' : 'B',
      origem:          winner.origem,
      revisao_obrigatoria: false,
      explicacao: `Divergência leve de formatação (A:"${fa.valor}" vs B:"${fb.valor}") — ` +
        `método ${winA ? 'A' : 'B'} selecionado por maior confiança (${winner.confianca}%)`,
    };
  }

  // DIVERGÊNCIA MODERADA → método com maior confiança, revisão para campos críticos
  if (tipo === 'DIVERGENCIA_MODERADA') {
    const winA = fa.confianca >= fb.confianca;
    const winner = winA ? fa : fb;
    return {
      valor:           winner.valor,
      confianca:       Math.round(winner.confianca * 0.70),
      metodo_vencedor: winA ? 'A' : 'B',
      origem:          winner.origem,
      revisao_obrigatoria: critico,
      explicacao: `Divergência moderada (A:"${fa.valor}" vs B:"${fb.valor}") — ` +
        `método ${winA ? 'A' : 'B'} prevalece por confiança${critico ? ' — REVISÃO OBRIGATÓRIA' : ''}`,
    };
  }

  // DIVERGÊNCIA CRÍTICA → bloquear campo crítico; non-crítico usa A
  if (tipo === 'DIVERGENCIA_CRITICA') {
    if (critico) {
      return {
        valor:           null,
        confianca:       0,
        metodo_vencedor: 'NENHUM',
        origem:          'AUSENTE',
        revisao_obrigatoria: true,
        explicacao: `DIVERGÊNCIA CRÍTICA em campo crítico — A:"${fa.valor}" vs B:"${fb.valor}" — ` +
          'campo nulo até revisão manual obrigatória',
      };
    }
    // Non-crítico: usa método A com confiança reduzida
    return {
      valor:           fa.valor,
      confianca:       Math.round(fa.confianca * 0.50),
      metodo_vencedor: 'A',
      origem:          fa.origem,
      revisao_obrigatoria: true,
      explicacao: `Divergência crítica em campo não-crítico — A:"${fa.valor}" vs B:"${fb.valor}" — ` +
        'mantém valor de A com confiança reduzida, revisão recomendada',
    };
  }

  // Fallback
  return {
    valor:           fa.valor,
    confianca:       fa.confianca,
    metodo_vencedor: 'A',
    origem:          fa.origem,
    revisao_obrigatoria: false,
    explicacao:      'Fallback: Método A selecionado',
  };
}

// ─── COMPARAÇÃO CAMPO A CAMPO ─────────────────────────────────────────────────

function compareFields(a: NF9Resultado, b: NF9Resultado): CampoComparado[] {
  const pairs = flattenPair(a, b);
  const result: CampoComparado[] = [];

  for (const [key, { fa, fb }] of Object.entries(pairs)) {
    const meta = CAMPO_META[key] ?? { secao: 'desconhecido', critico: false, norm: 'raw' as NormTipo };
    const { tipo, normA, normB } = classifyConcordance(fa.valor, fb.valor, meta.norm);

    const resolution = resolveConflict(fa, fb, tipo, meta.critico, normA, normB);

    result.push({
      campo:             key,
      secao:             meta.secao,
      critico:           meta.critico,
      metodo_a:          fa,
      metodo_b:          fb,
      valor_norm_a:      normA,
      valor_norm_b:      normB,
      tipo_concordancia: tipo,
      resultado_final: {
        valor:           resolution.valor,
        confianca:       resolution.confianca,
        metodo_vencedor: resolution.metodo_vencedor,
        origem:          resolution.origem,
      },
      revisao_obrigatoria: resolution.revisao_obrigatoria,
      explicacao:          resolution.explicacao,
    });
  }

  return result;
}

// ─── CONSOLIDAÇÃO FINAL ────────────────────────────────────────────────────────

function consolidate(comparacao: CampoComparado[]): ValidacaoCruzadaResult['resultado_final_consolidado'] {
  const campos: ValidacaoCruzadaResult['resultado_final_consolidado']['campos'] = {};
  const alertas: string[] = [];
  const campos_derivados: string[] = [];
  let revisao_obrigatoria = false;
  let bloqueado           = false;
  let motivo_bloqueio: string | undefined;

  for (const c of comparacao) {
    campos[c.campo] = {
      valor:     c.resultado_final.valor,
      confianca: c.resultado_final.confianca,
      origem:    c.resultado_final.origem,
      secao:     c.secao,
    };

    if (c.resultado_final.origem === 'DERIVADO') campos_derivados.push(c.campo);

    if (c.revisao_obrigatoria) {
      revisao_obrigatoria = true;
      if (c.tipo_concordancia === 'DIVERGENCIA_CRITICA' && c.critico) {
        if (!bloqueado) {
          bloqueado       = true;
          motivo_bloqueio = `Divergência crítica no campo "${c.campo}": ` +
                            `A="${c.metodo_a.valor}" vs B="${c.metodo_b.valor}"`;
        }
        alertas.push(`[CRÍTICO] ${c.campo}: ${c.explicacao}`);
      } else {
        alertas.push(`[REVISÃO] ${c.campo}: ${c.explicacao}`);
      }
    }
    if (c.tipo_concordancia === 'DIVERGENCIA_CRITICA' && !c.revisao_obrigatoria) {
      alertas.push(`[ALERTA] ${c.campo}: ${c.explicacao}`);
    }
  }

  // Score global de confiança = média ponderada (campos críticos têm peso 2)
  const totalWeight  = comparacao.reduce((s, c) => s + (c.critico ? 2 : 1), 0);
  const totalConf    = comparacao.reduce((s, c) => s + c.resultado_final.confianca * (c.critico ? 2 : 1), 0);
  const confianca_global = totalWeight > 0 ? Math.round(totalConf / totalWeight * 10) / 10 : 0;

  return {
    campos,
    confianca_global,
    revisao_obrigatoria,
    campos_derivados,
    alertas,
    bloqueado,
    motivo_bloqueio,
  };
}

// ─── ESTATÍSTICAS ─────────────────────────────────────────────────────────────

function buildEstatisticas(comparacao: CampoComparado[]): ValidacaoCruzadaResult['estatisticas'] {
  const total              = comparacao.length;
  const concordancia_total = comparacao.filter(c => c.tipo_concordancia === 'CONCORDANCIA_TOTAL').length;
  const concordancia_func  = comparacao.filter(c => c.tipo_concordancia === 'CONCORDANCIA_FUNCIONAL').length;
  const div_leve           = comparacao.filter(c => c.tipo_concordancia === 'DIVERGENCIA_LEVE').length;
  const div_mod            = comparacao.filter(c => c.tipo_concordancia === 'DIVERGENCIA_MODERADA').length;
  const div_crit           = comparacao.filter(c => c.tipo_concordancia === 'DIVERGENCIA_CRITICA').length;
  const taxa               = total > 0 ? Math.round((concordancia_total + concordancia_func) / total * 1000) / 10 : 0;

  return {
    total_campos:           total,
    concordancia_total,
    concordancia_funcional: concordancia_func,
    divergencia_leve:       div_leve,
    divergencia_moderada:   div_mod,
    divergencia_critica:    div_crit,
    taxa_concordancia:      taxa,
  };
}

// ─── PONTO DE ENTRADA ─────────────────────────────────────────────────────────

/**
 * Executa a dupla extração + validação cruzada completa.
 *
 * @param pdfBuffer  Buffer do PDF da NFS-e
 * @returns          ValidacaoCruzadaResult com os dois métodos, comparação e resultado consolidado
 */
export async function validateCrossCheck(pdfBuffer: Buffer): Promise<ValidacaoCruzadaResult> {
  const t0 = Date.now();

  // Executa os dois métodos em paralelo
  const [metodoA, metodoB] = await Promise.all([
    buildMetodoA(pdfBuffer),
    extractMetodoB(pdfBuffer),
  ]);

  const comparacao    = compareFields(metodoA, metodoB);
  const consolidado   = consolidate(comparacao);
  const estatisticas  = buildEstatisticas(comparacao);

  return {
    metodo_a:                    metodoA,
    metodo_b:                    metodoB,
    comparacao,
    resultado_final_consolidado: consolidado,
    estatisticas,
    extractionMs:                Date.now() - t0,
  };
}
