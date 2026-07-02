/**
 * Controle de Integração — configuração central dos tipos de documento e dos
 * marcos de notificação.
 *
 * Adicionar um novo tipo de documento obrigatório no futuro (NR35, treinamento,
 * certificado...) é: 1 nova entrada em TIPOS_DOCUMENTO + 1 etapa no wizard.
 * Nenhuma migração de schema é necessária (DocumentoColaborador.tipo é genérico).
 */

export type TipoDocumento = 'INTEGRACAO' | 'ASO';

export const TIPOS_DOCUMENTO: { tipo: TipoDocumento; label: string; labelVencido: string }[] = [
  { tipo: 'INTEGRACAO', label: 'Integração', labelVencido: 'Integração vencida' },
  { tipo: 'ASO',        label: 'ASO',        labelVencido: 'ASO vencido' },
];

export function labelTipoDocumento(tipo: string): string {
  return TIPOS_DOCUMENTO.find(t => t.tipo === tipo)?.label ?? tipo;
}

// ─── Marcos de notificação (dias antes do vencimento) ──────────────────────────
// Ordenados do mais distante para o mais próximo — a ordem importa para o sweep
// (processa do marco mais antigo pro mais recente, mas cada um é independente).
export type Marco = '2M' | '1M' | '15D' | '3D' | '0D';

export const MARCOS: { marco: Marco; dias: number; label: string }[] = [
  { marco: '2M',  dias: 60, label: '2 meses antes' },
  { marco: '1M',  dias: 30, label: '1 mês antes' },
  { marco: '15D', dias: 15, label: '15 dias antes' },
  { marco: '3D',  dias: 3,  label: '3 dias antes' },
  { marco: '0D',  dias: 0,  label: 'No dia do vencimento' },
];
