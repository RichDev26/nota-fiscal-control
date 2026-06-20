/**
 * Utilitários de autenticação — JWT + sessão via cookie httpOnly
 *
 * Segurança:
 *   - Token assinado com HS256 via jose (edge-compatible)
 *   - Cookie httpOnly (inacessível ao JS do browser — proteção XSS)
 *   - SameSite: strict (proteção CSRF)
 *   - Secure: true em produção (só HTTPS)
 *   - Expiração de 30 dias (renovável)
 */

import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import type { NextRequest, NextResponse } from 'next/server';

// ─── CONSTANTES ───────────────────────────────────────────────────────────────

export const COOKIE_NAME = 'nf_sess';
export const SESSION_30D = 60 * 60 * 24 * 30;  // 30 dias em segundos
export const SESSION_1D  = 60 * 60 * 24;        // 1 dia (sem "lembrar de mim")

function getSecret(): Uint8Array {
  const raw = process.env.JWT_SECRET;
  if (!raw) {
    console.warn('[auth] JWT_SECRET não definido — usando fallback inseguro');
  }
  return new TextEncoder().encode(
    raw ?? 'nf-control-inseguro-defina-JWT_SECRET-no-env',
  );
}

// ─── TIPOS ────────────────────────────────────────────────────────────────────

export interface SessionPayload {
  sub:   string;   // usuarioId
  email: string;
  nome:  string;
}

// ─── TOKEN ────────────────────────────────────────────────────────────────────

export async function signToken(
  payload: SessionPayload,
  expiresIn: string | number = '30d',
): Promise<string> {
  return new SignJWT({ ...payload } as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(getSecret());
}

export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ['HS256'],
    });
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

// ─── SESSÃO (Server Components / Route Handlers) ──────────────────────────────

/** Lê a sessão a partir do cookie — só funciona em Server Components / Route Handlers */
export async function getSession(): Promise<SessionPayload | null> {
  const store = cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

/** Lê a sessão a partir de um NextRequest (Middleware) */
export async function getSessionFromRequest(
  req: NextRequest,
): Promise<SessionPayload | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

// ─── COOKIE ───────────────────────────────────────────────────────────────────

/** Seta o cookie de sessão em um NextResponse */
export function setSessionCookie(
  res: NextResponse,
  token: string,
  maxAge: number = SESSION_30D,
): NextResponse {
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path:     '/',
    maxAge,
  });
  return res;
}

/** Remove o cookie de sessão */
export function clearSessionCookie(res: NextResponse): NextResponse {
  res.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path:     '/',
    maxAge:   0,
  });
  return res;
}
