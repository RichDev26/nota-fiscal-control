/**
 * Fase 12 — Gerenciador de Fila
 *
 * Operações CRUD sobre a tabela JobFila (Prisma/SQLite).
 * A reivindicação de jobs é atômica via transação — SQLite garante
 * serialização de writes, impossibilitando que dois workers consumam o mesmo job.
 *
 * GARANTIAS:
 *   - Um job só pode ser consumido por um worker de cada vez
 *   - Retries são agendados com backoff exponencial
 *   - Jobs sem heartbeat são detectados pelo módulo de recovery
 *   - Dependências são verificadas antes de consumir
 *   - Dead-letter é irreversível sem ação manual explícita
 */

import { randomUUID } from 'crypto';
import prisma from '../prisma';
import type { JobFila, TipoJob, StatusJob, ErroJob } from './tipos-fila';
import {
  TIMEOUTS_SEGUNDOS, CONFIG_RETRY_PADRAO, VERSAO_MOTOR_FILA,
} from './tipos-fila';
import { calcularProximaTentativa, REGRAS_FALHA } from './retry';

// ─── SERIALIZAÇÃO ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToJob(row: any): JobFila {
  return {
    id:               String(row.id),
    tipo:             String(row.tipo) as TipoJob,
    status:           String(row.status) as StatusJob,
    prioridade:       Number(row.prioridade),
    tentativas:       Number(row.tentativas),
    maxTentativas:    Number(row.maxTentativas),
    documentoId:      row.documentoId   ?? null,
    arquivoHash:      row.arquivoHash   ?? null,
    payload:          JSON.parse(String(row.payload   || '{}')),
    resultado:        row.resultado ? JSON.parse(String(row.resultado)) : null,
    erro:             row.erro       ? JSON.parse(String(row.erro))     : null,
    workerId:         row.workerId   ?? null,
    iniciadoEm:       row.iniciadoEm  ? new Date(row.iniciadoEm).toISOString()       : null,
    concluidoEm:      row.concluidoEm ? new Date(row.concluidoEm).toISOString()      : null,
    proximaTentativa: row.proximaTentativa ? new Date(row.proximaTentativa).toISOString() : null,
    timeoutSegundos:  Number(row.timeoutSegundos),
    dependencias:     JSON.parse(String(row.dependencias || '[]')),
    versaoMotor:      String(row.versaoMotor),
    usuarioId:        row.usuarioId  ?? null,
    createdAt:        new Date(row.createdAt).toISOString(),
    updatedAt:        new Date(row.updatedAt).toISOString(),
  };
}

// ─── CRIAÇÃO ──────────────────────────────────────────────────────────────────

export interface OpcoesCriarJob {
  prioridade?:    number;
  documentoId?:   string;
  arquivoHash?:   string;
  dependencias?:  string[];
  usuarioId?:     string;
  maxTentativas?: number;
}

export async function criarJob(
  tipo:    TipoJob,
  payload: Record<string, unknown>,
  opcoes:  OpcoesCriarJob = {},
): Promise<JobFila> {
  const config = CONFIG_RETRY_PADRAO[tipo];
  const row    = await prisma.jobFila.create({
    data: {
      tipo,
      payload:          JSON.stringify(payload),
      prioridade:       opcoes.prioridade    ?? 5,
      documentoId:      opcoes.documentoId   ?? null,
      arquivoHash:      opcoes.arquivoHash   ?? null,
      dependencias:     JSON.stringify(opcoes.dependencias ?? []),
      usuarioId:        opcoes.usuarioId     ?? null,
      maxTentativas:    opcoes.maxTentativas ?? config.maxTentativas,
      timeoutSegundos:  TIMEOUTS_SEGUNDOS[tipo],
      proximaTentativa: new Date(),
      versaoMotor:      VERSAO_MOTOR_FILA,
      status:           'PENDENTE',
    },
  });
  return rowToJob(row);
}

// ─── CONSUMO ATÔMICO ──────────────────────────────────────────────────────────

/**
 * Reivindica atomicamente o próximo job elegível para um worker.
 * Usa transação Prisma para garantir que nenhum outro worker consuma o mesmo job.
 * Ordem de prioridade: prioridade ASC, createdAt ASC.
 */
export async function consumirProximoJob(
  workerId: string,
  tipo?:    TipoJob,
): Promise<JobFila | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resultado = await prisma.$transaction(async (tx: any) => {
    const where: Record<string, unknown> = {
      status:           'PENDENTE',
      proximaTentativa: { lte: new Date() },
    };
    if (tipo) where.tipo = tipo;

    const candidato = await tx.jobFila.findFirst({
      where,
      orderBy: [{ prioridade: 'asc' }, { createdAt: 'asc' }],
    });

    if (!candidato) return null;

    // Verificar dependências — todas devem estar CONCLUIDAS
    const deps = JSON.parse(candidato.dependencias || '[]') as string[];
    if (deps.length > 0) {
      const concluidos = await tx.jobFila.count({
        where: { id: { in: deps }, status: 'CONCLUIDO' },
      });
      if (concluidos < deps.length) return null;
    }

    return tx.jobFila.update({
      where: { id: candidato.id },
      data: {
        status:     'EM_PROCESSAMENTO',
        workerId,
        iniciadoEm: new Date(),
        tentativas: { increment: 1 },
      },
    });
  });

  return resultado ? rowToJob(resultado) : null;
}

// ─── CONCLUSÃO ────────────────────────────────────────────────────────────────

export async function concluirJob(
  jobId:     string,
  workerId:  string,
  resultado: Record<string, unknown>,
): Promise<void> {
  await prisma.jobFila.updateMany({
    where: { id: jobId, workerId, status: 'EM_PROCESSAMENTO' },
    data: {
      status:      'CONCLUIDO',
      resultado:   JSON.stringify(resultado),
      concluidoEm: new Date(),
    },
  });
}

// ─── FALHA E RETRY ────────────────────────────────────────────────────────────

export async function falharJob(
  jobId:    string,
  workerId: string,
  erro:     ErroJob,
): Promise<void> {
  const job = await prisma.jobFila.findUnique({ where: { id: jobId } });
  if (!job) return;

  const tipo          = job.tipo as TipoJob;
  const regra         = REGRAS_FALHA[erro.categoria];
  const tentativas    = Number(job.tentativas);
  const maxTentativas = Number(job.maxTentativas);

  const esgotado    = tentativas >= maxTentativas;
  const deadLetter  = regra.irParaDeadLetter || esgotado;

  if (deadLetter) {
    await prisma.jobFila.updateMany({
      where: { id: jobId, workerId },
      data: {
        status: 'DEAD_LETTER',
        erro:   JSON.stringify(erro),
      },
    });
    return;
  }

  const proxima = calcularProximaTentativa(tentativas, CONFIG_RETRY_PADRAO[tipo]);
  await prisma.jobFila.updateMany({
    where: { id: jobId, workerId },
    data: {
      status:           'PENDENTE',
      workerId:         null,
      erro:             JSON.stringify(erro),
      proximaTentativa: proxima,
    },
  });
}

// ─── DEAD-LETTER MANUAL ───────────────────────────────────────────────────────

export async function moverParaDeadLetter(jobId: string, motivo: string): Promise<void> {
  await prisma.jobFila.update({
    where: { id: jobId },
    data: {
      status: 'DEAD_LETTER',
      erro:   JSON.stringify({ motivo, timestamp: new Date().toISOString() }),
    },
  });
}

// ─── CANCELAMENTO ─────────────────────────────────────────────────────────────

export async function cancelarJob(jobId: string, motivo: string): Promise<void> {
  await prisma.jobFila.update({
    where: { id: jobId },
    data: {
      status: 'CANCELADO',
      erro:   JSON.stringify({ motivo, timestamp: new Date().toISOString() }),
    },
  });
}

// ─── RECOLOCAR NA FILA ────────────────────────────────────────────────────────

export async function recolocarNaFila(jobId: string): Promise<JobFila | null> {
  const job = await prisma.jobFila.findUnique({ where: { id: jobId } });
  if (!job) return null;

  const atualizado = await prisma.jobFila.update({
    where: { id: jobId },
    data: {
      status:           'PENDENTE',
      workerId:         null,
      tentativas:       0,
      iniciadoEm:       null,
      concluidoEm:      null,
      proximaTentativa: new Date(),
    },
  });
  return rowToJob(atualizado);
}

// ─── HEARTBEAT ────────────────────────────────────────────────────────────────

/**
 * Worker deve chamar heartbeat a cada ~30s para sinalizar que está vivo.
 * Recovery usa a ausência de heartbeat para detectar workers mortos.
 */
export async function heartbeat(jobId: string, workerId: string): Promise<void> {
  await prisma.jobFila.updateMany({
    where: { id: jobId, workerId, status: 'EM_PROCESSAMENTO' },
    data:  { updatedAt: new Date() },
  });
}

// ─── CONSULTAS ────────────────────────────────────────────────────────────────

export async function obterJob(jobId: string): Promise<JobFila | null> {
  const row = await prisma.jobFila.findUnique({ where: { id: jobId } });
  return row ? rowToJob(row) : null;
}

export interface FiltrosJob {
  tipo?:        TipoJob;
  status?:      StatusJob;
  documentoId?: string;
  limite?:      number;
  offset?:      number;
}

export async function listarJobs(filtros: FiltrosJob = {}): Promise<JobFila[]> {
  const rows = await prisma.jobFila.findMany({
    where: {
      tipo:        filtros.tipo        ?? undefined,
      status:      filtros.status      ?? undefined,
      documentoId: filtros.documentoId ?? undefined,
    },
    orderBy: [{ prioridade: 'asc' }, { createdAt: 'asc' }],
    take:    filtros.limite  ?? 50,
    skip:    filtros.offset  ?? 0,
  });
  return rows.map(rowToJob);
}

export async function contarPorStatus(): Promise<Record<StatusJob, number>> {
  const grupos = await prisma.jobFila.groupBy({
    by:     ['status'],
    _count: { status: true },
  });
  const base: Record<string, number> = {
    PENDENTE: 0, EM_PROCESSAMENTO: 0, CONCLUIDO: 0,
    FALHA: 0, CANCELADO: 0, DEAD_LETTER: 0,
  };
  for (const g of grupos) base[g.status] = g._count.status;
  return base as Record<StatusJob, number>;
}

/**
 * Retorna jobs EM_PROCESSAMENTO cujo updatedAt é mais antigo que 2× seu timeout.
 * Candidatos para recovery.
 */
export async function jobsPresosDetectados(): Promise<JobFila[]> {
  const agora = new Date();
  const rows  = await prisma.jobFila.findMany({
    where: { status: 'EM_PROCESSAMENTO' },
  });

  return rows
    .map(rowToJob)
    .filter(j => {
      if (!j.updatedAt) return false;
      const idadeS = (agora.getTime() - new Date(j.updatedAt).getTime()) / 1000;
      return idadeS > j.timeoutSegundos * 2;
    });
}

export async function purgarJobsConcluidos(diasRetencao: number = 30): Promise<number> {
  const limite = new Date(Date.now() - diasRetencao * 24 * 60 * 60 * 1000);
  const result = await prisma.jobFila.deleteMany({
    where: {
      status:      { in: ['CONCLUIDO', 'CANCELADO'] },
      concluidoEm: { lt: limite },
    },
  });
  return result.count;
}
