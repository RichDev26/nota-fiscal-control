/**
 * Fase 11 — Histórico de Campo
 *
 * Mantém o histórico completo de cada campo extraído por documento.
 * Cada mudança de valor — extração, correção, reprocessamento — gera
 * uma nova entrada. O valor "final" é sempre a entrada mais recente.
 *
 * Campos rastreados (qualquer campo com nome string):
 *   - numero_nota, codigo_verificacao, data_emissao, data_fato_gerador
 *   - prestador.razao_social, prestador.cpf_cnpj, tomador.razao_social, tomador.cpf_cnpj
 *   - valor_bruto, valor_liquido, valor_iss, aliquota_iss, base_calculo
 *   - ir, pis_pasep, cofins, inss, csll, outras_retencoes
 *   - natureza_operacao, situacao_issqn, iss_retido, regime_tributario, status
 *
 * REGRAS:
 *   - Append-only: entradas não são removidas
 *   - Uma entrada pode ser igual à anterior (confirmação sem mudança de valor)
 *   - is_final marca a entrada mais recente — apenas uma por campo
 *   - Cada documento tem seu próprio arquivo JSON
 */

import fs             from 'fs';
import path           from 'path';
import { randomUUID } from 'crypto';
import type { HistoricoCampo, HistoricoCampoEntrada, OrigemEvento } from './auditoria-tipos';

// ─── CAMINHOS ─────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, 'data', 'auditoria', 'historico-campos');

function getDocPath(documentoId: string): string {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  return path.join(DATA_DIR, `${documentoId}.json`);
}

type HistoricoDoc = Record<string, HistoricoCampo>;

function carregar(documentoId: string): HistoricoDoc {
  const p = getDocPath(documentoId);
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as HistoricoDoc;
}

function salvar(documentoId: string, dados: HistoricoDoc): void {
  fs.writeFileSync(getDocPath(documentoId), JSON.stringify(dados, null, 2), 'utf-8');
}

// ─── OPERAÇÕES ────────────────────────────────────────────────────────────────

/**
 * Registra uma nova entrada no histórico de um campo.
 * Desmarca todas as entradas anteriores como não-finais e marca a nova como final.
 */
export function registrarHistoricoCampo(
  documentoId: string,
  campo:       string,
  valor:       string | null,
  origem:      OrigemEvento,
  metodo:      string | null,
  confianca:   number | null,
  usuarioId:   string | null,
  eventoId:    string | null,
  motivo:      string | null,
): HistoricoCampoEntrada {
  const historico = carregar(documentoId);

  if (!historico[campo]) {
    historico[campo] = {
      campo,
      documento_id:    documentoId,
      entradas:        [],
      valor_final:     null,
      confianca_final: null,
    };
  }

  const h = historico[campo];
  h.entradas.forEach(e => { e.is_final = false; });

  const entrada: HistoricoCampoEntrada = {
    entrada_id:   randomUUID(),
    campo,
    documento_id: documentoId,
    versao_seq:   h.entradas.length + 1,
    valor,
    origem,
    metodo,
    confianca,
    usuario_id:   usuarioId,
    timestamp:    new Date().toISOString(),
    evento_id:    eventoId,
    motivo,
    is_final:     true,
  };

  h.entradas.push(entrada);
  h.valor_final     = valor;
  h.confianca_final = confianca;

  salvar(documentoId, historico);
  return entrada;
}

/**
 * Registra em lote os campos de um resultado de extração.
 * Útil para registrar o bloco inteiro de uma vez após uma fase.
 */
export function registrarExtracao(
  documentoId: string,
  campos:      Record<string, { valor: string | null; confianca: number; metodo: string }>,
  eventoId:    string | null,
): void {
  for (const [campo, { valor, confianca, metodo }] of Object.entries(campos)) {
    registrarHistoricoCampo(
      documentoId, campo, valor, 'AUTOMATICO', metodo, confianca,
      null, eventoId, 'extração automática',
    );
  }
}

/** Obtém o histórico completo de um campo */
export function obterHistoricoCampo(documentoId: string, campo: string): HistoricoCampo | null {
  return carregar(documentoId)[campo] ?? null;
}

/** Obtém o valor e confiança finais de um campo */
export function obterValorFinal(
  documentoId: string,
  campo:       string,
): { valor: string | null; confianca: number | null } {
  const h = carregar(documentoId)[campo];
  if (!h) return { valor: null, confianca: null };
  return { valor: h.valor_final, confianca: h.confianca_final };
}

/** Lista todos os campos que têm histórico registrado para um documento */
export function listarCamposComHistorico(documentoId: string): string[] {
  return Object.keys(carregar(documentoId));
}

/** Exporta o histórico completo de todos os campos de um documento */
export function exportarHistoricoDocumento(documentoId: string): HistoricoDoc {
  return carregar(documentoId);
}

/**
 * Gera um resumo de quantas vezes cada campo mudou de valor.
 * Útil para detectar campos instáveis (muitas correções).
 */
export function resumoInstabilidade(documentoId: string): Record<string, number> {
  const historico = carregar(documentoId);
  const resumo: Record<string, number> = {};

  for (const [campo, h] of Object.entries(historico)) {
    const mudancas = h.entradas.filter((e, i) =>
      i > 0 && e.valor !== h.entradas[i - 1].valor,
    );
    resumo[campo] = mudancas.length;
  }

  return resumo;
}

/**
 * Verifica se algum campo humano corrigiu o valor extraído automaticamente.
 * Retorna lista de campos corrigidos com o detalhe da mudança.
 */
export function listarCorrecoesHumanas(documentoId: string): Array<{
  campo:         string;
  valor_sistema: string | null;
  valor_humano:  string | null;
  usuario_id:    string | null;
  timestamp:     string;
}> {
  const historico = carregar(documentoId);
  const resultado: ReturnType<typeof listarCorrecoesHumanas> = [];

  for (const [campo, h] of Object.entries(historico)) {
    const humanas = h.entradas.filter(e => e.origem === 'HUMANO');
    for (const entrada of humanas) {
      const idx    = h.entradas.indexOf(entrada);
      const antes  = idx > 0 ? h.entradas[idx - 1].valor : null;
      resultado.push({
        campo,
        valor_sistema: antes,
        valor_humano:  entrada.valor,
        usuario_id:    entrada.usuario_id,
        timestamp:     entrada.timestamp,
      });
    }
  }

  return resultado;
}
