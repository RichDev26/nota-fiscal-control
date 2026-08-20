/**
 * Rate limit de tentativas de pagamento — mesmo padrão de
 * src/lib/auth-rate-limit.ts (janela deslizante em memória).
 *
 * Motivação de segurança: endpoint de cobrança sem limite é o alvo clássico de
 * card testing (validar listas de cartões roubados) e de enumeração de BIN.
 * Limita por USUÁRIO (sessão autenticada), não por IP — o atacante já precisa
 * de conta válida para chegar aqui, e o IP é trivialmente rotacionável.
 *
 * Em produção multi-instância, substituir por Redis (mesma ressalva do
 * auth-rate-limit atual).
 */

interface Bucket { count: number; resetAt: number }

const store = new Map<string, Bucket>();

const WINDOW_MS = 10 * 60 * 1000;  // 10 minutos
export const MAX_TENTATIVAS = 5;   // 5 tentativas de cobrança por janela

function clean(): void {
  const now = Date.now();
  store.forEach((bucket, key) => { if (now > bucket.resetAt) store.delete(key); });
}

export interface PagamentoRateLimitResult {
  allowed: boolean;
  retryAfter: number; // segundos até liberar (0 = liberado)
}

export function checkPagamentoRateLimit(chave: string): PagamentoRateLimitResult {
  if (Math.random() < 0.01) clean();

  const now = Date.now();
  const bucket = store.get(chave);

  if (!bucket || now > bucket.resetAt) {
    store.set(chave, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfter: 0 };
  }

  if (bucket.count >= MAX_TENTATIVAS) {
    return { allowed: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count += 1;
  return { allowed: true, retryAfter: 0 };
}
