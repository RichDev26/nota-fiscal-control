// Fase 2 — Tipos compartilhados do motor de extração

export interface ValidationResult {
  rule: string;
  passed: boolean;
  detail?: string;
}

export type ConfidenceLevel = 'alta' | 'media' | 'baixa' | 'nula';

export interface FieldResult {
  value: string | null;
  confidence: number;     // 0–100
  level: ConfidenceLevel;
  method: string;
  validations: ValidationResult[];
}

export interface CriticalFieldsResult {
  numeroNota: FieldResult;
  codigoVerificacao: FieldResult;
  dataEmissao: FieldResult;
  dataFatoGerador: FieldResult;
  globalConfidence: number;
  globalLevel: ConfidenceLevel;
  extractionMs: number;
  rawSegmentsCount: number;
}
