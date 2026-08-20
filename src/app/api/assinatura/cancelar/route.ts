import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { cancelarAssinatura } from '@/lib/assinatura/servico';
import { logInfo, logError } from '@/lib/extractors/logger';

export const dynamic = 'force-dynamic';

/**
 * Cancela a renovação da assinatura do usuário da SESSÃO.
 *
 * Sem gate de assinatura ativa (mesmo padrão das outras rotas /api/assinatura/*):
 * quem está bloqueado precisa conseguir operar a própria assinatura.
 *
 * O corpo da requisição é IGNORADO por completo — o alvo é sempre session.sub.
 * Não existe caminho para cancelar a assinatura de outra pessoa.
 */
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ cancelada: false, error: 'Não autorizado' }, { status: 401 });
  }

  try {
    const r = await cancelarAssinatura(session.sub);

    if (r.cancelada) {
      logInfo('assinatura.cancelar', 'Assinatura cancelada pelo usuário', { usuarioId: session.sub });
      return NextResponse.json({ cancelada: true, acessoAte: r.acessoAte });
    }

    // Já cancelada = sucesso do ponto de vista do usuário (idempotente).
    if (r.motivo === 'ja_cancelada') {
      return NextResponse.json({ cancelada: true, acessoAte: r.acessoAte });
    }

    const mensagem =
      r.motivo === 'sem_pagamento_cartao'
        ? 'O cancelamento pelo painel está disponível para assinaturas pagas com cartão.'
        : r.motivo === 'sem_periodo_vigente'
        ? 'Não há assinatura vigente para cancelar.'
        : 'Assinatura não encontrada.';

    return NextResponse.json({ cancelada: false, mensagem }, { status: 400 });
  } catch (err) {
    logError('assinatura.cancelar', `Falha ao cancelar assinatura de ${session.sub}`, err as Error);
    return NextResponse.json(
      { cancelada: false, mensagem: 'Não foi possível cancelar agora. Tente novamente em instantes.' },
      { status: 500 },
    );
  }
}
