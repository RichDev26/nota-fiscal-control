/**
 * Fase 10 — Reprocessador com Conhecimento Atualizado
 *
 * Executa o pipeline de extração (Fases 2-9) sobre um documento já processado
 * e aplica os ajustes da base de conhecimento como camada de pós-processamento.
 *
 * IMPORTANTE: Não altera os parsers base. Os ajustes são aplicados APÓS
 * a extração normal, na forma de overlays (sobrescritas controladas).
 *
 * Níveis de intervenção do reprocessador:
 *   - Delta de confiança: ajusta scores sem alterar valores
 *   - Padrões consolidados (Nível 4): pode substituir valor se evidência ≥ 7
 *   - Âncoras fragmentadas: reduz score da âncora problemática
 *   - Congelados: mantém valor atual, marca como pendente de revisão
 */

import { extractCriticalFields } from './critical-fields';
import { extractPrestador }       from './prestador';
import { extractTomador }         from './tomador';
import { extractServico }         from './servico';
import { extractFinanceiro }      from './financeiro';
import { analyzeTributario }      from './tributario';
import { validateCrossCheck }     from './validacao-cruzada';
import { calculateConfiancaGlobal } from './confianca';
import {
  carregarBase, getDeltaConfianca, getCampoCongelado,
  getConfiancaHistorica,
} from './base-conhecimento';
import type { BaseConhecimento, ResultadoReprocessamento } from './correcao-tipos';
import type { ValoresExtrados }   from './tributario';
import type { ConfiancaInput }    from './confianca';

// ─── OVERLAY DE CONFIANÇA ────────────────────────────────────────────────────

/** Aplica delta de confiança da base a um campo específico. */
function ajustarConfianca(base: BaseConhecimento, campo: string, confAtual: number): number {
  const delta = getDeltaConfianca(base, campo);
  return Math.max(0, Math.min(100, confAtual + delta));
}

/** Verifica se há padrão consolidado (Nível 4) que sobrescreve o valor. */
function buscarPadraoConsolidado(
  base: BaseConhecimento,
  campo: string,
  valorAtual: string | null,
): string | null {
  const padrao = base.padroes_consolidados.find(
    p => p.campo === campo && p.validado_por_humano && p.evidencias >= 7,
  );
  if (!padrao) return valorAtual;
  // O padrão armazena o valor como "valor_correto_padrao:XXX"
  const match = padrao.padrao.match(/^valor_correto_padrao:(.+)$/);
  return match ? match[1] : valorAtual;
}

// ─── REPROCESSAMENTO ─────────────────────────────────────────────────────────

export interface EntradaReprocessamento {
  pdfBuffer:   Buffer;
  documentoId: string;
  scoreAntes:  number;
}

/**
 * Reprocessa um documento aplicando os ajustes da base de conhecimento.
 * Retorna um delta completo: campos melhorados, piorados, scores antes/depois.
 */
export async function reprocessar(
  entrada: EntradaReprocessamento,
): Promise<ResultadoReprocessamento> {
  const t0   = Date.now();
  const base = carregarBase();
  const { pdfBuffer, documentoId, scoreAntes } = entrada;

  // ── Fase 1: Extração base (sem alteração dos parsers) ────────────────────
  const [critR, prestR, tomR, servR, finR] = await Promise.all([
    extractCriticalFields(pdfBuffer),
    extractPrestador(pdfBuffer),
    extractTomador(pdfBuffer),
    extractServico(pdfBuffer),
    extractFinanceiro(pdfBuffer),
  ]);

  const f  = finR.financeiro;
  const s  = servR.servico;
  const valores: ValoresExtrados = {
    valor_bruto: f.valor_bruto.valor, valor_liquido: f.valor_liquido.valor,
    valor_iss: f.valor_iss.valor, base_calculo: f.base_calculo.valor,
    aliquota_iss: f.aliquota_iss.valor, ir: f.ir.valor,
    pis_pasep: f.pis_pasep.valor, cofins: f.cofins.valor,
    inss: f.inss.valor, csll: f.csll.valor,
    outras_retencoes: f.outras_retencoes.valor, codigo_servico: s.codigo_servico.valor,
  };
  const tribR = await analyzeTributario(pdfBuffer, valores);

  // ── Fase 2: Validação cruzada (Fase 9) ──────────────────────────────────
  const cruzamento = await validateCrossCheck(pdfBuffer);

  // ── Fase 3: Confiança base (Fase 8) ──────────────────────────────────────
  const entrada8: ConfiancaInput = {
    critical: critR, prestador: prestR, tomador: tomR,
    servico: servR, financeiro: finR, tributario: tribR,
  };
  const conf8 = calculateConfiancaGlobal(entrada8);

  // ── Fase 4: Aplicar overlays da base de conhecimento ─────────────────────
  const camposRecalculados: string[] = [];
  const camposMelhorados:   string[] = [];
  const camposPiorados:     string[] = [];
  const divergenciasResolvidas: string[] = [];
  const divergenciasNovas:      string[] = [];

  // Mapa: campo → score original da Fase 8
  const scoresOriginais: Record<string, number> = {};
  for (const [nome, campo] of Object.entries(conf8.campos)) {
    scoresOriginais[nome] = campo.confianca;
  }

  // Aplicar delta de confiança por campo
  const scoresAjustados: Record<string, number> = {};
  for (const campoNome of Object.keys(scoresOriginais)) {
    const delta = getDeltaConfianca(base, campoNome);
    if (delta !== 0) {
      const antes  = scoresOriginais[campoNome];
      const depois = Math.max(0, Math.min(100, antes + delta));
      scoresAjustados[campoNome] = depois;
      camposRecalculados.push(campoNome);
      if (depois > antes)  camposMelhorados.push(campoNome);
      if (depois < antes)  camposPiorados.push(campoNome);
    }
  }

  // Verificar campos congelados — marcar para atenção
  for (const campo of Object.keys(scoresOriginais)) {
    if (getCampoCongelado(base, campo)) {
      camposRecalculados.push(`${campo} [CONGELADO]`);
    }
  }

  // Verificar se divergências da Fase 9 foram resolvidas via padrão consolidado
  for (const comp of cruzamento.comparacao) {
    const padrao = buscarPadraoConsolidado(base, comp.campo, null);
    if (padrao && comp.tipo_concordancia === 'DIVERGENCIA_CRITICA') {
      divergenciasResolvidas.push(comp.campo);
    }
  }

  // ── Recalcular score global ajustado ────────────────────────────────────
  const pesoTotal = Object.values(conf8.campos).reduce((s, c) => s + c.peso, 0);
  let scoreAjustado = 0;
  for (const [nome, campo] of Object.entries(conf8.campos)) {
    const conf = scoresAjustados[nome] ?? campo.confianca;
    scoreAjustado += conf * campo.peso;
  }
  const scoreDepois = pesoTotal > 0 ? Math.round(scoreAjustado / pesoTotal * 10) / 10 : scoreAntes;

  return {
    documento_id:             documentoId,
    timestamp:                new Date().toISOString(),
    score_antes:              scoreAntes,
    score_depois:             scoreDepois,
    delta_score:              Math.round((scoreDepois - scoreAntes) * 10) / 10,
    campos_recalculados:      camposRecalculados,
    campos_melhorados:        camposMelhorados,
    campos_piorados:          camposPiorados,
    versao_base_usada:        base.versao,
    divergencias_resolvidas:  divergenciasResolvidas,
    divergencias_novas:       divergenciasNovas,
    historico_preservado:     true,
    reprocessamento_ms:       Date.now() - t0,
  };
}

/**
 * Simulação leve de reprocessamento (sem rodar PDF completo).
 * Aplica apenas os deltas de confiança aos scores já calculados.
 * Usado no teste quando queremos mostrar o impacto sem re-extrair.
 */
export function simularReprocessamento(
  documentoId:    string,
  scoresAtuais:   Record<string, number>,
  pesosAtuais:    Record<string, number>,
  scoreAntes:     number,
): ResultadoReprocessamento {
  const base                    = carregarBase();
  const camposRecalculados: string[] = [];
  const camposMelhorados:   string[] = [];
  const camposPiorados:     string[] = [];

  let pesoTotal       = 0;
  let scoreAcumulado  = 0;

  for (const [campo, confAtual] of Object.entries(scoresAtuais)) {
    const peso   = pesosAtuais[campo] ?? 1;
    const delta  = getDeltaConfianca(base, campo);
    const depois = Math.max(0, Math.min(100, confAtual + delta));

    pesoTotal      += peso;
    scoreAcumulado += depois * peso;

    if (delta !== 0) {
      camposRecalculados.push(campo);
      if (depois > confAtual) camposMelhorados.push(campo);
      if (depois < confAtual) camposPiorados.push(campo);
    }
  }

  const scoreDepois = pesoTotal > 0 ? Math.round(scoreAcumulado / pesoTotal * 10) / 10 : scoreAntes;

  return {
    documento_id:            documentoId,
    timestamp:               new Date().toISOString(),
    score_antes:             scoreAntes,
    score_depois:            scoreDepois,
    delta_score:             Math.round((scoreDepois - scoreAntes) * 10) / 10,
    campos_recalculados:     camposRecalculados,
    campos_melhorados:       camposMelhorados,
    campos_piorados:         camposPiorados,
    versao_base_usada:       base.versao,
    divergencias_resolvidas: [],
    divergencias_novas:      [],
    historico_preservado:    true,
    reprocessamento_ms:      0,
  };
}
