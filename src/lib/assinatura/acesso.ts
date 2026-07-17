/**
 * Núcleo de decisão de acesso à assinatura. O acesso NUNCA é decidido por um
 * campo booleano gravado antecipadamente — é sempre calculado na hora, a partir
 * das datas (trialFimEm / periodoFimEm). Datas não ficam desatualizadas por um
 * bug que "esqueceu" de desativar um flag.
 *
 * Fail-closed: usuário sem nenhuma linha de Assinatura nunca tem acesso.
 */
import prisma from '@/lib/prisma';

export interface AssinaturaAcesso {
  trialFimEm: Date;
  periodoFimEm: Date | null;
}

export function temAcessoAtivo(assinatura: AssinaturaAcesso | null, agora: Date = new Date()): boolean {
  if (!assinatura) return false;
  if (assinatura.trialFimEm > agora) return true;
  if (assinatura.periodoFimEm && assinatura.periodoFimEm > agora) return true;
  return false;
}

export class AssinaturaInativaError extends Error {
  constructor() {
    super('Assinatura inativa ou trial expirado.');
    this.name = 'AssinaturaInativaError';
  }
}

/** Lança AssinaturaInativaError se o usuário não tiver acesso ativo. Fail-closed. */
export async function verificarAcessoAssinatura(usuarioId: string): Promise<void> {
  const assinatura = await prisma.assinatura.findUnique({ where: { usuarioId } });
  if (!temAcessoAtivo(assinatura)) throw new AssinaturaInativaError();
}
