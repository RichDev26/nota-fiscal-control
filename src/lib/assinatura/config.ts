/**
 * Catálogo de planos — FONTE ÚNICA E SERVER-SIDE do preço.
 *
 * O cliente nunca envia valor, moeda ou duração: envia só um `planoId`, e o
 * backend resolve o resto aqui. Isso torna impossível manipular preço pelo
 * frontend (alterar JS, interceptar request, forjar body).
 */

export type PlanoId = 'mensal';

export interface Plano {
  id: PlanoId;
  nome: string;
  valor: number;
  moeda: 'BRL';
  duracaoDias: number;
  descricao: string;
}

// Congelado: o catálogo é estado de módulo compartilhado num processo Node de
// vida longa. Sem freeze, qualquer consumidor futuro que mutasse o objeto
// devolvido por resolverPlano() (ex: aplicar desconto in-place) corromperia o
// preço para TODAS as requisições seguintes até o restart — justamente o que
// esta fonte única existe para impedir.
export const PLANOS: Record<PlanoId, Plano> = Object.freeze({
  mensal: Object.freeze({
    id: 'mensal',
    nome: 'Mensal',
    valor: 149.9,
    moeda: 'BRL',
    duracaoDias: 30,
    descricao: 'Assinatura WorkPro Control — 30 dias',
  }),
}) as Record<PlanoId, Plano>;

export const PLANO_PADRAO: Plano = PLANOS.mensal;

/**
 * Resolve um planoId vindo do cliente. Retorna null para QUALQUER entrada que
 * não seja exatamente um id conhecido — inclusive chaves herdadas do prototype
 * ('toString', '__proto__'), por isso o Object.prototype.hasOwnProperty.call.
 */
export function resolverPlano(planoId: unknown): Plano | null {
  if (typeof planoId !== 'string') return null;
  if (!Object.prototype.hasOwnProperty.call(PLANOS, planoId)) return null;
  return PLANOS[planoId as PlanoId] ?? null;
}

// ── Compatibilidade: usados hoje pelo PIX e pela UI. Derivados do catálogo. ──
export const VALOR_ASSINATURA = PLANO_PADRAO.valor;
export const VALOR_ASSINATURA_FORMATADO = PLANO_PADRAO.valor.toLocaleString('pt-BR', {
  style: 'currency', currency: 'BRL',
});
