/**
 * Fase 12 — Sistema de Alertas
 *
 * Avalia regras de alerta contra o relatório de fila e persiste
 * registros na tabela AlertaFila. Alertas são auto-resolvidos quando
 * a condição desaparece no próximo ciclo de avaliação.
 *
 * REGRAS IMPLEMENTADAS (8):
 *   fila_acumulando    — > 100 jobs pendentes     [AVISO]
 *   fila_critica       — > 500 jobs pendentes     [CRITICO]
 *   worker_parado      — 0 workers + fila cheia   [CRITICO]
 *   taxa_erro_alta     — > 15% de erros na 1h     [CRITICO]
 *   dead_letter_aviso  — > 20 jobs mortos         [AVISO]
 *   dead_letter_critica — > 100 jobs mortos       [EMERGENCIA]
 *   latencia_alta      — média > 5 min            [AVISO]
 *   throughput_zero    — 0 jobs/h + fila cheia    [CRITICO]
 */

import prisma from '../prisma';
import type { RelatorioFila, RegraAlerta, SeveridadeAlerta } from './tipos-fila';
import { gerarRelatorioFila } from './monitoramento';
import { logWarn, logError } from '../extractors/logger';

// ─── REGRAS ───────────────────────────────────────────────────────────────────

export const REGRAS_ALERTAS: RegraAlerta[] = [
  {
    nome:        'fila_acumulando',
    descricao:   'Fila principal com mais de 100 jobs pendentes',
    severidade:  'AVISO',
    verificar:   r => r.total_pendentes > 100,
    mensagem:    r => `Fila acumulando: ${r.total_pendentes} jobs pendentes`,
    notificacao: 'Verificar workers; considerar escalonamento horizontal',
  },
  {
    nome:            'fila_critica',
    descricao:       'Fila com mais de 500 jobs pendentes',
    severidade:      'CRITICO',
    verificar:       r => r.total_pendentes > 500,
    mensagem:        r => `FILA CRÍTICA: ${r.total_pendentes} jobs acumulados`,
    acaoAutomatica:  'escalar_workers',
    notificacao:     'Ação imediata — escalar workers ou pausar entrada de documentos',
  },
  {
    nome:        'worker_parado',
    descricao:   'Nenhum worker ativo com fila pendente',
    severidade:  'CRITICO',
    verificar:   r => r.workers_ativos === 0 && r.total_pendentes > 0,
    mensagem:    r => `Nenhum worker ativo — ${r.total_pendentes} jobs aguardando`,
    notificacao: 'Reiniciar workers imediatamente',
  },
  {
    nome:        'taxa_erro_alta',
    descricao:   'Taxa de erro acima de 15% na última hora',
    severidade:  'CRITICO',
    verificar:   r => r.taxa_erro_1h > 15,
    mensagem:    r => `Taxa de erro: ${r.taxa_erro_1h}% (limiar: 15%)`,
    notificacao: 'Investigar causa raiz; verificar logs de erro por fase',
  },
  {
    nome:        'dead_letter_aviso',
    descricao:   'Dead-letter com mais de 20 jobs',
    severidade:  'AVISO',
    verificar:   r => r.total_dead_letter > 20 && r.total_dead_letter <= 100,
    mensagem:    r => `Dead-letter acumulada: ${r.total_dead_letter} jobs`,
    notificacao: 'Revisar jobs e reprocessar manualmente os recuperáveis',
  },
  {
    nome:        'dead_letter_critica',
    descricao:   'Dead-letter com mais de 100 jobs',
    severidade:  'EMERGENCIA',
    verificar:   r => r.total_dead_letter > 100,
    mensagem:    r => `DEAD-LETTER CRÍTICA: ${r.total_dead_letter} jobs sem processamento`,
    notificacao: 'Incidente operacional — acionar plantão; investigar causa raiz',
  },
  {
    nome:        'latencia_alta',
    descricao:   'Latência média acima de 5 minutos',
    severidade:  'AVISO',
    verificar:   r => r.latencia_media_ms > 5 * 60 * 1000,
    mensagem:    r => `Latência média: ${Math.round(r.latencia_media_ms / 1000)}s (limiar: 300s)`,
    notificacao: 'Verificar carga do sistema e tempo de OCR',
  },
  {
    nome:        'throughput_zero',
    descricao:   'Zero throughput com fila não vazia',
    severidade:  'CRITICO',
    verificar:   r => r.throughput_1h === 0 && r.total_pendentes > 10,
    mensagem:    r => `Zero jobs processados com ${r.total_pendentes} pendentes na última hora`,
    notificacao: 'Worker pode estar travado — verificar recovery e logs',
  },
];

// ─── CRIAÇÃO E RESOLUÇÃO ──────────────────────────────────────────────────────

export async function criarAlerta(
  tipo:      string,
  severidade: SeveridadeAlerta,
  mensagem:  string,
  detalhes?: Record<string, unknown>,
): Promise<void> {
  // Não duplicar alerta aberto do mesmo tipo
  const existente = await prisma.alertaFila.findFirst({
    where: { tipo, resolvido: false },
  });
  if (existente) return;

  await prisma.alertaFila.create({
    data: {
      tipo,
      severidade,
      mensagem,
      detalhes: detalhes ? JSON.stringify(detalhes) : null,
    },
  });

  if (severidade === 'EMERGENCIA' || severidade === 'CRITICO') {
    logError('alertas', `[${severidade}] ${tipo}: ${mensagem}`);
  } else {
    logWarn('alertas', `[${severidade}] ${tipo}: ${mensagem}`);
  }
}

export async function resolverAlerta(tipo: string): Promise<void> {
  await prisma.alertaFila.updateMany({
    where: { tipo, resolvido: false },
    data:  { resolvido: true, resolvidoEm: new Date() },
  });
}

// ─── AVALIAÇÃO COMPLETA ───────────────────────────────────────────────────────

export async function avaliarAlertas(relatorio?: RelatorioFila): Promise<{
  novos:      number;
  resolvidos: number;
  detalhes:   Array<{ nome: string; ativo: boolean; severidade: SeveridadeAlerta }>;
}> {
  const rel = relatorio ?? await gerarRelatorioFila();
  let novos     = 0;
  let resolvidos = 0;
  const detalhes: Array<{ nome: string; ativo: boolean; severidade: SeveridadeAlerta }> = [];

  for (const regra of REGRAS_ALERTAS) {
    const ativo = regra.verificar(rel);

    if (ativo) {
      await criarAlerta(
        regra.nome,
        regra.severidade,
        regra.mensagem(rel),
        {
          throughput:    rel.throughput_1h,
          taxa_erro:     rel.taxa_erro_1h,
          pendentes:     rel.total_pendentes,
          dead_letter:   rel.total_dead_letter,
          workers_ativos: rel.workers_ativos,
        },
      );
      novos++;
    } else {
      const existente = await prisma.alertaFila.findFirst({
        where: { tipo: regra.nome, resolvido: false },
      });
      if (existente) {
        await resolverAlerta(regra.nome);
        resolvidos++;
      }
    }

    detalhes.push({ nome: regra.nome, ativo, severidade: regra.severidade });
  }

  return { novos, resolvidos, detalhes };
}

// ─── CONSULTAS ────────────────────────────────────────────────────────────────

export async function alertasAtivos(): Promise<Array<{
  id: string; tipo: string; severidade: string; mensagem: string; createdAt: string;
}>> {
  const rows = await prisma.alertaFila.findMany({
    where:   { resolvido: false },
    orderBy: [{ severidade: 'asc' }, { createdAt: 'desc' }],
  });
  return rows.map(r => ({
    id:         r.id,
    tipo:       r.tipo,
    severidade: r.severidade,
    mensagem:   r.mensagem,
    createdAt:  r.createdAt.toISOString(),
  }));
}

export async function historicoAlertas(limite: number = 50): Promise<Array<{
  id: string; tipo: string; severidade: string;
  resolvido: boolean; createdAt: string; resolvidoEm: string | null;
}>> {
  const rows = await prisma.alertaFila.findMany({
    orderBy: { createdAt: 'desc' },
    take:    limite,
  });
  return rows.map(r => ({
    id:         r.id,
    tipo:       r.tipo,
    severidade: r.severidade,
    resolvido:  r.resolvido,
    createdAt:  r.createdAt.toISOString(),
    resolvidoEm: r.resolvidoEm ? r.resolvidoEm.toISOString() : null,
  }));
}

export async function contarAlertasPorSeveridade(): Promise<Record<SeveridadeAlerta, number>> {
  const grupos = await prisma.alertaFila.groupBy({
    by:     ['severidade'],
    where:  { resolvido: false },
    _count: { severidade: true },
  });
  const base: Record<string, number> = {
    INFO: 0, AVISO: 0, CRITICO: 0, EMERGENCIA: 0,
  };
  for (const g of grupos) base[g.severidade] = g._count.severidade;
  return base as Record<SeveridadeAlerta, number>;
}
