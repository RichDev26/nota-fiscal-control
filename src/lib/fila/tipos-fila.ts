/**
 * Fase 12 — Tipos Centrais da Camada de Produção
 *
 * Contratos TypeScript para fila, jobs, workers, métricas, alertas e recovery.
 */

// ─── JOB ─────────────────────────────────────────────────────────────────────

export type TipoJob =
  | 'UPLOAD'
  | 'PRE_PROCESSAMENTO'
  | 'OCR_LEITURA'
  | 'EXTRACAO'
  | 'VALIDACAO'
  | 'CONFIANCA_CONFLITO'
  | 'CORRECAO_REPROCESSAMENTO'
  | 'AUDITORIA'
  | 'EXPORTACAO'
  | 'LIMPEZA';

export type StatusJob =
  | 'PENDENTE'
  | 'EM_PROCESSAMENTO'
  | 'CONCLUIDO'
  | 'FALHA'
  | 'CANCELADO'
  | 'DEAD_LETTER';

export type CategoriaFalha =
  | 'FALHA_UPLOAD'
  | 'FALHA_LEITURA'
  | 'FALHA_OCR'
  | 'FALHA_PARSING'
  | 'FALHA_EXTRACAO'
  | 'FALHA_VALIDACAO'
  | 'FALHA_CONFIANCA'
  | 'FALHA_AUDITORIA'
  | 'FALHA_PERSISTENCIA'
  | 'FALHA_REDE'
  | 'FALHA_STORAGE'
  | 'FALHA_TIMEOUT'
  | 'FALHA_CONCORRENCIA'
  | 'FALHA_AUTORIZACAO'
  | 'FALHA_INTEGRIDADE';

export type SeveridadeAlerta = 'INFO' | 'AVISO' | 'CRITICO' | 'EMERGENCIA';

export interface ErroJob {
  categoria:     CategoriaFalha;
  mensagem:      string;
  stack?:        string;
  tentativa:     number;
  timestamp:     string;
  reprocessavel: boolean;
  codigo?:       string;
}

export interface JobFila {
  id:               string;
  tipo:             TipoJob;
  status:           StatusJob;
  prioridade:       number;
  tentativas:       number;
  maxTentativas:    number;
  documentoId:      string | null;
  arquivoHash:      string | null;
  payload:          Record<string, unknown>;
  resultado:        Record<string, unknown> | null;
  erro:             ErroJob | null;
  workerId:         string | null;
  iniciadoEm:       string | null;
  concluidoEm:      string | null;
  proximaTentativa: string | null;
  timeoutSegundos:  number;
  dependencias:     string[];
  versaoMotor:      string;
  usuarioId:        string | null;
  createdAt:        string;
  updatedAt:        string;
}

// ─── PAYLOADS TIPADOS ─────────────────────────────────────────────────────────

export interface PayloadUpload {
  nomeArquivo:   string;
  tamanhoBytes:  number;
  mimeType:      string;
  caminhoTemp:   string;
  usuarioId:     string;
  ipOrigem:      string;
}

export interface PayloadPreProcessamento {
  documentoId:    string;
  caminhoArquivo: string;
  arquivoHash:    string;
}

export interface PayloadOcrLeitura {
  documentoId:    string;
  caminhoArquivo: string;
  forcarOcr?:     boolean;
}

export interface PayloadExtracao {
  documentoId:    string;
  caminhoArquivo: string;
  fases?:         number[];
}

export interface PayloadValidacao {
  documentoId: string;
  resultado:   Record<string, unknown>;
}

export interface PayloadCorrecaoReprocessamento {
  documentoId:        string;
  correcoes:          Array<{ campo: string; valorNovo: string; usuarioId: string }>;
  reprocessamento_id: string;
}

export interface PayloadExportacao {
  documentoId: string;
  formato:     'JSON' | 'CSV' | 'XML' | 'PDF_RELATORIO';
  usuarioId:   string;
}

export interface PayloadLimpeza {
  dias:  number;
  tipos: Array<'TEMPORARIOS' | 'LOGS_ANTIGOS' | 'JOBS_CONCLUIDOS'>;
}

// ─── WORKER ──────────────────────────────────────────────────────────────────

export interface ConfigWorker {
  workerId:           string;
  tiposSuportados:    TipoJob[];
  concorrenciaMax:    number;
  intervaloPollingMs: number;
}

export interface ResultadoExecucao {
  sucesso:    boolean;
  resultado?: Record<string, unknown>;
  erro?:      ErroJob;
  duracaoMs:  number;
}

// ─── RETRY ───────────────────────────────────────────────────────────────────

export interface ConfigRetry {
  maxTentativas: number;
  backoffBaseS:  number;
  backoffMaxS:   number;
  jitter:        boolean;
}

export interface RegraFalha {
  categoria:        CategoriaFalha;
  reprocessavel:    boolean;
  irParaDeadLetter: boolean;
  deveAlertar:      boolean;
  causa:            string;
  acao:             string;
}

// ─── MÉTRICAS ─────────────────────────────────────────────────────────────────

export interface MetricaSnapshot {
  nome:       string;
  valor:      number;
  unidade?:   string;
  dimensoes?: Record<string, string>;
  timestamp:  string;
}

export interface RelatorioFila {
  timestamp:         string;
  total_pendentes:   number;
  total_processando: number;
  total_concluidos:  number;
  total_falhas:      number;
  total_dead_letter: number;
  por_tipo:          Record<string, Record<string, number>>;
  taxa_erro_1h:      number;
  latencia_media_ms: number;
  throughput_1h:     number;
  workers_ativos:    number;
}

// ─── ALERTAS ─────────────────────────────────────────────────────────────────

export interface RegraAlerta {
  nome:             string;
  descricao:        string;
  severidade:       SeveridadeAlerta;
  verificar:        (relatorio: RelatorioFila) => boolean;
  mensagem:         (relatorio: RelatorioFila) => string;
  acaoAutomatica?:  string;
  notificacao:      string;
}

// ─── RECOVERY ────────────────────────────────────────────────────────────────

export interface DiagnosticoJob {
  jobId:       string;
  tipo:        TipoJob;
  status:      StatusJob;
  tempoPresoS: number;
  acao:        'RECOLOCAR_FILA' | 'DEAD_LETTER' | 'CANCELAR' | 'IGNORAR';
  motivo:      string;
}

export interface ResultadoRecovery {
  timestamp:        string;
  jobs_verificados: number;
  jobs_recuperados: number;
  jobs_dead_letter: number;
  jobs_cancelados:  number;
  detalhes:         DiagnosticoJob[];
}

// ─── CONSTANTES ──────────────────────────────────────────────────────────────

export const VERSAO_MOTOR_FILA = '12.0.0';

export const PRIORIDADES = {
  CRITICA: 1,
  ALTA:    3,
  NORMAL:  5,
  BAIXA:   8,
  MINIMA:  10,
} as const;

export const TIMEOUTS_SEGUNDOS: Record<TipoJob, number> = {
  UPLOAD:                    30,
  PRE_PROCESSAMENTO:         60,
  OCR_LEITURA:              180,
  EXTRACAO:                  90,
  VALIDACAO:                 30,
  CONFIANCA_CONFLITO:        30,
  CORRECAO_REPROCESSAMENTO: 120,
  AUDITORIA:                 30,
  EXPORTACAO:                90,
  LIMPEZA:                  300,
};

export const CONFIG_RETRY_PADRAO: Record<TipoJob, ConfigRetry> = {
  UPLOAD:                    { maxTentativas: 3, backoffBaseS: 5,   backoffMaxS: 60,   jitter: true  },
  PRE_PROCESSAMENTO:         { maxTentativas: 3, backoffBaseS: 10,  backoffMaxS: 120,  jitter: true  },
  OCR_LEITURA:               { maxTentativas: 5, backoffBaseS: 30,  backoffMaxS: 600,  jitter: true  },
  EXTRACAO:                  { maxTentativas: 3, backoffBaseS: 15,  backoffMaxS: 180,  jitter: true  },
  VALIDACAO:                 { maxTentativas: 2, backoffBaseS: 10,  backoffMaxS: 60,   jitter: false },
  CONFIANCA_CONFLITO:        { maxTentativas: 2, backoffBaseS: 10,  backoffMaxS: 60,   jitter: false },
  CORRECAO_REPROCESSAMENTO:  { maxTentativas: 3, backoffBaseS: 30,  backoffMaxS: 300,  jitter: true  },
  AUDITORIA:                 { maxTentativas: 5, backoffBaseS: 5,   backoffMaxS: 60,   jitter: false },
  EXPORTACAO:                { maxTentativas: 3, backoffBaseS: 15,  backoffMaxS: 180,  jitter: true  },
  LIMPEZA:                   { maxTentativas: 1, backoffBaseS: 300, backoffMaxS: 3600, jitter: false },
};
