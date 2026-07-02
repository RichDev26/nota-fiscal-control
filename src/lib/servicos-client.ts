import type { Servico } from '@/types';

export interface NovoServicoPayload {
  nome: string;
  valorContratado: number;
  gestor?: string;
  comprador?: string;
  numeroOF?: string;
  numeroOrcamento?: string;
}

/** POST /api/servicos — usado tanto pela página cheia quanto pela criação inline. */
export async function criarServico(
  payload: NovoServicoPayload,
): Promise<{ ok: true; servico: Servico } | { ok: false; error: string }> {
  try {
    const r = await fetch('/api/servicos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (!r.ok) return { ok: false, error: d.error || 'Erro ao criar serviço.' };
    return { ok: true, servico: d };
  } catch {
    return { ok: false, error: 'Erro de conexão.' };
  }
}
