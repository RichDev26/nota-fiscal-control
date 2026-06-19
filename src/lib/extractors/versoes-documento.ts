/**
 * Fase 11 — Gerenciador de Versões de Documento
 *
 * Mantém um histórico imutável de versões para cada documento.
 * Cada versão é um snapshot dos dados principais no momento de uma alteração relevante.
 *
 * Labels de versão padronizados:
 *   "original"             → Documento recém-chegado ao sistema (só metadados)
 *   "apos_extracao"        → Após motor de extração rodar (Fases 2-7)
 *   "apos_validacao"       → Após validação cruzada (Fase 9)
 *   "apos_correcao"        → Após correção humana validada
 *   "apos_reprocessamento" → Após reprocessamento com base de conhecimento atualizada
 *   "final"                → Versão aprovada e consolidada
 *
 * REGRAS DE INTEGRIDADE:
 *   - Versões são append-only — nenhuma versão pode ser removida ou modificada
 *   - Cada versão tem hash calculado sobre o snapshot + número da versão
 *   - O diff sempre é calculado em relação à versão imediatamente anterior
 */

import fs             from 'fs';
import path           from 'path';
import { randomUUID } from 'crypto';
import { calcularHash } from './integridade';
import type { VersaoDocumento, DiffCampo } from './auditoria-tipos';

// ─── CAMINHOS ─────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, 'data', 'auditoria', 'versoes');

function getDocPath(documentoId: string): string {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  return path.join(DATA_DIR, `${documentoId}.json`);
}

// ─── I/O ──────────────────────────────────────────────────────────────────────

function carregarVersoes(documentoId: string): VersaoDocumento[] {
  const p = getDocPath(documentoId);
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as VersaoDocumento[];
}

function salvarVersoes(documentoId: string, versoes: VersaoDocumento[]): void {
  fs.writeFileSync(getDocPath(documentoId), JSON.stringify(versoes, null, 2), 'utf-8');
}

// ─── DIFF ─────────────────────────────────────────────────────────────────────

/** Calcula a diferença entre dois snapshots de dados */
export function calcularDiff(
  antes:  Record<string, unknown>,
  depois: Record<string, unknown>,
): DiffCampo[] {
  const campos = Array.from(new Set([...Object.keys(antes), ...Object.keys(depois)]));
  const diff: DiffCampo[] = [];

  for (const campo of campos) {
    const va = antes[campo]  !== undefined ? String(antes[campo])  : null;
    const vd = depois[campo] !== undefined ? String(depois[campo]) : null;
    if (va !== vd) diff.push({ campo, valor_antes: va, valor_depois: vd });
  }

  return diff;
}

// ─── OPERAÇÕES ────────────────────────────────────────────────────────────────

/**
 * Cria uma nova versão do documento.
 *
 * @param documentoId    ID do documento
 * @param dadosSnapshot  Estado atual dos campos principais
 * @param label          Rótulo semântico ("original", "apos_extracao", etc.)
 * @param eventoOrigem   ID do evento auditável que criou esta versão
 * @param autor          Quem originou (usuario_id ou "SISTEMA")
 * @param motivo         Por que esta versão foi criada
 */
export function criarVersao(
  documentoId:   string,
  dadosSnapshot: Record<string, unknown>,
  label:         string,
  eventoOrigem:  string,
  autor:         string | null,
  motivo:        string,
): VersaoDocumento {
  const versoes  = carregarVersoes(documentoId);
  const anterior = versoes[versoes.length - 1] ?? null;

  // Diff em relação à versão anterior — ou diff completo se for a primeira
  const diff = anterior
    ? calcularDiff(anterior.dados_snapshot as Record<string, unknown>, dadosSnapshot)
    : Object.entries(dadosSnapshot).map(([campo, valor]) => ({
        campo,
        valor_antes:  null,
        valor_depois: valor !== undefined ? String(valor) : null,
      }));

  const numero_versao = (anterior?.numero_versao ?? 0) + 1;

  const versao: VersaoDocumento = {
    versao_id:      randomUUID(),
    documento_id:   documentoId,
    numero_versao,
    label,
    evento_origem:  eventoOrigem,
    hash:           calcularHash({ documentoId, dadosSnapshot, numero_versao }),
    data:           new Date().toISOString(),
    autor:          autor ?? 'SISTEMA',
    motivo,
    diff,
    dados_snapshot: dadosSnapshot,
  };

  versoes.push(versao);
  salvarVersoes(documentoId, versoes);
  return versao;
}

export function listarVersoes(documentoId: string): VersaoDocumento[] {
  return carregarVersoes(documentoId);
}

export function obterVersao(documentoId: string, versaoId: string): VersaoDocumento | null {
  return carregarVersoes(documentoId).find(v => v.versao_id === versaoId) ?? null;
}

export function obterUltimaVersao(documentoId: string): VersaoDocumento | null {
  const versoes = carregarVersoes(documentoId);
  return versoes[versoes.length - 1] ?? null;
}

export function obterVersaoPorLabel(documentoId: string, label: string): VersaoDocumento | null {
  const versoes = carregarVersoes(documentoId);
  // Retorna a mais recente com aquele label
  return [...versoes].reverse().find(v => v.label === label) ?? null;
}

/** Compara dois snapshots de versões de um mesmo documento */
export function compararVersoes(
  documentoId: string,
  versaoIdA:   string,
  versaoIdB:   string,
): { diff: DiffCampo[]; versao_a: VersaoDocumento; versao_b: VersaoDocumento } | null {
  const versoes = carregarVersoes(documentoId);
  const a = versoes.find(v => v.versao_id === versaoIdA);
  const b = versoes.find(v => v.versao_id === versaoIdB);
  if (!a || !b) return null;

  return {
    diff: calcularDiff(
      a.dados_snapshot as Record<string, unknown>,
      b.dados_snapshot as Record<string, unknown>,
    ),
    versao_a: a,
    versao_b: b,
  };
}

/** Exporta trilha completa de versões de um documento */
export function exportarTrilhaVersoes(documentoId: string): {
  documento_id:    string;
  total_versoes:   number;
  primeira_versao: string | null;
  ultima_versao:   string | null;
  versoes:         VersaoDocumento[];
} {
  const versoes = carregarVersoes(documentoId);
  return {
    documento_id:    documentoId,
    total_versoes:   versoes.length,
    primeira_versao: versoes[0]?.data ?? null,
    ultima_versao:   versoes[versoes.length - 1]?.data ?? null,
    versoes,
  };
}
