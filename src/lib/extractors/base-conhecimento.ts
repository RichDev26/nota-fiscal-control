/**
 * Fase 10 — Gerenciador da Base de Conhecimento
 *
 * Responsável por:
 *   - Carregar / salvar a base de conhecimento em JSON (data/base-conhecimento.json)
 *   - Aplicar correções validadas ao conhecimento
 *   - Promover padrões de nível 1→4
 *   - Versionar cada atualização
 *   - Congelar campos em contradição
 *
 * REGRAS DE SEGURANÇA DO APRENDIZADO (hard-coded):
 *   - 1 correção isolada → só Nível 1 (memória)
 *   - 3+ correções validadas no mesmo campo → Nível 2 (heurística)
 *   - 5+ validadas no mesmo campo (tipos mistos) → Nível 3 (confiança)
 *   - 7+ validadas + revisão humana → Nível 4 (padrão consolidado)
 *   - 2 correções contraditórias no mesmo campo → CONGELAR
 *   - delta_confianca clampeado em [–20, +20]
 */

import fs   from 'fs';
import path from 'path';
import type {
  BaseConhecimento, AjusteAncora, AjusteHeuristica,
  AjusteFronteira, PadraoConsolidado, HistoricoVersao,
  RegistroCorrecao, NivelAprendizado,
} from './correcao-tipos';

// ─── CAMINHOS ────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, 'data');
const BASE_PATH = path.join(DATA_DIR, 'base-conhecimento.json');

// ─── LIMITES DE SEGURANÇA ────────────────────────────────────────────────────

const LIMITES = {
  MIN_CORRECOES_HEURISTICA:     3,  // Level 2
  MIN_CORRECOES_CONFIANCA:      5,  // Level 3
  MIN_CORRECOES_CONSOLIDADO:    7,  // Level 4
  MAX_DELTA_CONFIANCA:         20,
  MIN_DELTA_CONFIANCA:        -20,
  MAX_CONTRADICOES_ANTES_CONGELAR: 2,
  PASSO_REDUCAO_CONFIANCA:      8,  // pontos por erro registrado
  PASSO_AUMENTO_CONFIANCA:      5,  // pontos por confirmação validada
} as const;

// ─── BASE INICIAL (SEED) ─────────────────────────────────────────────────────

function criarBaseSeed(): BaseConhecimento {
  const agora = new Date().toISOString();
  return {
    versao:                      '1.0.0',
    timestamp_criacao:           agora,
    timestamp_atualizacao:       agora,
    total_correcoes_processadas: 0,
    campos_congelados:           [],
    metricas: {
      total_aceitas:       0,
      total_rejeitadas:    0,
      total_congeladas:    0,
      padroes_promovidos:  0,
      reversoes:           0,
    },
    ancoras: {
      // Âncoras com fragilidade já conhecida das fases anteriores
      'tomador.razao_social': {
        campo: 'tomador.razao_social',
        padrao_original: 'primeiro_segmento_multiplas_palavras_zona_tomador',
        padroes_alternativos: ['label_razao_social:', 'label_tomador_nome_b'],
        confianca_historica: 70,
        erros_registrados: 1,
        correcoes_validadas: 0,
        congelado: false,
        ultima_atualizacao: agora,
        notas: 'PDF 2 colunas: zona TOMADOR pode conter rótulos de cabeçalho antes da razão social',
      },
      'servico.descricao': {
        campo: 'servico.descricao',
        padrao_original: 'primeiro_texto_zona_discriminacao',
        padroes_alternativos: ['apos_label_descricao_b'],
        confianca_historica: 75,
        erros_registrados: 1,
        correcoes_validadas: 0,
        congelado: false,
        ultima_atualizacao: agora,
        notas: 'Zona DISCRIMINAÇÃO pode iniciar com cabeçalhos de tabela (QtdValor unitário)',
      },
    },
    heuristicas: {
      'tomador.telefone': {
        campo: 'tomador.telefone',
        secao: 'tomador',
        delta_confianca: -10,
        correcoes_validadas: 0,
        correcoes_rejeitadas: 0,
        padrao_erro_frequente: 'captura_telefone_prestador_em_zona_tomador',
        nivel_aprendizado: 'MEMORIA',
        ultima_atualizacao: agora,
      },
      valor_iss: {
        campo: 'valor_iss',
        secao: 'financeiro',
        delta_confianca: 0,
        correcoes_validadas: 0,
        correcoes_rejeitadas: 0,
        padrao_erro_frequente: null,
        nivel_aprendizado: 'MEMORIA',
        ultima_atualizacao: agora,
      },
    },
    fronteiras: {
      tomador: {
        secao: 'tomador',
        ancora_inicio_alternativa: null,
        ancora_fim_alternativa: null,
        casos_erro: 1,
        casos_correcao: 0,
        congelado: false,
        ultima_atualizacao: agora,
      },
      servicos: {
        secao: 'servicos',
        ancora_inicio_alternativa: null,
        ancora_fim_alternativa: null,
        casos_erro: 1,
        casos_correcao: 0,
        congelado: false,
        ultima_atualizacao: agora,
      },
    },
    padroes_consolidados: [],
    historico_versoes: [
      {
        versao: '1.0.0',
        timestamp: agora,
        alteracoes: ['Base inicial criada com conhecimento das Fases 2-9'],
        revertido: false,
        responsavel: 'SISTEMA',
        hash_estado: hashEstado({ versao: '1.0.0', campos: [] }),
      },
    ],
  };
}

// ─── HASHING SIMPLES ─────────────────────────────────────────────────────────

function hashEstado(obj: object): string {
  const str = JSON.stringify(obj);
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function proximaVersao(atual: string): string {
  const [maj, min, patch] = atual.split('.').map(Number);
  return `${maj}.${min}.${patch + 1}`;
}

// ─── I/O ─────────────────────────────────────────────────────────────────────

export function carregarBase(): BaseConhecimento {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(BASE_PATH)) {
    const seed = criarBaseSeed();
    fs.writeFileSync(BASE_PATH, JSON.stringify(seed, null, 2), 'utf-8');
    return seed;
  }
  return JSON.parse(fs.readFileSync(BASE_PATH, 'utf-8')) as BaseConhecimento;
}

export function salvarBase(base: BaseConhecimento): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(BASE_PATH, JSON.stringify(base, null, 2), 'utf-8');
  // Write-through: persiste no DB para sobreviver a redeploys (Railway)
  import('@/lib/prisma').then(({ default: prisma }) =>
    prisma.baseConhecimentoDb.upsert({
      where:  { id: 'singleton' },
      create: { id: 'singleton', dados: JSON.stringify(base), versao: base.versao },
      update: { dados: JSON.stringify(base), versao: base.versao },
    })
  ).catch(err => console.error('[BaseConhecimento] Falha ao sincronizar DB:', err));
}

/**
 * Chamada no início do servidor para restaurar a base de aprendizado do DB
 * caso o arquivo local tenha sido perdido (pós-deploy Railway sem volume).
 */
export async function inicializarBase(): Promise<void> {
  if (fs.existsSync(BASE_PATH)) return;
  try {
    const { default: prisma } = await import('@/lib/prisma');
    const row = await prisma.baseConhecimentoDb.findUnique({ where: { id: 'singleton' } });
    if (row) {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(BASE_PATH, row.dados, 'utf-8');
      return;
    }
  } catch {
    // DB indisponível na inicialização — prossegue com seed
  }
  // Nenhum dado no DB — cria seed e já persiste
  const seed = criarBaseSeed();
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(BASE_PATH, JSON.stringify(seed, null, 2), 'utf-8');
  salvarBase(seed);
}

// ─── CONSULTAS ────────────────────────────────────────────────────────────────

export function getCampoCongelado(base: BaseConhecimento, campo: string): boolean {
  return base.campos_congelados.includes(campo);
}

export function getDeltaConfianca(base: BaseConhecimento, campo: string): number {
  return base.heuristicas[campo]?.delta_confianca ?? 0;
}

export function getAncora(base: BaseConhecimento, campo: string): AjusteAncora | null {
  return base.ancoras[campo] ?? null;
}

export function getConfiancaHistorica(base: BaseConhecimento, campo: string): number {
  return base.ancoras[campo]?.confianca_historica ?? 100;
}

/**
 * Aplica ajustes de confiança da base a um score original.
 * Retorna o score ajustado (clamped 0–100).
 */
export function aplicarAjusteConfianca(base: BaseConhecimento, campo: string, confiancaOriginal: number): number {
  const delta = getDeltaConfianca(base, campo);
  return Math.max(0, Math.min(100, confiancaOriginal + delta));
}

// ─── CONGELAMENTO ────────────────────────────────────────────────────────────

export function congelarCampo(base: BaseConhecimento, campo: string, motivo: string): BaseConhecimento {
  if (!base.campos_congelados.includes(campo)) {
    base.campos_congelados.push(campo);
    base.metricas.total_congeladas += 1;
    console.warn(`[BaseConhecimento] Campo "${campo}" CONGELADO: ${motivo}`);
  }
  if (base.ancoras[campo]) {
    base.ancoras[campo].congelado = true;
    base.ancoras[campo].notas += ` | CONGELADO: ${motivo}`;
  }
  if (base.fronteiras[campo.split('.')[0] || '']) {
    base.fronteiras[campo.split('.')[0]].congelado = true;
  }
  return base;
}

// ─── VERIFICAÇÃO DE CONTRADIÇÃO ──────────────────────────────────────────────

/**
 * Detecta se uma nova correção contradiz correções já validadas para o mesmo campo.
 * Contradição: campo X já foi corrigido para "A" (validada) e agora está sendo
 * corrigido para "B" (diferente de "A") com mesma origem.
 */
export function detectarContradicao(
  base: BaseConhecimento,
  campo: string,
  valorCorrigido: string | null,
  corricoesExistentes: RegistroCorrecao[],
): { contradiz: boolean; motivo: string } {
  const validadas = corricoesExistentes.filter(
    c => c.campo === campo && c.status === 'VALIDADA' && c.valor_corrigido !== null,
  );
  const valoresValidados = Array.from(new Set(validadas.map(c => c.valor_corrigido)));

  if (valoresValidados.length >= 2) {
    return {
      contradiz: true,
      motivo: `Campo "${campo}" já tem ${valoresValidados.length} valores validados distintos — instável.`,
    };
  }

  if (valoresValidados.length === 1 && valoresValidados[0] !== valorCorrigido) {
    const qtdContraditorias = validadas.filter(c => c.valor_corrigido !== valorCorrigido).length;
    if (qtdContraditorias >= LIMITES.MAX_CONTRADICOES_ANTES_CONGELAR) {
      return {
        contradiz: true,
        motivo: `"${campo}" já foi validado como "${valoresValidados[0]}" mas nova correção diz "${valorCorrigido}".`,
      };
    }
  }

  return { contradiz: false, motivo: '' };
}

// ─── APLICAÇÃO DE CORREÇÃO ───────────────────────────────────────────────────

/**
 * Aplica uma correção validada à base de conhecimento.
 * Determina o nível de aprendizado com base na contagem de correções validadas.
 */
export function aplicarCorrecaoNaBase(
  base: BaseConhecimento,
  registro: RegistroCorrecao,
  totalValidadasParaCampo: number,
): { base: BaseConhecimento; nivel: NivelAprendizado; alteracoes: string[] } {
  const campo  = registro.campo;
  const tipo   = registro.tipo_erro;
  const agora  = new Date().toISOString();
  const alts: string[] = [];

  // ── Nível 1: Sempre (memória) ────────────────────────────────────────────
  base.total_correcoes_processadas += 1;
  alts.push(`Nível 1: Correção registrada para "${campo}" (total validadas: ${totalValidadasParaCampo})`);

  // ── Nível 2: Ajuste de heurística (≥3 validadas) ────────────────────────
  if (totalValidadasParaCampo >= LIMITES.MIN_CORRECOES_HEURISTICA) {
    if (!base.heuristicas[campo]) {
      base.heuristicas[campo] = {
        campo, secao: registro.secao,
        delta_confianca: 0, correcoes_validadas: 0, correcoes_rejeitadas: 0,
        padrao_erro_frequente: null, nivel_aprendizado: 'MEMORIA', ultima_atualizacao: agora,
      };
    }
    const h = base.heuristicas[campo];
    const deltaAntes = h.delta_confianca;
    h.correcoes_validadas += 1;
    h.delta_confianca = Math.max(
      LIMITES.MIN_DELTA_CONFIANCA,
      Math.min(LIMITES.MAX_DELTA_CONFIANCA, h.delta_confianca - LIMITES.PASSO_REDUCAO_CONFIANCA),
    );
    h.padrao_erro_frequente = tipo;
    h.nivel_aprendizado = 'HEURISTICA';
    h.ultima_atualizacao = agora;
    alts.push(`Nível 2: delta_confianca ajustado ${deltaAntes} → ${h.delta_confianca} para "${campo}"`);
  }

  // ── Âncora: registra erro ────────────────────────────────────────────────
  if (tipo === 'ERRO_ANCORA' || tipo === 'ERRO_FRONTEIRA') {
    if (!base.ancoras[campo]) {
      base.ancoras[campo] = {
        campo, padrao_original: 'desconhecido', padroes_alternativos: [],
        confianca_historica: 100, erros_registrados: 0, correcoes_validadas: 0,
        congelado: false, ultima_atualizacao: agora, notas: '',
      };
    }
    const a = base.ancoras[campo];
    a.erros_registrados += 1;
    a.confianca_historica = Math.max(
      0, a.confianca_historica - LIMITES.PASSO_REDUCAO_CONFIANCA,
    );
    a.ultima_atualizacao = agora;
    alts.push(`Âncora "${campo}": confiança histórica reduzida para ${a.confianca_historica}%`);
  }

  // ── Fronteira: registra caso de erro ─────────────────────────────────────
  const secao = registro.secao;
  if (tipo === 'ERRO_FRONTEIRA' || tipo === 'ERRO_ASSOCIACAO_SECAO') {
    if (!base.fronteiras[secao]) {
      base.fronteiras[secao] = {
        secao, ancora_inicio_alternativa: null, ancora_fim_alternativa: null,
        casos_erro: 0, casos_correcao: 0, congelado: false, ultima_atualizacao: agora,
      };
    }
    base.fronteiras[secao].casos_erro    += 1;
    base.fronteiras[secao].casos_correcao += 1;
    base.fronteiras[secao].ultima_atualizacao = agora;
    alts.push(`Fronteira "${secao}": ${base.fronteiras[secao].casos_erro} caso(s) de erro registrado(s)`);
  }

  // ── Nível 3: Ajuste de confiança de seção (≥5 validadas) ────────────────
  let nivel: NivelAprendizado = totalValidadasParaCampo >= LIMITES.MIN_CORRECOES_HEURISTICA
    ? 'HEURISTICA' : 'MEMORIA';

  if (totalValidadasParaCampo >= LIMITES.MIN_CORRECOES_CONFIANCA) {
    nivel = 'CONFIANCA';
    alts.push(`Nível 3: Confiança de seção "${secao}" marcada para ajuste (${totalValidadasParaCampo} validadas)`);
  }

  // ── Nível 4: Promoção de padrão consolidado (≥7 validadas) ──────────────
  if (totalValidadasParaCampo >= LIMITES.MIN_CORRECOES_CONSOLIDADO) {
    nivel = 'PADRAO_CONSOLIDADO';
    const jaExiste = base.padroes_consolidados.some(p => p.campo === campo && p.tipo === 'ancora');
    if (!jaExiste && registro.valor_corrigido) {
      const novoId  = `padrao_${campo.replace(/\./g, '_')}_${Date.now()}`;
      const novo: PadraoConsolidado = {
        id: novoId, campo, tipo: 'ancora',
        padrao: `valor_correto_padrao:${registro.valor_corrigido.substring(0, 30)}`,
        descricao: `Padrão consolidado após ${totalValidadasParaCampo} correções validadas para "${campo}"`,
        evidencias: totalValidadasParaCampo, validado_por_humano: false,
        timestamp_promovido: agora, reversivel: true,
        versao: base.versao,
      };
      base.padroes_consolidados.push(novo);
      base.metricas.padroes_promovidos += 1;
      alts.push(`Nível 4: Padrão "${novoId}" promovido para "${campo}" — REQUER REVISÃO HUMANA`);
    }
  }

  base.metricas.total_aceitas += 1;
  return { base, nivel, alteracoes: alts };
}

// ─── CONFIRMAÇÃO (aumenta confiança) ─────────────────────────────────────────

/** Quando o usuário confirma que a extração estava CORRETA (sem alterar valor). */
export function confirmarExtracao(
  base: BaseConhecimento,
  campo: string,
  secao: string,
): { base: BaseConhecimento; alteracoes: string[] } {
  const agora = new Date().toISOString();
  const alts: string[] = [];

  if (!base.heuristicas[campo]) {
    base.heuristicas[campo] = {
      campo, secao, delta_confianca: 0, correcoes_validadas: 0, correcoes_rejeitadas: 0,
      padrao_erro_frequente: null, nivel_aprendizado: 'MEMORIA', ultima_atualizacao: agora,
    };
  }
  const h = base.heuristicas[campo];
  const antes = h.delta_confianca;
  h.delta_confianca = Math.min(
    LIMITES.MAX_DELTA_CONFIANCA, h.delta_confianca + LIMITES.PASSO_AUMENTO_CONFIANCA,
  );
  h.ultima_atualizacao = agora;
  if (h.delta_confianca !== antes) {
    alts.push(`Confirmação "${campo}": delta_confianca ${antes} → ${h.delta_confianca}`);
  }

  if (base.ancoras[campo]) {
    const a = base.ancoras[campo];
    a.correcoes_validadas += 1;
    a.confianca_historica = Math.min(100, a.confianca_historica + LIMITES.PASSO_AUMENTO_CONFIANCA);
    alts.push(`Âncora "${campo}": confiança histórica → ${a.confianca_historica}%`);
  }

  base.metricas.total_aceitas += 1;
  base.total_correcoes_processadas += 1;
  return { base, alteracoes: alts };
}

// ─── VERSIONAMENTO ────────────────────────────────────────────────────────────

/** Cria uma nova versão da base após um conjunto de alterações. */
export function versionar(
  base: BaseConhecimento,
  alteracoes: string[],
  responsavel: 'SISTEMA' | 'HUMANO' = 'SISTEMA',
): BaseConhecimento {
  const novaVersao = proximaVersao(base.versao);
  const agora      = new Date().toISOString();
  const novaEntrada: HistoricoVersao = {
    versao: novaVersao,
    timestamp: agora,
    alteracoes,
    revertido: false,
    responsavel,
    hash_estado: hashEstado({ versao: novaVersao, campos: Object.keys(base.heuristicas) }),
  };
  base.versao                 = novaVersao;
  base.timestamp_atualizacao  = agora;
  base.historico_versoes.push(novaEntrada);
  return base;
}

/** Reverte a base para uma versão anterior (requer arquivo de backup). */
export function marcarReversao(base: BaseConhecimento, versaoAlvo: string): BaseConhecimento {
  const entrada = base.historico_versoes.find(h => h.versao === versaoAlvo);
  if (entrada) {
    entrada.revertido = true;
    base.metricas.reversoes += 1;
  }
  return base;
}

/** Exporta resumo legível da base atual. */
export function resumoBase(base: BaseConhecimento): string {
  const linhas = [
    `Base de Conhecimento v${base.versao}`,
    `Atualizada: ${base.timestamp_atualizacao}`,
    `Correções processadas: ${base.total_correcoes_processadas}`,
    `Aceitas: ${base.metricas.total_aceitas} | Rejeitadas: ${base.metricas.total_rejeitadas} | Congeladas: ${base.metricas.total_congeladas}`,
    `Âncoras ajustadas: ${Object.keys(base.ancoras).length}`,
    `Heurísticas ajustadas: ${Object.keys(base.heuristicas).length}`,
    `Padrões consolidados: ${base.padroes_consolidados.length}`,
    `Campos congelados: ${base.campos_congelados.join(', ') || '(nenhum)'}`,
  ];
  return linhas.join('\n');
}
