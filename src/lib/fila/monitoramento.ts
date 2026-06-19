/**
 * Fase 12 — Monitoramento e Métricas
 *
 * Registra métricas de operação na tabela MetricaFila e gera relatórios
 * de estado da fila para consumo pelos alertas e dashboards.
 *
 * MÉTRICAS OPERACIONAIS : latência, throughput, taxa de erro, workers ativos
 * MÉTRICAS DE NEGÓCIO   : documentos processados, acerto por campo
 * MÉTRICAS DE QUALIDADE : confiança média, correções humanas, reprocessamentos
 * MÉTRICAS DE FILA      : profundidade, jobs presos, dead-letter acumulado
 * MÉTRICAS DE OCR       : taxa de sucesso, latência por método
 */

import prisma from '../prisma';
import type { MetricaSnapshot, RelatorioFila } from './tipos-fila';

// ─── REGISTRO PRIMITIVO ───────────────────────────────────────────────────────

export async function registrarMetrica(
  nome:      string,
  valor:     number,
  unidade?:  string,
  dimensoes?: Record<string, string>,
): Promise<void> {
  await prisma.metricaFila.create({
    data: {
      nome,
      valor,
      unidade:   unidade   ?? null,
      dimensoes: dimensoes ? JSON.stringify(dimensoes) : null,
    },
  });
}

// ─── HELPERS SEMÂNTICOS ───────────────────────────────────────────────────────

export async function metricaJobConcluido(tipo: string, duracaoMs: number): Promise<void> {
  await Promise.all([
    registrarMetrica('job.concluido.total',  1,         'jobs', { tipo }),
    registrarMetrica('job.latencia.ms',      duracaoMs, 'ms',   { tipo }),
  ]);
}

export async function metricaJobFalhou(tipo: string, categoria: string): Promise<void> {
  await registrarMetrica('job.falha.total', 1, 'jobs', { tipo, categoria });
}

export async function metricaJobDeadLetter(tipo: string): Promise<void> {
  await registrarMetrica('job.dead_letter.total', 1, 'jobs', { tipo });
}

export async function metricaOcr(sucesso: boolean, duracaoMs: number): Promise<void> {
  await Promise.all([
    registrarMetrica('ocr.total',       1,         'jobs', { resultado: sucesso ? 'ok' : 'falha' }),
    registrarMetrica('ocr.latencia.ms', duracaoMs, 'ms',   {}),
  ]);
}

export async function metricaConfiancaMedia(confianca: number): Promise<void> {
  await registrarMetrica('extracao.confianca.media', confianca, '%');
}

export async function metricaCorrecaoHumana(campo: string): Promise<void> {
  await registrarMetrica('correcao.humana.total', 1, 'correcoes', { campo });
}

export async function metricaReprocessamento(): Promise<void> {
  await registrarMetrica('reprocessamento.total', 1, 'jobs');
}

export async function metricaExportacao(formato: string, duracaoMs: number): Promise<void> {
  await Promise.all([
    registrarMetrica('exportacao.total',       1,         'jobs', { formato }),
    registrarMetrica('exportacao.latencia.ms', duracaoMs, 'ms',   { formato }),
  ]);
}

export async function metricaRetry(tipo: string, tentativa: number): Promise<void> {
  await registrarMetrica('job.retry.total', 1, 'jobs', { tipo, tentativa: String(tentativa) });
}

export async function metricaCampoAcerto(campo: string, acertou: boolean): Promise<void> {
  await registrarMetrica(
    'campo.acerto.total', 1, 'campos',
    { campo, resultado: acertou ? 'acerto' : 'correcao' },
  );
}

// ─── RELATÓRIO DA FILA ────────────────────────────────────────────────────────

export async function gerarRelatorioFila(): Promise<RelatorioFila> {
  const agora          = new Date();
  const umaHoraAtras   = new Date(agora.getTime() - 60 * 60 * 1000);

  const [contagens, porTipo, concluidos1h, falhas1h, latencias, workersAtivos] =
    await Promise.all([
      prisma.jobFila.groupBy({ by: ['status'],        _count: { status: true } }),
      prisma.jobFila.groupBy({ by: ['tipo', 'status'], _count: { status: true } }),
      prisma.jobFila.count({
        where: { status: 'CONCLUIDO', concluidoEm: { gte: umaHoraAtras } },
      }),
      prisma.jobFila.count({
        where: { status: { in: ['FALHA', 'DEAD_LETTER'] }, updatedAt: { gte: umaHoraAtras } },
      }),
      prisma.jobFila.findMany({
        where: {
          status:      'CONCLUIDO',
          concluidoEm: { gte: umaHoraAtras },
          iniciadoEm:  { not: null },
        },
        select: { iniciadoEm: true, concluidoEm: true },
      }),
      prisma.jobFila.count({
        where: {
          status:    'EM_PROCESSAMENTO',
          updatedAt: { gte: new Date(agora.getTime() - 60_000) },
        },
      }),
    ]);

  const statusMap: Record<string, number> = {};
  for (const g of contagens) statusMap[g.status] = g._count.status;

  const porTipoMap: Record<string, Record<string, number>> = {};
  for (const g of porTipo) {
    if (!porTipoMap[g.tipo]) porTipoMap[g.tipo] = {};
    porTipoMap[g.tipo][g.status] = g._count.status;
  }

  const totalFinal = concluidos1h + falhas1h;
  const taxaErro   = totalFinal > 0 ? (falhas1h / totalFinal) * 100 : 0;

  let latenciaMedia = 0;
  if (latencias.length > 0) {
    const soma = latencias.reduce((acc, j) => {
      if (!j.iniciadoEm || !j.concluidoEm) return acc;
      return acc + (new Date(j.concluidoEm).getTime() - new Date(j.iniciadoEm).getTime());
    }, 0);
    latenciaMedia = soma / latencias.length;
  }

  return {
    timestamp:         agora.toISOString(),
    total_pendentes:   statusMap['PENDENTE']         ?? 0,
    total_processando: statusMap['EM_PROCESSAMENTO'] ?? 0,
    total_concluidos:  statusMap['CONCLUIDO']        ?? 0,
    total_falhas:      (statusMap['FALHA'] ?? 0) + (statusMap['DEAD_LETTER'] ?? 0),
    total_dead_letter: statusMap['DEAD_LETTER']      ?? 0,
    por_tipo:          porTipoMap,
    taxa_erro_1h:      Math.round(taxaErro * 10) / 10,
    latencia_media_ms: Math.round(latenciaMedia),
    throughput_1h:     concluidos1h,
    workers_ativos:    workersAtivos,
  };
}

// ─── TENDÊNCIAS ───────────────────────────────────────────────────────────────

export async function tendencias(
  nome:           string,
  periodoMinutos: number = 60,
): Promise<Array<{ timestamp: string; valor: number }>> {
  const desde = new Date(Date.now() - periodoMinutos * 60 * 1000);
  const rows  = await prisma.metricaFila.findMany({
    where:   { nome, timestamp: { gte: desde } },
    orderBy: { timestamp: 'asc' },
    select:  { timestamp: true, valor: true },
  });
  return rows.map(m => ({ timestamp: m.timestamp.toISOString(), valor: m.valor }));
}

export async function somaMetrica(nome: string, periodoMinutos: number = 60): Promise<number> {
  const desde = new Date(Date.now() - periodoMinutos * 60 * 1000);
  const res   = await prisma.metricaFila.aggregate({
    where: { nome, timestamp: { gte: desde } },
    _sum:  { valor: true },
  });
  return res._sum.valor ?? 0;
}

export async function mediaMetrica(nome: string, periodoMinutos: number = 60): Promise<number> {
  const desde = new Date(Date.now() - periodoMinutos * 60 * 1000);
  const res   = await prisma.metricaFila.aggregate({
    where: { nome, timestamp: { gte: desde } },
    _avg:  { valor: true },
  });
  return res._avg.valor ?? 0;
}

// ─── SNAPSHOT COMPLETO ────────────────────────────────────────────────────────

export async function snapshotMetricas(): Promise<MetricaSnapshot[]> {
  const rel = await gerarRelatorioFila();
  const ts  = rel.timestamp;
  return [
    { nome: 'fila.pendentes',   valor: rel.total_pendentes,   unidade: 'jobs',     timestamp: ts },
    { nome: 'fila.processando', valor: rel.total_processando, unidade: 'jobs',     timestamp: ts },
    { nome: 'fila.concluidos',  valor: rel.total_concluidos,  unidade: 'jobs',     timestamp: ts },
    { nome: 'fila.falhas',      valor: rel.total_falhas,      unidade: 'jobs',     timestamp: ts },
    { nome: 'fila.dead_letter', valor: rel.total_dead_letter, unidade: 'jobs',     timestamp: ts },
    { nome: 'fila.taxa_erro',   valor: rel.taxa_erro_1h,      unidade: '%',        timestamp: ts },
    { nome: 'fila.latencia',    valor: rel.latencia_media_ms, unidade: 'ms',       timestamp: ts },
    { nome: 'fila.throughput',  valor: rel.throughput_1h,     unidade: 'jobs/h',   timestamp: ts },
    { nome: 'workers.ativos',   valor: rel.workers_ativos,    unidade: 'workers',  timestamp: ts },
  ];
}

// ─── PURGA ────────────────────────────────────────────────────────────────────

export async function purgarMetricasAntigas(diasRetencao: number = 30): Promise<number> {
  const limite   = new Date(Date.now() - diasRetencao * 24 * 60 * 60 * 1000);
  const resultado = await prisma.metricaFila.deleteMany({
    where: { timestamp: { lt: limite } },
  });
  return resultado.count;
}
