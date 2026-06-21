import { NextRequest, NextResponse } from 'next/server';
import { hash }                       from 'bcryptjs';
import { z }                          from 'zod';
import { prisma }                     from '@/lib/prisma';
import { signToken, setSessionCookie, SESSION_30D } from '@/lib/auth';
import { checkAuthRateLimit }         from '@/lib/auth-rate-limit';

const schema = z.object({
  email:     z.string().email('E-mail inválido').max(255),
  senha:     z.string()
    .min(8, 'Mínimo 8 caracteres')
    .max(128)
    .regex(/[A-Z]/, 'Deve conter ao menos uma letra maiúscula')
    .regex(/[0-9]/, 'Deve conter ao menos um número'),
  nome:      z.string().min(2, 'Nome muito curto').max(100).trim(),
});

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    '0.0.0.0'
  );
}

export async function POST(req: NextRequest) {
  // Rate limiting por IP
  const ip     = getClientIp(req);
  const rl     = checkAuthRateLimit(ip);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Muitas tentativas. Tente novamente em ${Math.ceil(rl.retryAfter / 60)} minuto(s).` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    );
  }

  // Validação de entrada
  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0].message : 'Dados inválidos';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const { email, senha, nome } = body;
  const emailNorm = email.toLowerCase().trim();

  // Verificar se e-mail já existe
  const existente = await prisma.usuario.findUnique({
    where: { email: emailNorm },
    select: { id: true },
  });
  if (existente) {
    return NextResponse.json(
      { error: 'Este e-mail já está em uso.', field: 'email' },
      { status: 409 },
    );
  }

  // Hash da senha (custo 12 — ~250 ms, seguro contra brute force offline)
  const senhaHash = await hash(senha, 12);

  // Criar usuário
  const usuario = await prisma.usuario.create({
    data: { email: emailNorm, senhaHash, nome: nome.trim() },
    select: { id: true, email: true, nome: true },
  });

  // Criar sessão e settar cookie
  const token = await signToken({
    sub:   usuario.id,
    email: usuario.email,
    nome:  usuario.nome,
  });

  const res = NextResponse.json(
    { usuario: { nome: usuario.nome, email: usuario.email } },
    { status: 201 },
  );
  return setSessionCookie(res, token, SESSION_30D);
}
