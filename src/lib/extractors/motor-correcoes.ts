/**
 * Fase 10 — Motor de Correções e Autoaprendizado Controlado
 *
 * Orquestra o ciclo completo:
 *   1. Recebe entrada de correção do usuário
 *   2. Classifica automaticamente o tipo de erro
 *   3. Valida se a correção é confiável e pode ser aprendida
 *   4. Aplica o aprendizado na base de conhecimento (com segurança)
 *   5. Retorna resultado estruturado
 *
 * REGRAS DE SEGURANÇA:
 *   - Correção isolada contra consenso de dois métodos → SUSPEITA
 *   - Correção sem formato válido → REJEITADA
 *   - Campo congelado → REJEITADA automaticamente
 *   - Contradição detectada → CONGELADA (não aprende)
 *   - Score de confiança de correção < 60 → REVISÃO HUMANA
 */

import { randomUUID }           from 'crypto';
import { classificarErro, identificarImpactos } from './classificador-erros';
import {
  carregarBase, salvarBase, getCampoCongelado,
  detectarContradicao, aplicarCorrecaoNaBase, confirmarExtracao,
  versionar, congelarCampo,
} from './base-conhecimento';
import { normalize }            from './normalizador';
import type { NormTipo }        from './normalizador';
import type {
  EntradaCorrecao, RegistroCorrecao, ValidacaoCorrecao,
  ResultadoAprendizado, BaseConhecimento,
} from './correcao-tipos';

// ─── LOG DE CORREÇÕES (em memória + persistência JSON) ───────────────────────

import fs   from 'fs';
import path from 'path';

const DATA_DIR  = path.join(__dirname, 'data');
const LOG_PATH  = path.join(DATA_DIR, 'correcoes.json');

function carregarLog(): RegistroCorrecao[] {
  if (!fs.existsSync(LOG_PATH)) return [];
  return JSON.parse(fs.readFileSync(LOG_PATH, 'utf-8')) as RegistroCorrecao[];
}

function salvarLog(log: RegistroCorrecao[]): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2), 'utf-8');
}

// ─── VALIDAÇÃO DE FORMATO ────────────────────────────────────────────────────

const FORMATO_POR_CAMPO: Record<string, NormTipo> = {
  'prestador.cpf_cnpj': 'cnpj', 'tomador.cpf_cnpj': 'cnpj',
  data_emissao: 'date', data_fato_gerador: 'date',
  valor_bruto: 'money', valor_liquido: 'money',
  valor_iss: 'money', base_calculo: 'money', valor_servico_fin: 'money',
  'servico.valor_servico': 'money', valor_aproximado_tributos: 'money',
  aliquota_iss: 'percent',
  iss_retido: 'boolean',
};

function validarFormatoValor(campo: string, valor: string | null): boolean {
  if (valor === null) return true;
  const tipo = FORMATO_POR_CAMPO[campo];
  if (!tipo) return true;  // sem restrição de formato conhecida
  return normalize(valor, tipo) !== null;
}

// ─── VALIDAÇÃO DA CORREÇÃO ────────────────────────────────────────────────────

/**
 * Decide se uma correção deve ser aceita para aprendizado.
 * Analisa confiabilidade, formato, contradições e suspeitas.
 */
export function validarCorrecao(
  registro: RegistroCorrecao,
  corricoesExistentes: RegistroCorrecao[],
  base: BaseConhecimento,
): ValidacaoCorrecao {
  const motivos: string[] = [];
  const alertas:  string[] = [];
  let nivelConfianca  = 100;
  let deve_congelar   = false;

  // Regra 1: Campo congelado → rejeitar imediatamente
  if (getCampoCongelado(base, registro.campo)) {
    motivos.push(`Campo "${registro.campo}" está CONGELADO (contradição anterior detectada) — requer revisão humana.`);
    return {
      aceita: false, nivel_confianca_correcao: 0,
      motivos_rejeicao: motivos, alertas, requer_revisao_humana: true, deve_congelar: false,
    };
  }

  // Regra 2: Formato inválido do valor corrigido → rejeitar
  if (registro.valor_corrigido !== null && !validarFormatoValor(registro.campo, registro.valor_corrigido)) {
    motivos.push(`Valor corrigido "${registro.valor_corrigido}" não passa na validação de formato para "${registro.campo}".`);
    nivelConfianca -= 40;
  }

  // Regra 3: Rejeição por contradição de consenso
  // Se ambos os métodos A e B concordaram (CONCORDANCIA_TOTAL) e o usuário discorda → REJEITAR
  // Dois métodos independentes raramente erram na mesma direção — alta suspeita de erro humano
  if (registro.concordancia_fase9 === 'CONCORDANCIA_TOTAL' &&
      registro.valor_extraido !== registro.valor_corrigido) {
    motivos.push(`Ambos os métodos (A e B) concordaram em "${registro.valor_extraido}" mas usuário quer "${registro.valor_corrigido}". Correção suspeita — rejeitar por segurança.`);
    nivelConfianca -= 30;
  }

  // Regra 4: Sem confirmação humana explícita → reduz confiança
  if (!registro.correcao_humana) {
    alertas.push('Correção não marcada como humana — confiança reduzida.');
    nivelConfianca -= 20;
  }

  // Regra 5: Contradição com correções já validadas
  const { contradiz, motivo: motivoContradição } = detectarContradicao(
    base, registro.campo, registro.valor_corrigido, corricoesExistentes,
  );
  if (contradiz) {
    motivos.push(`Contradição detectada: ${motivoContradição}`);
    nivelConfianca -= 50;
    deve_congelar  = true;
  }

  // Regra 6: Ausência de observação para campos críticos
  const campoCritico = ['numero_nota','codigo_verificacao','prestador.cpf_cnpj','tomador.cpf_cnpj',
                         'valor_bruto','valor_liquido','valor_iss','iss_retido'].includes(registro.campo);
  if (campoCritico && !registro.observacao) {
    alertas.push(`Campo crítico "${registro.campo}" corrigido sem observação — recomenda-se adicionar justificativa.`);
    nivelConfianca -= 10;
  }

  nivelConfianca = Math.max(0, nivelConfianca);
  const aceita  = motivos.length === 0 && nivelConfianca >= 50;

  return {
    aceita,
    nivel_confianca_correcao: nivelConfianca,
    motivos_rejeicao: motivos,
    alertas,
    requer_revisao_humana: nivelConfianca < 60 || deve_congelar,
    deve_congelar: deve_congelar,
  };
}

// ─── REGISTRO DE CORREÇÃO ────────────────────────────────────────────────────

/**
 * Registra uma nova correção, classifica o erro e determina se é aceitável
 * para aprendizado. Persiste no log de correções.
 */
export function registrarCorrecao(entrada: EntradaCorrecao): RegistroCorrecao {
  const classificacao = classificarErro(entrada);
  const log           = carregarLog();

  const registro: RegistroCorrecao = {
    id:                    randomUUID(),
    documento_id:          entrada.documento_id,
    campo:                 entrada.campo,
    secao:                 entrada.secao,
    valor_extraido:        entrada.valor_extraido,
    valor_corrigido:       entrada.valor_corrigido,
    tipo_erro:             classificacao.tipo,
    subtipo_erro:          classificacao.subtipo,
    origem_erro:           classificacao.origem,
    confianca_original:    entrada.confianca_original ?? 0,
    correcao_humana:       entrada.correcao_humana,
    timestamp:             new Date().toISOString(),
    observacao:            entrada.observacao ?? null,
    score_fase8:           entrada.score_fase8 ?? null,
    concordancia_fase9:    entrada.concordancia_fase9 ?? null,
    metodo_vencedor_fase9: entrada.metodo_vencedor_fase9 ?? null,
    severidade:            classificacao.severidade,
    aceita_para_aprendizado: false,   // definido em processarAprendizado
    status:                'PENDENTE',
    motivo_rejeicao:       null,
  };

  log.push(registro);
  salvarLog(log);
  return registro;
}

// ─── PROCESSAMENTO DE APRENDIZADO ────────────────────────────────────────────

/**
 * Processa um lote de correções, valida cada uma, aplica aprendizado seguro
 * e retorna o resultado consolidado.
 */
export function processarAprendizado(
  registros: RegistroCorrecao[],
): ResultadoAprendizado {
  let base = carregarBase();
  const log = carregarLog();

  const resultado: ResultadoAprendizado = {
    correcoes_processadas:   registros.length,
    correcoes_aceitas:       0,
    correcoes_rejeitadas:    0,
    correcoes_congeladas:    0,
    heuristicas_afetadas:    [],
    ancoras_afetadas:        [],
    fronteiras_afetadas:     [],
    padroes_promovidos:      [],
    campos_congelados:       [],
    confianca_ajustada:      false,
    base_atualizada:         false,
    alertas:                 [],
  };

  const todasAlteracoes: string[] = [];

  for (const reg of registros) {
    // Buscar correções existentes para este campo
    const existentes = log.filter(c => c.campo === reg.campo && c.status === 'VALIDADA');

    const validacao = validarCorrecao(reg, existentes, base);

    // Atualizar status no log
    const logIdx = log.findIndex(c => c.id === reg.id);

    if (validacao.deve_congelar) {
      // Congelar campo — parar aprendizado
      base = congelarCampo(base, reg.campo, validacao.motivos_rejeicao.join('; '));
      reg.status                 = 'CONGELADA';
      reg.aceita_para_aprendizado = false;
      reg.motivo_rejeicao        = validacao.motivos_rejeicao.join('; ');
      resultado.correcoes_congeladas += 1;
      resultado.campos_congelados.push(reg.campo);
      resultado.alertas.push(`Campo "${reg.campo}" CONGELADO: ${validacao.motivos_rejeicao[0]}`);
      base.metricas.total_congeladas += 1;

    } else if (!validacao.aceita) {
      // Rejeitar correção
      reg.status                 = 'REJEITADA';
      reg.aceita_para_aprendizado = false;
      reg.motivo_rejeicao        = validacao.motivos_rejeicao.join('; ');
      resultado.correcoes_rejeitadas += 1;
      base.metricas.total_rejeitadas += 1;
      if (validacao.alertas.length > 0)
        resultado.alertas.push(...validacao.alertas.map(a => `[${reg.campo}] ${a}`));

    } else {
      // Aceitar e aprender
      reg.status                 = 'VALIDADA';
      reg.aceita_para_aprendizado = true;
      resultado.correcoes_aceitas += 1;

      const totalValidadasCampo = existentes.length + 1;

      // Caso especial: sem mudança de valor (confirmação)
      if (reg.valor_extraido === reg.valor_corrigido) {
        const conf = confirmarExtracao(base, reg.campo, reg.secao);
        base = conf.base;
        todasAlteracoes.push(...conf.alteracoes);
      } else {
        // Correção real
        const aprendizado = aplicarCorrecaoNaBase(base, reg, totalValidadasCampo);
        base              = aprendizado.base;
        todasAlteracoes.push(...aprendizado.alteracoes);

        if (aprendizado.nivel === 'PADRAO_CONSOLIDADO') {
          resultado.padroes_promovidos.push(reg.campo);
        }
      }

      // Registrar impactos
      const impactos = identificarImpactos(reg.campo, reg.tipo_erro);
      impactos.ancoras.forEach(a => {
        if (!resultado.ancoras_afetadas.includes(a)) resultado.ancoras_afetadas.push(a);
      });
      impactos.heuristicas.forEach(h => {
        if (!resultado.heuristicas_afetadas.includes(h)) resultado.heuristicas_afetadas.push(h);
      });
      impactos.fronteiras.forEach(f => {
        if (!resultado.fronteiras_afetadas.includes(f)) resultado.fronteiras_afetadas.push(f);
      });

      resultado.confianca_ajustada = resultado.confianca_ajustada ||
        (base.heuristicas[reg.campo]?.delta_confianca !== 0);
    }

    // Atualizar no log
    if (logIdx >= 0) {
      log[logIdx] = reg;
    }
  }

  // Versionar a base se houve alterações
  if (todasAlteracoes.length > 0) {
    base = versionar(base, todasAlteracoes, 'SISTEMA');
    resultado.base_atualizada = true;
  }

  salvarBase(base);
  salvarLog(log);
  return resultado;
}

// ─── EXPORTAÇÃO DO RESULTADO DA FASE 10 ──────────────────────────────────────

/** Formato de saída padronizado conforme especificação da Fase 10. */
export function exportarResultadoFase10(
  registros:     RegistroCorrecao[],
  aprendizado:   ResultadoAprendizado,
  scoreAntes:    number,
  scoreDepois:   number,
) {
  return {
    correcoes: registros.map(r => ({
      documento_id:             r.documento_id,
      campo:                    r.campo,
      valor_extraido:           r.valor_extraido,
      valor_corrigido:          r.valor_corrigido,
      tipo_erro:                r.tipo_erro,
      subtipo_erro:             r.subtipo_erro,
      aceita_para_aprendizado:  r.aceita_para_aprendizado,
    })),
    aprendizado: {
      heuristicas_afetadas:  aprendizado.heuristicas_afetadas,
      ancoras_afetadas:      aprendizado.ancoras_afetadas,
      fronteiras_afetadas:   aprendizado.fronteiras_afetadas,
      confianca_ajustada:    aprendizado.confianca_ajustada,
    },
    reprocessamento: {
      necessario:           aprendizado.correcoes_aceitas > 0,
      campos_recalculados:  [...aprendizado.heuristicas_afetadas, ...aprendizado.ancoras_afetadas],
      score_novo:           scoreDepois,
    },
  };
}
