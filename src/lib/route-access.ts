/**
 * Lista única de rotas de PÁGINA públicas — compartilhada entre o middleware
 * (Edge, decide redirect de autenticação) e o AssinaturaGate (Node, decide
 * bloqueio por assinatura), para as duas camadas nunca divergirem sobre o que
 * é público.
 */
export const PUBLIC_PAGE_PREFIXES = ['/auth', '/landing'];
export const PUBLIC_PAGE_EXACT    = ['/'];

export function isPublicPage(pathname: string): boolean {
  if (PUBLIC_PAGE_EXACT.includes(pathname)) return true;
  return PUBLIC_PAGE_PREFIXES.some(p => pathname.startsWith(p));
}
