import type { Servico } from '@/types';

/** POST /api/servicos — usado tanto pela página cheia quanto pela criação inline. */
export async function criarServico(
  nome: string,
  valorContratado: number,
): Promise<{ ok: true; servico: Servico } | { ok: false; error: string }> {
  try {
    const r = await fetch('/api/servicos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, valorContratado }),
    });
    const d = await r.json();
    if (!r.ok) return { ok: false, error: d.error || 'Erro ao criar serviço.' };
    return { ok: true, servico: d };
  } catch {
    return { ok: false, error: 'Erro de conexão.' };
  }
}
