/**
 * Fase 11 — Sistema de Logs (Técnico e de Negócio)
 *
 * DOIS GRUPOS COMPLETAMENTE SEPARADOS:
 *
 * ── LOG TÉCNICO ──────────────────────────────────────────────────────────────
 *   Para desenvolvedores e suporte. Nunca contém PII em texto puro.
 *   Persiste em logs-tecnicos.jsonl (append-only).
 *   Inclui: erros, stack traces, timeouts, falhas de parsing/OCR, exceções.
 *   Redação automática de: CPF, CNPJ, e-mail, telefone no campo "mensagem".
 *
 * ── LOG DE NEGÓCIO ────────────────────────────────────────────────────────────
 *   Para auditores, gestores e conformidade. Suficientemente detalhado.
 *   Persiste em logs-negocio.jsonl (append-only).
 *   Inclui: notas enviadas, campos alterados, divergências, exportações.
 *   Contém dados de negócio (identificadores, valores) — protegido por controle de acesso.
 *
 * JSONL: um JSON por linha. Append-only — nunca reescreve o arquivo.
 */

import fs             from 'fs';
import path           from 'path';
import { randomUUID } from 'crypto';
import type { LogTecnico, LogNegocio, NivelLog } from './auditoria-tipos';

// ─── VERSÃO ───────────────────────────────────────────────────────────────────

export const VERSAO_MOTOR = '11.0.0';

// ─── CAMINHOS ─────────────────────────────────────────────────────────────────

const DATA_DIR     = path.join(__dirname, 'data', 'auditoria');
const LOG_TEC_PATH = path.join(DATA_DIR, 'logs-tecnicos.jsonl');
const LOG_NEG_PATH = path.join(DATA_DIR, 'logs-negocio.jsonl');

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function appendLog(caminho: string, obj: unknown): void {
  ensureDir();
  fs.appendFileSync(caminho, JSON.stringify(obj) + '\n', 'utf-8');
}

// ─── REDAÇÃO DE PII ───────────────────────────────────────────────────────────

const REDACOES: Array<{ re: RegExp; label: string }> = [
  { re: /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g,                        label: '[CNPJ]'  },
  { re: /\d{3}\.\d{3}\.\d{3}-\d{2}/g,                               label: '[CPF]'   },
  { re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,         label: '[EMAIL]' },
  { re: /(?:\(\d{2}\)\s*)?\d{4,5}[-.\s]?\d{4}/g,                   label: '[TEL]'   },
];

function redigirPII(texto: string): string {
  let r = texto;
  for (const { re, label } of REDACOES) r = r.replace(re, label);
  return r;
}

function redigirObjeto(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') {
      out[k] = redigirPII(v);
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = redigirObjeto(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ─── LOG TÉCNICO ──────────────────────────────────────────────────────────────

export function logTecnico(
  nivel:        NivelLog,
  componente:   string,
  mensagem:     string,
  contexto?:    Record<string, unknown>,
  documentoId?: string | null,
  stackTrace?:  string | null,
): LogTecnico {
  const log: LogTecnico = {
    log_id:       randomUUID(),
    nivel,
    componente,
    mensagem:     redigirPII(mensagem),
    stack_trace:  stackTrace ?? null,
    contexto:     redigirObjeto(contexto ?? {}),
    documento_id: documentoId ?? null,
    timestamp:    new Date().toISOString(),
    versao_motor: VERSAO_MOTOR,
  };

  appendLog(LOG_TEC_PATH, log);

  if (nivel === 'ERROR' || nivel === 'FATAL') {
    console.error(`[${nivel}][${componente}] ${log.mensagem}`);
  }

  return log;
}

export function logDebug(componente: string, mensagem: string, ctx?: Record<string, unknown>, docId?: string): LogTecnico {
  return logTecnico('DEBUG', componente, mensagem, ctx, docId);
}

export function logInfo(componente: string, mensagem: string, ctx?: Record<string, unknown>, docId?: string): LogTecnico {
  return logTecnico('INFO', componente, mensagem, ctx, docId);
}

export function logWarn(componente: string, mensagem: string, ctx?: Record<string, unknown>, docId?: string): LogTecnico {
  return logTecnico('WARN', componente, mensagem, ctx, docId);
}

export function logError(
  componente:  string,
  mensagem:    string,
  erro?:       Error,
  contexto?:   Record<string, unknown>,
  documentoId?: string | null,
): LogTecnico {
  return logTecnico('ERROR', componente, mensagem, contexto, documentoId, erro?.stack ?? null);
}

export function logFatal(
  componente:  string,
  mensagem:    string,
  erro?:       Error,
  contexto?:   Record<string, unknown>,
): LogTecnico {
  return logTecnico('FATAL', componente, mensagem, contexto, null, erro?.stack ?? null);
}

// ─── LOG DE NEGÓCIO ───────────────────────────────────────────────────────────

export function logNegocio(
  acao:         string,
  entidade:     string,
  detalhes:     Record<string, unknown>,
  documentoId?: string | null,
  usuarioId?:   string | null,
  resultado?:   LogNegocio['resultado'],
): LogNegocio {
  const log: LogNegocio = {
    log_id:       randomUUID(),
    acao,
    entidade,
    documento_id: documentoId ?? null,
    usuario_id:   usuarioId  ?? null,
    detalhes,
    timestamp:    new Date().toISOString(),
    resultado:    resultado ?? 'SUCESSO',
  };
  appendLog(LOG_NEG_PATH, log);
  return log;
}

// ─── CONSULTAS ────────────────────────────────────────────────────────────────

function lerJsonl<T>(caminho: string, limite: number): T[] {
  ensureDir();
  if (!fs.existsSync(caminho)) return [];
  return fs
    .readFileSync(caminho, 'utf-8')
    .split('\n')
    .filter(l => l.trim())
    .slice(-limite)
    .map(l => JSON.parse(l) as T);
}

export function carregarLogsTecnicos(limite: number = 100): LogTecnico[] {
  return lerJsonl<LogTecnico>(LOG_TEC_PATH, limite);
}

export function carregarLogsNegocio(limite: number = 100): LogNegocio[] {
  return lerJsonl<LogNegocio>(LOG_NEG_PATH, limite);
}

export function carregarLogsTecnicosNivel(nivel: NivelLog, limite: number = 50): LogTecnico[] {
  return carregarLogsTecnicos(1000).filter(l => l.nivel === nivel).slice(-limite);
}

export function carregarLogsNegocioPorDocumento(documentoId: string, limite: number = 100): LogNegocio[] {
  return carregarLogsNegocio(5000).filter(l => l.documento_id === documentoId).slice(-limite);
}
