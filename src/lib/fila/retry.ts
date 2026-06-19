/**
 * Fase 12 — Lógica de Retry e Classificação de Falhas
 *
 * Calcula backoff exponencial com jitter, classifica falhas por categoria
 * e define regras de reprocessamento por tipo de erro.
 */

import type { CategoriaFalha, ConfigRetry, ErroJob, RegraFalha, TipoJob } from './tipos-fila';
import { CONFIG_RETRY_PADRAO } from './tipos-fila';

// ─── BACKOFF ──────────────────────────────────────────────────────────────────

export function calcularProximaTentativa(tentativas: number, config: ConfigRetry): Date {
  let backoffS = config.backoffBaseS * Math.pow(2, tentativas - 1);
  backoffS     = Math.min(backoffS, config.backoffMaxS);

  if (config.jitter) {
    // ±25% de jitter para evitar thundering herd
    backoffS += backoffS * 0.25 * (Math.random() * 2 - 1);
  }

  return new Date(Date.now() + Math.max(1, Math.round(backoffS)) * 1000);
}

export function getConfigRetry(tipo: TipoJob): ConfigRetry {
  return CONFIG_RETRY_PADRAO[tipo];
}

export function deveReprocessar(tentativas: number, tipo: TipoJob): boolean {
  return tentativas < CONFIG_RETRY_PADRAO[tipo].maxTentativas;
}

// ─── REGRAS POR CATEGORIA DE FALHA ───────────────────────────────────────────

export const REGRAS_FALHA: Record<CategoriaFalha, RegraFalha> = {
  FALHA_UPLOAD: {
    categoria:        'FALHA_UPLOAD',
    reprocessavel:    true,
    irParaDeadLetter: false,
    deveAlertar:      false,
    causa: 'Arquivo não pôde ser recebido ou armazenado',
    acao:  'Recolocar na fila após backoff',
  },
  FALHA_LEITURA: {
    categoria:        'FALHA_LEITURA',
    reprocessavel:    true,
    irParaDeadLetter: false,
    deveAlertar:      false,
    causa: 'Arquivo não pôde ser lido (I/O ou storage)',
    acao:  'Recolocar na fila; após 3 tentativas, dead-letter',
  },
  FALHA_OCR: {
    categoria:        'FALHA_OCR',
    reprocessavel:    true,
    irParaDeadLetter: false,
    deveAlertar:      true,
    causa: 'Motor OCR não conseguiu processar a imagem do PDF',
    acao:  'Recolocar com backoff longo; alertar após 3 falhas consecutivas',
  },
  FALHA_PARSING: {
    categoria:        'FALHA_PARSING',
    reprocessavel:    false,
    irParaDeadLetter: true,
    deveAlertar:      true,
    causa: 'Estrutura do PDF não reconhecida pelo parser',
    acao:  'Dead-letter imediato; alerta manual',
  },
  FALHA_EXTRACAO: {
    categoria:        'FALHA_EXTRACAO',
    reprocessavel:    true,
    irParaDeadLetter: false,
    deveAlertar:      false,
    causa: 'Motor de extração falhou em uma ou mais fases',
    acao:  'Recolocar na fila; após esgotamento, dead-letter',
  },
  FALHA_VALIDACAO: {
    categoria:        'FALHA_VALIDACAO',
    reprocessavel:    false,
    irParaDeadLetter: false,
    deveAlertar:      false,
    causa: 'Dados extraídos não passaram na validação estrutural ou fiscal',
    acao:  'Marcar como FALHA com resultado parcial; aguardar correção humana',
  },
  FALHA_CONFIANCA: {
    categoria:        'FALHA_CONFIANCA',
    reprocessavel:    false,
    irParaDeadLetter: false,
    deveAlertar:      false,
    causa: 'Confiança global abaixo do limiar mínimo',
    acao:  'Marcar como FALHA; solicitar revisão manual',
  },
  FALHA_AUDITORIA: {
    categoria:        'FALHA_AUDITORIA',
    reprocessavel:    true,
    irParaDeadLetter: false,
    deveAlertar:      true,
    causa: 'Falha ao registrar evento de auditoria',
    acao:  'Retentar auditoria sem bloquear resultado principal',
  },
  FALHA_PERSISTENCIA: {
    categoria:        'FALHA_PERSISTENCIA',
    reprocessavel:    true,
    irParaDeadLetter: false,
    deveAlertar:      true,
    causa: 'Banco de dados indisponível ou erro de escrita',
    acao:  'Recolocar com backoff; alertar equipe se persistir',
  },
  FALHA_REDE: {
    categoria:        'FALHA_REDE',
    reprocessavel:    true,
    irParaDeadLetter: false,
    deveAlertar:      false,
    causa: 'Timeout ou erro de conexão com serviço externo',
    acao:  'Recolocar com backoff exponencial',
  },
  FALHA_STORAGE: {
    categoria:        'FALHA_STORAGE',
    reprocessavel:    true,
    irParaDeadLetter: false,
    deveAlertar:      true,
    causa: 'Storage de arquivos inacessível',
    acao:  'Recolocar; alertar se storage permanecer indisponível',
  },
  FALHA_TIMEOUT: {
    categoria:        'FALHA_TIMEOUT',
    reprocessavel:    true,
    irParaDeadLetter: false,
    deveAlertar:      false,
    causa: 'Job excedeu o tempo máximo de execução',
    acao:  'Recolocar com backoff; após 2 timeouts consecutivos, dead-letter',
  },
  FALHA_CONCORRENCIA: {
    categoria:        'FALHA_CONCORRENCIA',
    reprocessavel:    true,
    irParaDeadLetter: false,
    deveAlertar:      false,
    causa: 'Conflito de concorrência ou lock no banco',
    acao:  'Recolocar imediatamente com jitter pequeno',
  },
  FALHA_AUTORIZACAO: {
    categoria:        'FALHA_AUTORIZACAO',
    reprocessavel:    false,
    irParaDeadLetter: true,
    deveAlertar:      true,
    causa: 'Job sem permissão para executar a operação',
    acao:  'Dead-letter imediato; alerta de segurança',
  },
  FALHA_INTEGRIDADE: {
    categoria:        'FALHA_INTEGRIDADE',
    reprocessavel:    false,
    irParaDeadLetter: true,
    deveAlertar:      true,
    causa: 'Hash do arquivo não coincide; possível corrupção',
    acao:  'Dead-letter; notificar responsável pelo documento',
  },
};

// ─── CLASSIFICAÇÃO AUTOMÁTICA ─────────────────────────────────────────────────

export function classificarFalha(erro: Error | string): CategoriaFalha {
  const msg   = typeof erro === 'string' ? erro : erro.message;
  const lower = msg.toLowerCase();

  if (lower.includes('timeout') || lower.includes('timed out'))       return 'FALHA_TIMEOUT';
  if (lower.includes('network') || lower.includes('econnrefused'))    return 'FALHA_REDE';
  if (lower.includes('storage') || lower.includes('enoent'))          return 'FALHA_STORAGE';
  if (lower.includes('ocr'))                                           return 'FALHA_OCR';
  if (lower.includes('parse') || lower.includes('parsing'))           return 'FALHA_PARSING';
  if (lower.includes('database') || lower.includes('prisma'))         return 'FALHA_PERSISTENCIA';
  if (lower.includes('hash') || lower.includes('integr'))             return 'FALHA_INTEGRIDADE';
  if (lower.includes('autoriza') || lower.includes('forbidden'))      return 'FALHA_AUTORIZACAO';
  if (lower.includes('concurrent') || lower.includes('lock'))         return 'FALHA_CONCORRENCIA';
  if (lower.includes('extract') || lower.includes('extração'))        return 'FALHA_EXTRACAO';
  if (lower.includes('valid'))                                         return 'FALHA_VALIDACAO';
  if (lower.includes('confiança') || lower.includes('confianca'))     return 'FALHA_CONFIANCA';
  if (lower.includes('audit'))                                         return 'FALHA_AUDITORIA';
  if (lower.includes('read') || lower.includes('leitura'))            return 'FALHA_LEITURA';
  if (lower.includes('upload'))                                        return 'FALHA_UPLOAD';

  return 'FALHA_EXTRACAO';
}

export function construirErroJob(
  erro:      Error | string,
  tentativa: number,
  categoria?: CategoriaFalha,
): ErroJob {
  const cat   = categoria ?? classificarFalha(erro);
  const regra = REGRAS_FALHA[cat];
  return {
    categoria:     cat,
    mensagem:      typeof erro === 'string' ? erro : erro.message,
    stack:         erro instanceof Error ? erro.stack : undefined,
    tentativa,
    timestamp:     new Date().toISOString(),
    reprocessavel: regra.reprocessavel,
  };
}
