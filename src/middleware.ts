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
import { isPublicPage } from '@/lib/route-access';

// Rotas de API que não exigem autenticação (rotas de PÁGINA usam isPublicPage, importado acima)
// /api/webhooks/mercadopago é chamado pelo servidor do Mercado Pago, sem
// cookie de sessão — protegido por validação de assinatura HMAC dentro da
// própria rota, não por login de usuário (mesmo padrão de PUBLIC_API_EXACT
// já usado para /api/colaboradores/sweep).
const PUBLIC_API_PREFIXES  = ['/api/auth/', '/api/webhooks/'];
// Match exato (não prefixo) — endpoints internos, chamados pelo próprio servidor
// (sem cookie de sessão) e protegidos por segredo compartilhado na própria rota,
// não por login de usuário. Não usar prefixo aqui: expor um path exato apenas.
const PUBLIC_API_EXACT = ['/api/colaboradores/sweep', '/api/assinatura/sweep'];

function isPublic(pathname: string): boolean {
  if (isPublicPage(pathname))                                  return true;
  if (PUBLIC_API_PREFIXES.some(p => pathname.startsWith(p)))  return true;
  if (PUBLIC_API_EXACT.includes(pathname))                     return true;
  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) {
    const res = NextResponse.next();
    res.headers.set('x-pathname', pathname);
    return res;
  }

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
  res.headers.set('x-pathname', pathname);
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
