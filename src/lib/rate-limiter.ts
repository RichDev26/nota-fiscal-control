/**
 * Rate limiter em memória — 30 uploads por hora por IP.
 * Reseta com restart do servidor (suficiente para proteção básica contra abuso).
 * Para proteção distribuída em múltiplas instâncias, migrar para Redis.
 */

interface Slot { count: number; resetAt: number }

const store = new Map<string, Slot>();
const WINDOW_MS   = 60 * 60 * 1000; // 1 hora
const MAX_UPLOADS = 30;

// Limpeza periódica de entradas expiradas (evita vazamento de memória)
setInterval(() => {
  const now = Date.now();
  Array.from(store.keys()).forEach(ip => {
    const slot = store.get(ip);
    if (slot && now >= slot.resetAt) store.delete(ip);
  });
}, 10 * 60 * 1000).unref();

export function checkRateLimit(ip: string): { allowed: boolean; retryAfterSec: number } {
  const now   = Date.now();
  const slot  = store.get(ip);

  if (!slot || now >= slot.resetAt) {
    store.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfterSec: 0 };
  }

  if (slot.count >= MAX_UPLOADS) {
    return { allowed: false, retryAfterSec: Math.ceil((slot.resetAt - now) / 1000) };
  }

  slot.count++;
  return { allowed: true, retryAfterSec: 0 };
}
