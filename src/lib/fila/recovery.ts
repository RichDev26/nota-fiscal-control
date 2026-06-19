/**
 * Fase 12 — Recovery e Resiliência
 *
 * Detecta e recupera jobs presos, workers mortos e estados inconsistentes.
 * Deve ser executado periodicamente (a cada 2 min via cron ou API agendada).
 *
 * CENÁRIOS COBERTOS:
 *   worker_caiu        — heartbeat parado > 2× timeout → recolocar ou dead-letter
 *   job_preso          — EM_PROCESSAMENTO sem progresso → recovery automático
 *   dep_bloqueada      — job dependendo de CANCELADO/DEAD_LETTER → cancelar
 *   arquivo_sumiu      — detectado no handler → FALHA_STORAGE → retry
 *   banco_caiu         — detectado no handler → FALHA_PERSISTENCIA → retry
 *   resultado_parcial  — reprocessamento forçado via API
 */

import prisma from '../prisma';
import type { DiagnosticoJob, ResultadoRecovery, TipoJob, StatusJob } from './tipos-fila';
import { recolocarNaFila, moverParaDeadLetter, cancelarJob } from './fila-manager';
import { logInfo, logWarn, logError } from '../extractors/logger';

// ─── DETECÇÃO DE JOBS PRESOS ──────────────────────────────────────────────────

export async function detectarJobsPresos(): Promise<DiagnosticoJob[]> {
  const agora          = new Date();
  const emProcessamento = await prisma.jobFila.findMany({
    where: { status: 'EM_PROCESSAMENTO' },
  });

  const diagnosticos: DiagnosticoJob[] = [];

  for (const job of emProcessamento) {
    const idadeS         = (agora.getTime() - new Date(job.updatedAt).getTime()) / 1000;
    const gracePeriodS   = Number(job.timeoutSegundos) * 2;

    if (idadeS <= gracePeriodS) continue;

    const tentativas    = Number(job.tentativas);
    const maxTentativas = Number(job.maxTentativas);

    const acao: DiagnosticoJob['acao']  = tentativas >= maxTentativas
      ? 'DEAD_LETTER'
      : 'RECOLOCAR_FILA';

    const motivo = tentativas >= maxTentativas
      ? `Esgotou ${maxTentativas} tentativas e travou por ${Math.round(idadeS)}s sem heartbeat`
      : `Sem heartbeat por ${Math.round(idadeS)}s (timeout configurado: ${job.timeoutSegundos}s)`;

    diagnosticos.push({
      jobId:       job.id,
      tipo:        job.tipo as TipoJob,
      status:      job.status as StatusJob,
      tempoPresoS: Math.round(idadeS),
      acao,
      motivo,
    });
  }

  return diagnosticos;
}

// ─── DETECÇÃO DE DEPENDÊNCIAS BLOQUEADAS ──────────────────────────────────────

export async function detectarDependenciasBloqueadas(): Promise<DiagnosticoJob[]> {
  const pendentes     = await prisma.jobFila.findMany({ where: { status: 'PENDENTE' } });
  const diagnosticos: DiagnosticoJob[] = [];

  for (const job of pendentes) {
    const deps = JSON.parse(job.dependencias as string || '[]') as string[];
    if (deps.length === 0) continue;

    const bloqueadas = await prisma.jobFila.findMany({
      where: { id: { in: deps }, status: { in: ['CANCELADO', 'DEAD_LETTER'] } },
    });

    if (bloqueadas.length === 0) continue;

    diagnosticos.push({
      jobId:       job.id,
      tipo:        job.tipo as TipoJob,
      status:      job.status as StatusJob,
      tempoPresoS: 0,
      acao:        'CANCELAR',
      motivo:      `Dependência(s) ${bloqueadas.map(d => d.id).join(', ')} em estado terminal`,
    });
  }

  return diagnosticos;
}

// ─── EXECUÇÃO DO CICLO DE RECOVERY ───────────────────────────────────────────

export async function executarRecovery(): Promise<ResultadoRecovery> {
  const inicio    = new Date();
  let recuperados = 0;
  let deadLetters = 0;
  let cancelados  = 0;
  const detalhes: DiagnosticoJob[] = [];

  logInfo('recovery', 'Iniciando ciclo de recovery');

  // 1. Jobs presos por timeout de heartbeat
  const presos = await detectarJobsPresos();
  for (const d of presos) {
    try {
      if (d.acao === 'RECOLOCAR_FILA') {
        await recolocarNaFila(d.jobId);
        recuperados++;
        logWarn('recovery', `Recuperado: ${d.jobId} (${d.tipo}) — ${d.motivo}`);
      } else {
        await moverParaDeadLetter(d.jobId, d.motivo);
        deadLetters++;
        logError('recovery', `Dead-letter: ${d.jobId} (${d.tipo}) — ${d.motivo}`);
      }
    } catch (err) {
      logError('recovery', `Falha ao processar job preso ${d.jobId}`, err as Error);
    }
    detalhes.push(d);
  }

  // 2. Jobs com dependências terminadas
  const bloqueados = await detectarDependenciasBloqueadas();
  for (const d of bloqueados) {
    try {
      await cancelarJob(d.jobId, d.motivo);
      cancelados++;
      logWarn('recovery', `Cancelado por dep. bloqueada: ${d.jobId} — ${d.motivo}`);
    } catch (err) {
      logError('recovery', `Falha ao cancelar job ${d.jobId}`, err as Error);
    }
    detalhes.push(d);
  }

  const resultado: ResultadoRecovery = {
    timestamp:        inicio.toISOString(),
    jobs_verificados: presos.length + bloqueados.length,
    jobs_recuperados: recuperados,
    jobs_dead_letter: deadLetters,
    jobs_cancelados:  cancelados,
    detalhes,
  };

  logInfo('recovery', 'Ciclo concluído', {
    verificados: resultado.jobs_verificados,
    recuperados: resultado.jobs_recuperados,
    dead_letter: resultado.jobs_dead_letter,
    cancelados:  resultado.jobs_cancelados,
  });

  return resultado;
}

// ─── STATUS RÁPIDO ────────────────────────────────────────────────────────────

export async function statusRecovery(): Promise<{
  jobs_em_processamento:      number;
  jobs_potencialmente_presos: number;
  pendentes_com_dep_bloqueada: number;
}> {
  const [emProcessamento, presos, bloqueados] = await Promise.all([
    prisma.jobFila.count({ where: { status: 'EM_PROCESSAMENTO' } }),
    detectarJobsPresos(),
    detectarDependenciasBloqueadas(),
  ]);

  return {
    jobs_em_processamento:       emProcessamento,
    jobs_potencialmente_presos:  presos.length,
    pendentes_com_dep_bloqueada: bloqueados.length,
  };
}

// ─── PLANO DE RECOVERY POR CENÁRIO ───────────────────────────────────────────

export const PLANO_RECOVERY: Record<string, {
  cenario:    string;
  acao:       string;
  automatico: boolean;
  tempoResposta: string;
}> = {
  worker_caiu: {
    cenario:       'Worker morreu durante processamento de um job',
    acao:          'detectarJobsPresos() → recolocarNaFila() após 2× o timeout configurado',
    automatico:    true,
    tempoResposta: '2–5 minutos (próximo ciclo de recovery)',
  },
  job_preso: {
    cenario:       'Job em EM_PROCESSAMENTO sem atualização de heartbeat',
    acao:          'Recovery automático a cada ciclo (2 min)',
    automatico:    true,
    tempoResposta: '2–10 minutos',
  },
  arquivo_sumiu: {
    cenario:       'Arquivo não encontrado no storage durante processamento',
    acao:          'Handler lança FALHA_STORAGE → retry com backoff; após 3 tentativas → dead-letter',
    automatico:    true,
    tempoResposta: 'Retry imediato com backoff exponencial',
  },
  banco_caiu: {
    cenario:       'Banco de dados inacessível durante operação de job',
    acao:          'Handler lança FALHA_PERSISTENCIA → retry; alerta emitido se persistir',
    automatico:    true,
    tempoResposta: 'Retry com backoff de 10–120s',
  },
  storage_caiu: {
    cenario:       'Storage de arquivos inacessível',
    acao:          'FALHA_STORAGE → retry; alerta worker_parado se acumular',
    automatico:    true,
    tempoResposta: 'Alerta em < 5 min',
  },
  fila_travou: {
    cenario:       'Worker parou de consumir jobs da fila sem morrer',
    acao:          'Alerta worker_parado → reiniciar worker via orquestrador ou manualmente',
    automatico:    false,
    tempoResposta: 'Intervenção manual em < 15 min',
  },
  resultado_parcial: {
    cenario:       'Job concluiu parcialmente antes de uma interrupção',
    acao:          'Reprocessamento forçado via API com payload reprocessamento_id=novo',
    automatico:    false,
    tempoResposta: 'Manual; job CORRECAO_REPROCESSAMENTO criado com prioridade ALTA',
  },
  dep_bloqueada: {
    cenario:       'Job PENDENTE dependendo de job em estado CANCELADO ou DEAD_LETTER',
    acao:          'cancelarJob() automático com motivo explicando a dependência terminal',
    automatico:    true,
    tempoResposta: '2 minutos (próximo ciclo de recovery)',
  },
};
