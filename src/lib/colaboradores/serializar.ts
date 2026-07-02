import { calcularStatusDocumentos, statusGeralColaborador } from './status';

interface DocumentoRow { id: string; tipo: string; dataInicio: Date; dataFim: Date }
interface ColaboradorRow { id: string; nome: string; createdAt: Date; updatedAt: Date; documentos: DocumentoRow[] }

/** Transforma uma linha do banco (Colaborador + documentos) na forma da API, com status calculado. */
export function serializarColaborador(row: ColaboradorRow) {
  const docsComStatus = calcularStatusDocumentos(row.documentos);
  const geral = statusGeralColaborador(docsComStatus);

  return {
    id:   row.id,
    nome: row.nome,
    documentos: row.documentos.map((d, i) => ({
      id:            d.id,
      tipo:          d.tipo,
      dataInicio:    d.dataInicio,
      dataFim:       d.dataFim,
      status:        docsComStatus[i].status,
      diasRestantes: docsComStatus[i].diasRestantes,
    })),
    statusGeral: geral.status,
    statusLabel: geral.label,
    createdAt:   row.createdAt,
    updatedAt:   row.updatedAt,
  };
}
