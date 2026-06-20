/**
 * Rate limiting em memória para endpoints de autenticação.
 *
 * Janela deslizante: 5 tentativas por IP a cada 15 minutos.
 * Em produção multi-instância, substituir por Redis.
 */

interface Bucket {
  count:   number;
  resetAt: number;
}

const store = new Map<string, Bucket>();

const WINDOW_MS    = 15 * 60 * 1000;  // 15 minutos
const MAX_ATTEMPTS = 5;

function clean() {
  const now = Date.now();
  for (const [key, bucket] of store.entries()) {
    if (now > bucket.resetAt) store.delete(key);
  }
}

export interface RateLimitResult {
  allowed:    boolean;
  remaining:  number;
  retryAfter: number;  // segundos até liberar (0 = não bloqueado)
}

export function checkAuthRateLimit(ip: string): RateLimitResult {
  // Limpa entradas expiradas periodicamente (a cada 100 chamadas aprox.)
  if (Math.random() < 0.01) clean();

  const now    = Date.now();
  const bucket = store.get(ip);

  if (!bucket || now > bucket.resetAt) {
    store.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: MAX_ATTEMPTS - 1, retryAfter: 0 };
  }

  if (bucket.count >= MAX_ATTEMPTS) {
    return {
      allowed:    false,
      remaining:  0,
      retryAfter: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }

  bucket.count += 1;
  return {
    allowed:    true,
    remaining:  MAX_ATTEMPTS - bucket.count,
    retryAfter: 0,
  };
}

/** Reseta o contador após login bem-sucedido. */
export function resetAuthRateLimit(ip: string): void {
  store.delete(ip);
}
