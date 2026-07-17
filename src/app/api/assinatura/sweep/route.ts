import { NextRequest, NextResponse } from 'next/server';
import { processarLembretesVencimento } from '@/lib/assinatura/lembretes';

export const dynamic = 'force-dynamic';

/** Protegido por segredo compartilhado — mesmo padrão de /api/colaboradores/sweep. */
export async function POST(req: NextRequest) {
  const secret = process.env.SWEEP_SECRET;
  if (secret && req.headers.get('x-sweep-secret') !== secret) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  try {
    const resultado = await processarLembretesVencimento();
    return NextResponse.json(resultado);
  } catch (err) {
    console.error('[POST /api/assinatura/sweep]', err);
    return NextResponse.json({ error: 'Erro ao processar lembretes' }, { status: 500 });
  }
}
