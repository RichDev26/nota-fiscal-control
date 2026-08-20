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

/**
 * Propaga o pathname para os Server Components via header de REQUISIÇÃO.
 *
 * SEGURANÇA: `NextResponse.next({ request: { headers } })` é o mecanismo
 * documentado para passar dado do middleware ao RSC. Setar em `res.headers`
 * afeta só a RESPOSTA, então em tese `headers()` num RSC poderia acabar lendo
 * um `X-Pathname` forjado pelo cliente e fazer o AssinaturaGate tratar a rota
 * como pública. Na prática NÃO consegui reproduzir esse bypass com a forma
 * antiga (o gate bloqueou nos dois casos), mas esta é a forma correta e o
 * delete abaixo descarta qualquer valor de entrada antes de escrever o nosso —
 * defesa em profundidade, custo zero.
 */
function comPathname(req: NextRequest, pathname: string): NextResponse {
  const headers = new Headers(req.headers);
  headers.delete('x-pathname');
  headers.set('x-pathname', pathname);
  return NextResponse.next({ request: { headers } });
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) {
    return comPathname(req, pathname);
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
  const res   = comPathname(req, pathname);
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
