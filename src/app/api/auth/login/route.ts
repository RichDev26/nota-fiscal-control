import { NextRequest, NextResponse } from 'next/server';
import { compare }                    from 'bcryptjs';
import { z }                          from 'zod';
import { prisma }                     from '@/lib/prisma';
import { signToken, setSessionCookie, SESSION_30D, SESSION_1D } from '@/lib/auth';
import { checkAuthRateLimit, resetAuthRateLimit } from '@/lib/auth-rate-limit';

const schema = z.object({
  email:     z.string().email().max(255),
  senha:     z.string().min(1).max(128),
  lembrarMe: z.boolean().optional().default(true),
});

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    '0.0.0.0'
  );
}

// Mensagem genérica — não revelamos se é e-mail ou senha que errou
const ERRO_CREDENCIAIS = 'E-mail ou senha incorretos.';

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkAuthRateLimit(ip);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Muitas tentativas. Tente novamente em ${Math.ceil(rl.retryAfter / 60)} minuto(s).` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    );
  }

  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 });
  }

  const { email, senha, lembrarMe } = body;
  const emailNorm = email.toLowerCase().trim();

  // Buscar usuário — sempre comparar hash (evita timing attack via early return)
  const usuario = await prisma.usuario.findUnique({
    where: { email: emailNorm },
    select: { id: true, email: true, nome: true, senhaHash: true },
  });

  // Hash dummy para evitar timing attack quando usuário não existe
  const hashParaComparar = usuario?.senhaHash ?? '$2b$12$invalidhashforcomparisononly......';
  const senhaOk = await compare(senha, hashParaComparar);

  if (!usuario || !senhaOk) {
    return NextResponse.json({ error: ERRO_CREDENCIAIS }, { status: 401 });
  }

  // Login bem-sucedido — resetar rate limit
  resetAuthRateLimit(ip);

  const maxAge = lembrarMe ? SESSION_30D : SESSION_1D;
  const token  = await signToken(
    { sub: usuario.id, email: usuario.email, nome: usuario.nome },
    lembrarMe ? '30d' : '1d',
  );

  const res = NextResponse.json(
    { usuario: { nome: usuario.nome, email: usuario.email } },
  );
  return setSessionCookie(res, token, maxAge);
}
