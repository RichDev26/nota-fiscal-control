import { NextRequest, NextResponse } from 'next/server';
import { processarNotificacoesPendentes } from '@/lib/colaboradores/notificacoes';

export const dynamic = 'force-dynamic';

/**
 * Endpoint interno — disparado pelo scheduler em src/instrumentation.ts.
 *
 * Não roda dentro do próprio instrumentation.ts porque esse arquivo é
 * compilado num bundle restrito (compatível com Edge) que não resolve os
 * módulos nativos do Node usados pelo nodemailer (crypto, path...). Uma rota
 * de API normal já é comprovadamente compatível com dependências Node pesadas
 * neste projeto (ex: pdf-parse em /api/pdf-extract), então o sweep roda aqui
 * e o scheduler apenas dispara a chamada HTTP.
 *
 * Protegido por segredo compartilhado (não é uma rota de usuário — não faz
 * sentido gate-ar por sessão, já que quem chama é o próprio processo do servidor).
 */
export async function POST(req: NextRequest) {
  const secret = process.env.SWEEP_SECRET;
  if (secret && req.headers.get('x-sweep-secret') !== secret) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  try {
    const resultado = await processarNotificacoesPendentes();
    return NextResponse.json(resultado);
  } catch (err) {
    console.error('[POST /api/colaboradores/sweep]', err);
    return NextResponse.json({ error: 'Erro ao processar notificações' }, { status: 500 });
  }
}
