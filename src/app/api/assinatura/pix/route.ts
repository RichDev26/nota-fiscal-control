import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSession } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { validarCpfCnpj } from '@/lib/validators';
import { criarCobrancaPix } from '@/lib/payments/mercadopago';
import { logError } from '@/lib/extractors/logger';
import { checkPagamentoRateLimit } from '@/lib/payments/rate-limit-pagamento';
import { resolverPlano } from '@/lib/assinatura/config';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  let body: { cpfCnpj?: string; planoId?: string };
  try { body = await req.json(); } catch { body = {}; }
  if (!body || typeof body !== 'object') body = {};

  const plano = resolverPlano(body.planoId ?? 'mensal');
  if (!plano) return NextResponse.json({ error: 'Plano inválido.' }, { status: 400 });

  const usuario = await prisma.usuario.findUnique({ where: { id: session.sub } });
  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });

  let cpfCnpj = usuario.cpfCnpj;
  if (!cpfCnpj) {
    if (typeof body.cpfCnpj !== 'string' || !validarCpfCnpj(body.cpfCnpj)) {
      return NextResponse.json({ error: 'Informe um CPF ou CNPJ válido para gerar o PIX.', precisaCpfCnpj: true }, { status: 400 });
    }
    cpfCnpj = body.cpfCnpj.replace(/\D/g, '');
    await prisma.usuario.update({ where: { id: usuario.id }, data: { cpfCnpj } });
  }

  const assinatura = await prisma.assinatura.findUnique({ where: { usuarioId: usuario.id } });
  if (!assinatura) return NextResponse.json({ error: 'Assinatura não encontrada' }, { status: 404 });

  // Rate limit por usuário — chave própria (não compartilhada com o cartão) e
  // verificado antes de criar a cobrança: toda validação acima já passou,
  // então só tentativas que de fato chegariam perto do gateway consomem o
  // orçamento, e uma requisição barrada por 429 não deixa linha PENDENTE no banco.
  const rl = checkPagamentoRateLimit(`pix:${session.sub}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Muitas tentativas de pagamento. Aguarde ${Math.ceil(rl.retryAfter / 60)} minuto(s).` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    );
  }

  const idempotencyKey = randomUUID();
  const cobranca = await prisma.cobranca.create({
    data: {
      assinaturaId: assinatura.id,
      metodo:  'PIX',
      planoId: plano.id,
      valor:   plano.valor,
      moeda:   plano.moeda,
      idempotencyKey,
    },
  });

  try {
    const resultado = await criarCobrancaPix({
      valor:         plano.valor,
      descricao:     plano.descricao,
      idempotencyKey,
      payerEmail:    usuario.email,
      payerNome:     usuario.nome,
      payerCpfCnpj:  cpfCnpj,
    });

    await prisma.cobranca.update({
      where: { id: cobranca.id },
      data: {
        mpPaymentId:  resultado.mpPaymentId,
        qrCode:       resultado.qrCode,
        qrCodeBase64: resultado.qrCodeBase64,
        expiraEm:     new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    return NextResponse.json({ cobrancaId: cobranca.id, qrCode: resultado.qrCode, qrCodeBase64: resultado.qrCodeBase64 });
  } catch (err) {
    logError('assinatura.pix', `Falha ao criar cobrança PIX para usuário ${usuario.id}`, err as Error);
    await prisma.cobranca.update({ where: { id: cobranca.id }, data: { status: 'REJEITADA' } });
    return NextResponse.json({ error: 'Falha ao gerar cobrança PIX. Tente novamente.' }, { status: 502 });
  }
}
