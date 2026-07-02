/**
 * Cálculo centralizado do Serviço — única fonte de verdade.
 *
 * Total de gastos e lucro NUNCA são armazenados no banco: são sempre derivados
 * dos gastos vinculados no momento da leitura. Isso elimina qualquer risco de
 * inconsistência (criar/editar/excluir um gasto reflete automaticamente, sem
 * necessidade de recalcular/invalidar cache em nenhum outro lugar).
 */
export interface ServicoCalculado {
  totalGastos: number;
  quantidadeGastos: number;
  lucro: number;
}

export function calcularServico(valorContratado: number, gastos: { valor: number }[]): ServicoCalculado {
  const totalGastos = gastos.reduce((s, g) => s + (g.valor ?? 0), 0);
  return {
    totalGastos,
    quantidadeGastos: gastos.length,
    lucro: valorContratado - totalGastos,
  };
}
