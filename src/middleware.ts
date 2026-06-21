/**
 * Middleware de proteção de rotas.
 *
 * - Páginas protegidas: redireciona para /auth se sem sessão
 * - API protegidas: retorna 401 JSON se sem sessão
 * - Rotas públicas: /auth, /api/auth/*
 *
 * Usa jose (edge-compatible) para verificar o JWT sem Node.js crypto.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest, signToken, setSessionCookie, COOKIE_NAME } from '@/lib/auth';

// Rotas que não exigem autenticação
const PUBLIC_PAGE_PREFIXES = ['/auth', '/landing'];
const PUBLIC_PAGE_EXACT    = ['/'];
const PUBLIC_API_PREFIXES  = ['/api/auth/'];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PAGE_EXACT.includes(pathname))                    return true;
  if (PUBLIC_PAGE_PREFIXES.some(p => pathname.startsWith(p))) return true;
  if (PUBLIC_API_PREFIXES.some(p => pathname.startsWith(p)))  return true;
  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  const session = await getSessionFromRequest(req);

  if (!session) {
    // Chamadas de API retornam 401 (o cliente trata e redireciona)
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }
    // Páginas redirecionam para login
    const url = req.nextUrl.clone();
    url.pathname = '/auth';
    return NextResponse.redirect(url);
  }

  // Sliding window: renovar token se restar menos de 15 dias
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const res   = NextResponse.next();
  if (token) {
    try {
      const { exp } = JSON.parse(atob(token.split('.')[1]));
      const secsLeft = (exp as number) - Math.floor(Date.now() / 1000);
      if (secsLeft < 60 * 60 * 24 * 15) {
        const newToken = await signToken({ sub: session.sub, email: session.email, nome: session.nome });
        setSessionCookie(res, newToken);
      }
    } catch { /* ignora erros de parsing */ }
  }
  return res;
}

export const config = {
  // Executa em todas as rotas exceto assets estáticos do Next.js
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
