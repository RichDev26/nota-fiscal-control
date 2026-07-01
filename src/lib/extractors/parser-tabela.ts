/**
 * Parser de Tabelas — componente GENÉRICO e independente do pipeline.
 *
 * Responsável apenas pela ESTRUTURA da tabela, não pelo significado das colunas:
 *   1. localiza a zona da tabela por marcadores de início/fim;
 *   2. isola as linhas de dados dentro da zona;
 *   3. reconstrói registros cuja descrição ocupa múltiplas linhas físicas
 *      (uma linha física do PDF ≠ um registro lógico);
 *   4. delega a interpretação de cada registro a `parseLinha`.
 *
 * Reutilizável por qualquer documento que tenha tabelas (DANFE hoje; CT-e,
 * extratos, boletos no futuro) — basta fornecer marcadores e um `parseLinha`.
 */

export interface TabelaConfig<T> {
  /** Marcadores (regex) que indicam o início da zona da tabela. */
  inicioMarcadores: RegExp[];
  /** Marcadores que indicam o fim da zona (primeiro após o início). */
  fimMarcadores: RegExp[];
  /** True se o segmento inicia um NOVO registro (senão é continuação do anterior). */
  isNovoRegistro: (seg: string) => boolean;
  /** Interpreta um registro lógico já reconstruído (pode ter vindo de várias linhas). */
  parseLinha: (registro: string) => T | null;
  /** Opcional: separador ao juntar linhas de continuação (default: ' '). */
  separador?: string;
}

export interface TabelaResult<T> {
  itens:         T[];
  encontrouZona: boolean;
  inicio:        number;   // índice do 1º segmento da zona (-1 se não achou)
  fim:           number;
  registrosBrutos: string[];   // registros lógicos reconstruídos (para auditoria)
}

function acharIdx(segs: string[], marcadores: RegExp[], from = 0): number {
  for (let i = from; i < segs.length; i++) {
    if (marcadores.some(re => re.test(segs[i]))) return i;
  }
  return -1;
}

export function extrairTabela<T>(segs: string[], cfg: TabelaConfig<T>): TabelaResult<T> {
  const sep = cfg.separador ?? ' ';
  const inicio = acharIdx(segs, cfg.inicioMarcadores);
  if (inicio === -1) {
    return { itens: [], encontrouZona: false, inicio: -1, fim: -1, registrosBrutos: [] };
  }
  let fim = acharIdx(segs, cfg.fimMarcadores, inicio + 1);
  if (fim === -1) fim = segs.length;

  const zona = segs.slice(inicio + 1, fim);

  // Agrupa linhas físicas em registros lógicos. Só começa a acumular no primeiro
  // segmento que inicia um registro (ignora cabeçalhos de coluna antes disso).
  const registros: string[] = [];
  let buffer: string | null = null;
  for (const seg of zona) {
    if (cfg.isNovoRegistro(seg)) {
      if (buffer !== null) registros.push(buffer);
      buffer = seg;
    } else if (buffer !== null) {
      // continuação da descrição do registro corrente (Fase H — multi-linha)
      buffer += sep + seg;
    }
    // segmentos antes do 1º registro (cabeçalhos de coluna) são descartados
  }
  if (buffer !== null) registros.push(buffer);

  const itens = registros
    .map(r => cfg.parseLinha(r))
    .filter((x): x is T => x !== null);

  return { itens, encontrouZona: true, inicio, fim, registrosBrutos: registros };
}
