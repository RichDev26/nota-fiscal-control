/**
 * Fase 12 — Idempotência e Deduplicação
 *
 * Garante que o mesmo arquivo não seja processado duas vezes.
 * Usa sha256 do conteúdo binário como chave de deduplicação.
 * O estado é consultado diretamente na tabela JobFila (campo arquivoHash).
 *
 * COMPORTAMENTO:
 *   - Jobs CANCELADOS e DEAD_LETTER são ignorados: o usuário pode reenviar
 *     deliberadamente um arquivo que falhou antes.
 *   - Janela de deduplicação: 24 horas (configurável).
 *   - Um job por tipo por arquivo ao mesmo tempo (sem processar OCR duas vezes).
 */

import crypto from 'crypto';
import prisma  from '../prisma';
import type { StatusJob } from './tipos-fila';

// ─── HASH ─────────────────────────────────────────────────────────────────────

export function calcularHashArquivo(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function calcularHashConteudo(obj: unknown): string {
  const str = JSON.stringify(obj, (_, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v))
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort());
    return v;
  });
  return crypto.createHash('sha256').update(str).digest('hex');
}

// ─── DEDUPLICAÇÃO ─────────────────────────────────────────────────────────────

export interface ResultadoDuplicata {
  duplicata:    boolean;
  jobId?:       string;
  documentoId?: string;
  status?:      StatusJob;
}

/**
 * Verifica se existe job recente (últimas 24h) para o mesmo hash de arquivo.
 * Jobs CANCELADOS e DEAD_LETTER são ignorados para permitir reenvio deliberado.
 */
export async function verificarDuplicata(
  hashArquivo: string,
  janelaHoras: number = 24,
): Promise<ResultadoDuplicata> {
  const desde = new Date(Date.now() - janelaHoras * 60 * 60 * 1000);

  const job = await prisma.jobFila.findFirst({
    where: {
      arquivoHash: hashArquivo,
      status:      { notIn: ['CANCELADO', 'DEAD_LETTER'] },
      createdAt:   { gte: desde },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!job) return { duplicata: false };

  return {
    duplicata:    true,
    jobId:        job.id,
    documentoId:  job.documentoId ?? undefined,
    status:       job.status as StatusJob,
  };
}

/**
 * Verifica se um documento já passou pelo job de AUDITORIA com sucesso,
 * indicando que seu pipeline completo foi finalizado.
 * Protege contra reprocessamento acidental após aprovação.
 */
export async function documentoJaFinalizado(documentoId: string): Promise<boolean> {
  const job = await prisma.jobFila.findFirst({
    where: {
      documentoId,
      tipo:   'AUDITORIA',
      status: 'CONCLUIDO',
    },
  });
  return job !== null;
}

/**
 * Verifica se já existe job do mesmo tipo para o mesmo arquivo em andamento.
 * Evita processar OCR, extração etc. duas vezes em paralelo.
 */
export async function jobDuplicadoPorTipo(
  tipo:        string,
  hashArquivo: string,
): Promise<boolean> {
  const job = await prisma.jobFila.findFirst({
    where: {
      tipo,
      arquivoHash: hashArquivo,
      status:      { in: ['PENDENTE', 'EM_PROCESSAMENTO'] },
    },
  });
  return job !== null;
}

/**
 * Retorna o status completo de idempotência para um hash.
 * Usado por APIs de upload para informar o usuário.
 */
export async function statusIdempotencia(hashArquivo: string): Promise<{
  processado:   boolean;
  emAndamento:  boolean;
  finalizado:   boolean;
  jobId?:       string;
  documentoId?: string;
  status?:      StatusJob;
}> {
  const job = await prisma.jobFila.findFirst({
    where:   { arquivoHash: hashArquivo },
    orderBy: { createdAt: 'desc' },
  });

  if (!job) return { processado: false, emAndamento: false, finalizado: false };

  const finalizado = job.documentoId
    ? await documentoJaFinalizado(job.documentoId)
    : false;

  return {
    processado:  true,
    emAndamento: ['PENDENTE', 'EM_PROCESSAMENTO'].includes(job.status),
    finalizado,
    jobId:       job.id,
    documentoId: job.documentoId ?? undefined,
    status:      job.status as StatusJob,
  };
}
