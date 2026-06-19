/**
 * Fase 12 — Simulação Completa de Produção
 *
 * Demonstra o fluxo completo de um PDF pelo sistema de produção:
 * upload → pré-processamento → OCR → extração → validação
 * → confiança → auditoria → exportação
 *
 * Inclui cenários de: sucesso, falha + retry, reprocessamento humano,
 * dead-letter, recovery e avaliação de alertas.
 *
 * Para executar: npx ts-node src/lib/fila/simulacao-producao.ts
 */

import { randomUUID }   from 'crypto';
import { criarJob, listarJobs, contarPorStatus } from './fila-manager';
import { calcularHashArquivo, verificarDuplicata } from './idempotencia';
import { avaliarAlertas, alertasAtivos }            from './alertas';
import { gerarRelatorioFila, snapshotMetricas }     from './monitoramento';
import { statusRecovery }                            from './recovery';
import { calcularProximaTentativa }                  from './retry';
import {
  PRIORIDADES, TIMEOUTS_SEGUNDOS, CONFIG_RETRY_PADRAO,
} from './tipos-fila';
import type { TipoJob } from './tipos-fila';

// ─── UTILITÁRIOS ─────────────────────────────────────────────────────────────

const sep  = (t: string) => { console.log(`\n${'═'.repeat(68)}\n  ${t}\n${'═'.repeat(68)}`); };
const ok   = (s: string) => console.log(`  ✓ ${s}`);
const info = (s: string) => console.log(`  · ${s}`);
const warn = (s: string) => console.log(`  ⚠ ${s}`);
const fail = (s: string) => console.log(`  ✗ ${s}`);

// ─── PDF MODELO ───────────────────────────────────────────────────────────────

const PDF_MODELO = {
  nomeArquivo:  'nfse_12345_prestador_modelo.pdf',
  tamanhoBytes: 187_432,
  mimeType:     'application/pdf',
  caminhoTemp:  '/tmp/uploads/nfse_12345_prestador_modelo.pdf',
  usuarioId:    'user_simulacao_f12',
  ipOrigem:     '192.168.1.100',
};

const BUFFER_SIMULADO = Buffer.from('PDF_MODELO_FASE_12_SIMULACAO_NFSE_PRESTADOR');

// ─── PASSO 1 — UPLOAD E IDEMPOTÊNCIA ─────────────────────────────────────────

async function simularUpload(): Promise<{ jobId: string; hashArquivo: string }> {
  sep('PASSO 1 — UPLOAD E VERIFICAÇÃO DE IDEMPOTÊNCIA');

  const hashArquivo = calcularHashArquivo(BUFFER_SIMULADO);
  info(`Hash sha256 do arquivo: ${hashArquivo.slice(0, 32)}...`);

  const duplicata = await verificarDuplicata(hashArquivo);
  if (duplicata.duplicata) {
    warn(`DUPLICATA DETECTADA — job existente: ${duplicata.jobId} (${duplicata.status})`);
    warn('Sistema retorna job existente sem reprocessar (idempotência garantida)');
    return { jobId: duplicata.jobId!, hashArquivo };
  }

  ok('Arquivo novo — prosseguindo com criação do job de upload');

  const job = await criarJob(
    'UPLOAD',
    {
      nomeArquivo:  PDF_MODELO.nomeArquivo,
      tamanhoBytes: PDF_MODELO.tamanhoBytes,
      mimeType:     PDF_MODELO.mimeType,
      caminhoTemp:  PDF_MODELO.caminhoTemp,
      usuarioId:    PDF_MODELO.usuarioId,
      ipOrigem:     PDF_MODELO.ipOrigem,
    },
    {
      prioridade:  PRIORIDADES.NORMAL,
      arquivoHash: hashArquivo,
      usuarioId:   PDF_MODELO.usuarioId,
    },
  );

  ok(`Job de upload criado: ${job.id}`);
  info(`Tipo: ${job.tipo} | Status: ${job.status} | Prioridade: ${job.prioridade}`);
  info(`Timeout: ${TIMEOUTS_SEGUNDOS.UPLOAD}s | MaxTentativas: ${CONFIG_RETRY_PADRAO.UPLOAD.maxTentativas}`);
  info(`Próxima tentativa: imediata (${job.proximaTentativa})`);

  return { jobId: job.id, hashArquivo };
}

// ─── PASSO 2 — CADEIA COMPLETA DE JOBS ───────────────────────────────────────

async function criarCadeiaJobs(
  uploadJobId: string,
  hashArquivo: string,
): Promise<Record<string, string>> {
  sep('PASSO 2 — CRIAÇÃO DA CADEIA COMPLETA DE JOBS');

  const documentoId = randomUUID();
  info(`Documento ID atribuído: ${documentoId}`);
  info(`Todos os jobs desta cadeia compartilham este documentoId`);

  const definicoes: Array<{
    tipo:   TipoJob;
    deps:   string[];
    extra?: Record<string, unknown>;
  }> = [
    { tipo: 'PRE_PROCESSAMENTO',
      deps: [uploadJobId],
      extra: { documentoId, caminhoArquivo: PDF_MODELO.caminhoTemp, arquivoHash: hashArquivo } },
    { tipo: 'OCR_LEITURA',          deps: ['PRE_PROCESSAMENTO'],
      extra: { documentoId, caminhoArquivo: PDF_MODELO.caminhoTemp } },
    { tipo: 'EXTRACAO',             deps: ['OCR_LEITURA'],
      extra: { documentoId, caminhoArquivo: PDF_MODELO.caminhoTemp } },
    { tipo: 'VALIDACAO',            deps: ['EXTRACAO'],
      extra: { documentoId, resultado: {} } },
    { tipo: 'CONFIANCA_CONFLITO',   deps: ['VALIDACAO'],
      extra: { documentoId } },
    { tipo: 'AUDITORIA',            deps: ['CONFIANCA_CONFLITO'],
      extra: { documentoId, eventosTipo: ['EXTRACAO_COMPLETA', 'VALIDACAO_CONCLUIDA'] } },
    { tipo: 'EXPORTACAO',           deps: ['AUDITORIA'],
      extra: { documentoId, formato: 'JSON', usuarioId: PDF_MODELO.usuarioId } },
  ];

  const ids: Record<string, string> = { UPLOAD: uploadJobId };

  for (const def of definicoes) {
    const depIds = def.deps.map(d => ids[d] ?? d);
    const job = await criarJob(
      def.tipo,
      def.extra ?? {},
      {
        documentoId,
        arquivoHash: hashArquivo,
        dependencias: depIds,
        prioridade:  def.tipo === 'EXTRACAO' ? PRIORIDADES.ALTA : PRIORIDADES.NORMAL,
      },
    );
    ids[def.tipo] = job.id;
    const depLabel = def.deps.join(' + ');
    ok(`${def.tipo.padEnd(26)}: ${job.id.slice(0, 8)}... (aguarda: ${depLabel})`);
  }

  info('\n  Cadeia: UPLOAD → PRE → OCR → EXTRACAO → VALIDACAO → CONFIANCA → AUDITORIA → EXPORTACAO');
  info('  EXTRACAO com prioridade ALTA — processada antes de jobs NORMAL se concorrente');

  return ids;
}

// ─── PASSO 3 — CENÁRIO DE FALHA E RETRY ──────────────────────────────────────

function simularCenarioFalha(): void {
  sep('PASSO 3 — CENÁRIO DE FALHA E RETRY (calculado)');

  const tipo   = 'OCR_LEITURA' as TipoJob;
  const config = CONFIG_RETRY_PADRAO[tipo];

  fail('Tentativa 1 de OCR falhou: timeout após 180s');
  info(`Categoria: FALHA_TIMEOUT | Reprocessável: SIM`);
  const t1 = calcularProximaTentativa(1, config);
  info(`Próxima tentativa em: ${t1.toISOString()} (backoff ~30s + jitter ±25%)`);

  fail('Tentativa 2 de OCR falhou: motor OCR indisponível (FALHA_REDE)');
  const t2 = calcularProximaTentativa(2, config);
  info(`Próxima tentativa em: ${t2.toISOString()} (backoff ~60s + jitter)`);

  fail('Tentativa 3 de OCR falhou: estrutura PDF não reconhecida (FALHA_PARSING)');
  info('FALHA_PARSING → irParaDeadLetter: SIM | reprocessavel: NÃO');
  warn('Job movido para DEAD_LETTER imediatamente — requer intervenção manual');
  info('Documento ficará em estado incompleto até revisão do analista');

  info('\n  TABELA DE REGRAS DE RETRY (OCR_LEITURA):');
  info(`  Max tentativas : ${config.maxTentativas}`);
  info(`  Backoff base   : ${config.backoffBaseS}s`);
  info(`  Backoff máximo : ${config.backoffMaxS}s`);
  info(`  Jitter         : ${config.jitter ? 'SIM (±25%)' : 'NÃO'}`);
}

// ─── PASSO 4 — CORREÇÃO HUMANA E REPROCESSAMENTO ─────────────────────────────

async function simularReprocessamento(documentoId: string): Promise<void> {
  sep('PASSO 4 — CORREÇÃO HUMANA E REPROCESSAMENTO');

  const reprocessamentoId = randomUUID();
  info('Usuário "supervisor_01" identificou 3 campos com valores incorretos');
  info('Acessando /correcao API → criando job CORRECAO_REPROCESSAMENTO');

  const corrJob = await criarJob(
    'CORRECAO_REPROCESSAMENTO',
    {
      documentoId,
      reprocessamento_id: reprocessamentoId,
      correcoes: [
        { campo: 'data_emissao',  valorNovo: '2024-03-15',          usuarioId: 'supervisor_01' },
        { campo: 'valor_bruto',   valorNovo: '5850.00',              usuarioId: 'supervisor_01' },
        { campo: 'cnpj_prestador', valorNovo: '12.345.678/0001-99', usuarioId: 'supervisor_01' },
      ],
    },
    {
      documentoId,
      prioridade: PRIORIDADES.ALTA,
      usuarioId:  'supervisor_01',
    },
  );

  ok(`Job CORRECAO_REPROCESSAMENTO criado: ${corrJob.id}`);
  info(`Reprocessamento ID: ${reprocessamentoId}`);
  info(`Prioridade: ALTA (${PRIORIDADES.ALTA}) — processado antes de jobs normais`);
  info(`Fase 10 (motor-correcoes) será acionada → aprendizado atualizado`);

  const audJob = await criarJob(
    'AUDITORIA',
    { documentoId, eventosTipo: ['CORRECAO_MANUAL', 'REPROCESSAMENTO', 'VERSAO_CRIADA'] },
    { documentoId, dependencias: [corrJob.id] },
  );
  ok(`Job AUDITORIA de reprocessamento: ${audJob.id} (aguarda correção)`);
  info('Fase 11 registrará: evento CORRECAO_MANUAL + nova versão do documento + linhagem atualizada');
}

// ─── PASSO 5 — ESTADO DA FILA ─────────────────────────────────────────────────

async function mostrarEstadoFila(): Promise<void> {
  sep('PASSO 5 — ESTADO DA FILA E MÉTRICAS');

  const [relatorio, metricas, contagens] = await Promise.all([
    gerarRelatorioFila(),
    snapshotMetricas(),
    contarPorStatus(),
  ]);

  console.log('\n  Contagens por status:');
  console.log(`    PENDENTE         : ${contagens.PENDENTE}`);
  console.log(`    EM_PROCESSAMENTO : ${contagens.EM_PROCESSAMENTO}`);
  console.log(`    CONCLUIDO        : ${contagens.CONCLUIDO}`);
  console.log(`    FALHA            : ${contagens.FALHA}`);
  console.log(`    CANCELADO        : ${contagens.CANCELADO}`);
  console.log(`    DEAD_LETTER      : ${contagens.DEAD_LETTER}`);

  console.log('\n  Métricas operacionais:');
  for (const m of metricas) {
    console.log(`    ${m.nome.padEnd(20)}: ${m.valor} ${m.unidade ?? ''}`);
  }

  console.log('\n  Distribuição por tipo:');
  for (const [tipo, statuses] of Object.entries(relatorio.por_tipo)) {
    const resumo = Object.entries(statuses)
      .map(([s, n]) => `${s}=${n}`)
      .join(', ');
    console.log(`    ${tipo.padEnd(28)}: ${resumo}`);
  }
}

// ─── PASSO 6 — ALERTAS ────────────────────────────────────────────────────────

async function mostrarAlertas(): Promise<void> {
  sep('PASSO 6 — AVALIAÇÃO DE ALERTAS');

  const resultado = await avaliarAlertas();
  info(`Regras avaliadas  : ${resultado.detalhes.length}`);
  info(`Novos alertas     : ${resultado.novos}`);
  info(`Alertas resolvidos: ${resultado.resolvidos}`);

  const ativos = await alertasAtivos();
  if (ativos.length === 0) {
    ok('Nenhum alerta ativo — sistema operando dentro dos limiares');
  } else {
    for (const a of ativos) warn(`[${a.severidade}] ${a.tipo}: ${a.mensagem}`);
  }

  console.log('\n  Resultado por regra:');
  for (const d of resultado.detalhes) {
    const status = d.ativo ? '⚠ ATIVO ' : '✓ OK    ';
    console.log(`    ${status} [${d.severidade.padEnd(10)}] ${d.nome}`);
  }
}

// ─── PASSO 7 — RECOVERY ───────────────────────────────────────────────────────

async function mostrarRecovery(): Promise<void> {
  sep('PASSO 7 — STATUS E RECOVERY');

  const status = await statusRecovery();
  info(`Jobs em processamento agora       : ${status.jobs_em_processamento}`);
  info(`Jobs potencialmente presos        : ${status.jobs_potencialmente_presos}`);
  info(`Pendentes com dependência bloqueada: ${status.pendentes_com_dep_bloqueada}`);

  if (
    status.jobs_potencialmente_presos === 0 &&
    status.pendentes_com_dep_bloqueada === 0
  ) {
    ok('Nenhuma anomalia detectada — recovery desnecessário');
  } else {
    warn('Anomalias detectadas — executarRecovery() acionaria correções automaticamente');
    info('Em produção: executarRecovery() roda a cada 2 min via cron ou API scheduled');
  }

  console.log('\n  PLANO DE RECOVERY POR CENÁRIO (resumo):');
  const cenarios = [
    ['worker_caiu',       'Automático — 2–5 min'],
    ['job_preso',         'Automático — 2–10 min'],
    ['arquivo_sumiu',     'Automático — retry imediato com backoff'],
    ['banco_caiu',        'Automático — retry 10–120s'],
    ['fila_travou',       'Manual — intervenção < 15 min'],
    ['resultado_parcial', 'Manual — reprocessamento via API'],
    ['dep_bloqueada',     'Automático — cancelamento imediato'],
  ];
  for (const [c, a] of cenarios) {
    console.log(`    ${c.padEnd(22)}: ${a}`);
  }
}

// ─── PASSO 8 — JOBS CRIADOS ───────────────────────────────────────────────────

async function mostrarJobsCriados(): Promise<void> {
  sep('PASSO 8 — LISTA DE JOBS CRIADOS NA SIMULAÇÃO');

  const jobs = await listarJobs({ limite: 25 });
  console.log(`\n  Total na fila: ${jobs.length} jobs\n`);
  console.log(
    '  ' + ['TIPO'.padEnd(28), 'STATUS'.padEnd(20), 'PRIO', 'TENT', 'DEPS'].join('  '),
  );
  console.log('  ' + '─'.repeat(72));
  for (const j of jobs) {
    console.log(
      '  ' + [
        j.tipo.padEnd(28),
        j.status.padEnd(20),
        String(j.prioridade).padEnd(4),
        String(j.tentativas).padEnd(4),
        String(j.dependencias.length),
      ].join('  '),
    );
  }
}

// ─── RECOMENDAÇÕES FASE 13 ───────────────────────────────────────────────────

function imprimirRecomendacoesFase13(): void {
  sep('RECOMENDAÇÕES PARA A FASE 13');

  const recomendacoes = [
    {
      prioridade: '★★★',
      area:       'Integração API → Motor (Fases 1-11)',
      descricao:  'Conectar src/app/api/pdf-extract/route.ts ao pipeline completo '
                + 'via validateCrossCheck(buffer) + todos os módulos de auditoria',
    },
    {
      prioridade: '★★★',
      area:       'Cron de Recovery',
      descricao:  'Registrar executarRecovery() + avaliarAlertas() como Next.js '
                + 'cron job (vercel-cron ou similar) a cada 2 minutos',
    },
    {
      prioridade: '★★★',
      area:       'API de Status de Job',
      descricao:  'GET /api/jobs/[id] para acompanhamento em tempo real; '
                + 'POST /api/correcao para disparar CORRECAO_REPROCESSAMENTO',
    },
    {
      prioridade: '★★',
      area:       'Dashboard de Monitoramento',
      descricao:  'API routes GET /api/fila/relatorio, /api/fila/alertas, '
                + '/api/fila/metricas para consumo pela UI',
    },
    {
      prioridade: '★★',
      area:       'Escalabilidade Horizontal',
      descricao:  'Migrar fila para Redis/BullMQ ou PostgreSQL para suportar '
                + 'múltiplos processos Node em paralelo (Railway ou similar)',
    },
    {
      prioridade: '★★',
      area:       'Notificações de Alerta',
      descricao:  'Integrar alertas CRITICO/EMERGENCIA com Resend (e-mail) ou '
                + 'webhook para Slack — especialmente worker_parado e dead_letter_critica',
    },
    {
      prioridade: '★',
      area:       'Limpeza Automatizada',
      descricao:  'Agendamento diário de job LIMPEZA para purgar temporários, '
                + 'métricas antigas (> 30 dias) e jobs concluídos (> 90 dias)',
    },
    {
      prioridade: '★',
      area:       'Tracing Distribuído',
      descricao:  'Adicionar trace_id propagado entre todos os jobs de um documento; '
                + 'correlacionar com Fase 11 (evento_pai_id) para rastreabilidade completa',
    },
  ];

  for (const r of recomendacoes) {
    console.log(`\n  ${r.prioridade} ${r.area}`);
    console.log(`     ${r.descricao}`);
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n' + '█'.repeat(68));
  console.log('  FASE 12 — SIMULAÇÃO DE PRODUÇÃO COMPLETA');
  console.log('  Motor NFS-e — Fila Assíncrona, Workers, Retry, Alertas e Recovery');
  console.log('  Versão do Motor: 12.0.0');
  console.log('█'.repeat(68));

  const { jobId, hashArquivo } = await simularUpload();
  const cadeia = await criarCadeiaJobs(jobId, hashArquivo);

  simularCenarioFalha();

  const docId = cadeia['AUDITORIA'] ? randomUUID() : randomUUID();
  await simularReprocessamento(docId);
  await mostrarEstadoFila();
  await mostrarAlertas();
  await mostrarRecovery();
  await mostrarJobsCriados();
  imprimirRecomendacoesFase13();

  sep('SIMULAÇÃO CONCLUÍDA');
  ok('Fase 12 — camada de produção criada com sucesso');
  ok('9 arquivos TypeScript em src/lib/fila/');
  ok('3 novos modelos Prisma: JobFila, MetricaFila, AlertaFila');
  ok('10 tipos de job, retry com backoff exponencial + jitter');
  ok('Idempotência por sha256, dead-letter, heartbeat, recovery automático');
  ok('8 regras de alerta com auto-resolução');
  info('\nPróximos passos: ver RECOMENDAÇÕES FASE 13 acima');
}

main().catch(err => {
  console.error('[SIMULACAO] Erro:', err);
  process.exit(1);
});
