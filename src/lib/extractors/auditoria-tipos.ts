/**
 * Fase 11 — Tipos compartilhados do sistema de Auditoria, Logs e Rastreabilidade
 */

// ─── ENUMERAÇÕES ──────────────────────────────────────────────────────────────

export type SeveridadeEvento   = 'baixa' | 'media' | 'alta' | 'critica';
export type SensibilidadeDados = 'baixa' | 'media' | 'alta' | 'critica';

export type CategoriaEvento =
  | 'DOCUMENTO'
  | 'EXTRACAO'
  | 'VALIDACAO'
  | 'CORRECAO'
  | 'CONFLITO'
  | 'CONFIGURACAO'
  | 'ACESSO'
  | 'ERRO';

export type SubcategoriaEvento =
  // DOCUMENTO
  | 'UPLOAD'
  | 'REMOCAO'
  | 'SUBSTITUICAO'
  | 'ARQUIVAMENTO'
  | 'REPROCESSAMENTO'
  // EXTRACAO
  | 'EXTRACAO_CABECALHO'
  | 'EXTRACAO_PRESTADOR'
  | 'EXTRACAO_TOMADOR'
  | 'EXTRACAO_SERVICOS'
  | 'EXTRACAO_FINANCEIRO'
  | 'EXTRACAO_FISCAL'
  // VALIDACAO
  | 'VALIDACAO_FORMATO'
  | 'VALIDACAO_MATEMATICA'
  | 'VALIDACAO_TRIBUTARIA'
  | 'VALIDACAO_CRUZADA'
  | 'VALIDACAO_CONFIANCA'
  // CORRECAO
  | 'CORRECAO_MANUAL'
  | 'CORRECAO_ACEITA'
  | 'CORRECAO_REJEITADA'
  | 'CORRECAO_CONFLITANTE'
  | 'CORRECAO_PENDENTE'
  | 'CORRECAO_REVERTIDA'
  // CONFLITO
  | 'DIVERGENCIA_METODOS'
  | 'CONFLITO_OCR'
  | 'CONFLITO_FISCAL'
  | 'CONFLITO_FRONTEIRA'
  | 'CONFLITO_CONFIANCA'
  // CONFIGURACAO
  | 'MUDANCA_REGRA'
  | 'MUDANCA_ANCORA'
  | 'MUDANCA_FRONTEIRA'
  | 'MUDANCA_LIMIAR_CONFIANCA'
  | 'MUDANCA_VERSAO_MOTOR'
  // ACESSO
  | 'LOGIN'
  | 'LOGOUT'
  | 'FALHA_LOGIN'
  | 'ACESSO_DOCUMENTO'
  | 'DOWNLOAD'
  | 'EXPORTACAO'
  | 'VISUALIZACAO_SENSIVEL'
  // ERRO
  | 'FALHA_PARSING'
  | 'FALHA_OCR'
  | 'FALHA_ARQUIVO'
  | 'FALHA_INTEGRIDADE'
  | 'FALHA_AUTORIZACAO'
  | 'FALHA_VALIDACAO';

export type OrigemEvento = 'SISTEMA' | 'HUMANO' | 'AUTOMATICO' | 'API';
export type StatusEvento = 'SUCESSO' | 'FALHA' | 'PARCIAL' | 'PENDENTE' | 'REVERTIDO';
export type NivelLog     = 'DEBUG'   | 'INFO'   | 'WARN'     | 'ERROR'   | 'FATAL';

// ─── EVENTO DE AUDITORIA ──────────────────────────────────────────────────────

export interface AuditoriaEvento {
  evento_id:          string;
  documento_id:       string | null;
  usuario_id:         string | null;
  acao:               string;
  categoria:          CategoriaEvento;
  subcategoria:       SubcategoriaEvento;
  severidade:         SeveridadeEvento;
  sensibilidade:      SensibilidadeDados;
  entidade:           string;
  campo:              string | null;
  valor_antigo:       string | null;
  valor_novo:         string | null;
  origem:             OrigemEvento;
  metodo:             string | null;
  confianca:          number | null;
  status:             StatusEvento;
  timestamp:          string;
  ip:                 string | null;
  session_id:         string | null;
  versao_motor:       string;
  versao_regra:       string | null;
  evento_pai_id:      string | null;
  reprocessamento_id: string | null;
  reversao:           boolean;
  observacao:         string | null;
  dados_extras:       Record<string, unknown>;
  hash:               string;
}

// ─── VERSÃO DE DOCUMENTO ──────────────────────────────────────────────────────

export interface DiffCampo {
  campo:        string;
  valor_antes:  string | null;
  valor_depois: string | null;
}

export interface VersaoDocumento {
  versao_id:      string;
  documento_id:   string;
  numero_versao:  number;
  label:          string;
  evento_origem:  string;
  hash:           string;
  data:           string;
  autor:          string | null;
  motivo:         string;
  diff:           DiffCampo[];
  dados_snapshot: Record<string, unknown>;
}

// ─── HISTÓRICO DE CAMPO ───────────────────────────────────────────────────────

export interface HistoricoCampoEntrada {
  entrada_id:   string;
  campo:        string;
  documento_id: string;
  versao_seq:   number;
  valor:        string | null;
  origem:       OrigemEvento;
  metodo:       string | null;
  confianca:    number | null;
  usuario_id:   string | null;
  timestamp:    string;
  evento_id:    string | null;
  motivo:       string | null;
  is_final:     boolean;
}

export interface HistoricoCampo {
  campo:           string;
  documento_id:    string;
  entradas:        HistoricoCampoEntrada[];
  valor_final:     string | null;
  confianca_final: number | null;
}

// ─── LINHAGEM DE CAMPO ────────────────────────────────────────────────────────

export interface LinhageEtapa {
  fase:       string;
  metodo:     string;
  valor:      string | null;
  confianca:  number | null;
  timestamp:  string;
  descricao:  string;
  confirmado: boolean;
}

export interface LinhagemdeCampo {
  campo:           string;
  documento_id:    string;
  valor_final:     string | null;
  confianca_final: number | null;
  etapas:          LinhageEtapa[];
  metodo_vencedor: string | null;
  confirmado_por:  string[];
  reversoes:       number;
  criado_em:       string;
  atualizado_em:   string;
}

// ─── LOGS ─────────────────────────────────────────────────────────────────────

export interface LogTecnico {
  log_id:       string;
  nivel:        NivelLog;
  componente:   string;
  mensagem:     string;
  stack_trace:  string | null;
  contexto:     Record<string, unknown>;
  documento_id: string | null;
  timestamp:    string;
  versao_motor: string;
}

export interface LogNegocio {
  log_id:       string;
  acao:         string;
  entidade:     string;
  documento_id: string | null;
  usuario_id:   string | null;
  detalhes:     Record<string, unknown>;
  timestamp:    string;
  resultado:    'SUCESSO' | 'FALHA' | 'PARCIAL';
}

// ─── AUDITORIA DE EXPORTAÇÃO ──────────────────────────────────────────────────

export interface AuditoriaExportacao {
  exportacao_id:     string;
  evento_id:         string;
  usuario_id:        string;
  formato:           'PDF' | 'EXCEL' | 'CSV' | 'JSON';
  periodo_inicio:    string | null;
  periodo_fim:       string | null;
  filtros_aplicados: Record<string, unknown>;
  total_notas:       number;
  documentos_ids:    string[];
  hash_arquivo:      string | null;
  versao_relatorio:  string;
  versao_motor:      string;
  timestamp:         string;
  ip:                string | null;
}

// ─── AUDITORIA DE CONFIGURAÇÃO ────────────────────────────────────────────────

export interface AuditoriaConfiguracao {
  config_id:     string;
  evento_id:     string;
  tipo:          'ANCORA' | 'FRONTEIRA' | 'REGRA_FISCAL' | 'LIMIAR_CONFIANCA' | 'VERSAO_MOTOR' | 'ALGORITMO';
  identificador: string;
  valor_antes:   unknown;
  valor_depois:  unknown;
  autor:         string | null;
  motivo:        string;
  impacto:       string;
  versao_antes:  string;
  versao_depois: string;
  timestamp:     string;
}

// ─── FILTROS DE CONSULTA ──────────────────────────────────────────────────────

export interface FiltrosAuditoria {
  documento_id?:  string;
  usuario_id?:    string;
  categoria?:     CategoriaEvento;
  subcategoria?:  SubcategoriaEvento;
  severidade?:    SeveridadeEvento;
  de?:            string;
  ate?:           string;
  campo?:         string;
  status?:        StatusEvento;
  limite?:        number;
  offset?:        number;
}
