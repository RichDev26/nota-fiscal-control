/**
 * Cálculo centralizado de status do Colaborador — única fonte de verdade.
 * Espelha o padrão de calcularServico: nunca armazenado, sempre derivado das
 * datas no momento da leitura (nunca há risco de um status desatualizado).
 */
import { TIPOS_DOCUMENTO, labelTipoDocumento, type TipoDocumento } from './tipos';

export type StatusDocumento = 'em_dia' | 'proximo_vencimento' | 'vencido';

const LIMITE_PROXIMO_DIAS = 30; // ≤ 30 dias restantes → "próximo do vencimento"

export function diasRestantes(dataFim: Date | string, hoje: Date = new Date()): number {
  const fim = typeof dataFim === 'string' ? new Date(dataFim) : dataFim;
  const msPorDia = 24 * 60 * 60 * 1000;
  // Zera hora para comparar só a data (evita diffs de poucas horas virarem "-1 dia").
  const fimUTC  = Date.UTC(fim.getUTCFullYear(), fim.getUTCMonth(), fim.getUTCDate());
  const hojeUTC = Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate());
  return Math.round((fimUTC - hojeUTC) / msPorDia);
}

export function statusPorData(dataFim: Date | string, hoje: Date = new Date()): StatusDocumento {
  const dias = diasRestantes(dataFim, hoje);
  if (dias < 0) return 'vencido';
  if (dias <= LIMITE_PROXIMO_DIAS) return 'proximo_vencimento';
  return 'em_dia';
}

export interface DocumentoComStatus {
  tipo: TipoDocumento | string;
  dataFim: Date | string;
  status: StatusDocumento;
  diasRestantes: number;
}

export function calcularStatusDocumentos(
  documentos: { tipo: string; dataFim: Date | string }[],
  hoje: Date = new Date(),
): DocumentoComStatus[] {
  return documentos.map(d => ({
    tipo: d.tipo,
    dataFim: d.dataFim,
    status: statusPorData(d.dataFim, hoje),
    diasRestantes: diasRestantes(d.dataFim, hoje),
  }));
}

/** Status/label agregado do colaborador — prioriza o pior caso entre os documentos. */
export function statusGeralColaborador(
  docs: DocumentoComStatus[],
): { status: StatusDocumento; label: string } {
  const vencidos = docs.filter(d => d.status === 'vencido');
  const proximos = docs.filter(d => d.status === 'proximo_vencimento');

  if (vencidos.length >= 2) return { status: 'vencido', label: 'Integração e ASO vencidos' };
  if (vencidos.length === 1) {
    const info = TIPOS_DOCUMENTO.find(t => t.tipo === vencidos[0].tipo);
    return { status: 'vencido', label: info?.labelVencido ?? `${labelTipoDocumento(vencidos[0].tipo)} vencido` };
  }
  if (proximos.length > 0) return { status: 'proximo_vencimento', label: 'Próximo do vencimento' };
  return { status: 'em_dia', label: 'Em dia' };
}
