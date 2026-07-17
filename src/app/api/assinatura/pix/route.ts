import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getSession } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { validarCpfCnpj } from '@/lib/validators';
import { criarCobrancaPix } from '@/lib/payments/mercadopago';
import { logError } from '@/lib/extractors/logger';
import { VALOR_ASSINATURA } from '@/lib/assinatura/config';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  let body: { cpfCnpj?: string };
  try { body = await req.json(); } catch { body = {}; }

  const usuario = await prisma.usuario.findUnique({ where: { id: session.sub } });
  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });

  let cpfCnpj = usuario.cpfCnpj;
  if (!cpfCnpj) {
    if (!body.cpfCnpj || !validarCpfCnpj(body.cpfCnpj)) {
      return NextResponse.json({ error: 'Informe um CPF ou CNPJ válido para gerar o PIX.', precisaCpfCnpj: true }, { status: 400 });
    }
    cpfCnpj = body.cpfCnpj.replace(/\D/g, '');
    await prisma.usuario.update({ where: { id: usuario.id }, data: { cpfCnpj } });
  }

  const assinatura = await prisma.assinatura.findUnique({ where: { usuarioId: usuario.id } });
  if (!assinatura) return NextResponse.json({ error: 'Assinatura não encontrada' }, { status: 404 });

  const idempotencyKey = randomUUID();
  const cobranca = await prisma.cobranca.create({
    data: { assinaturaId: assinatura.id, valor: VALOR_ASSINATURA, idempotencyKey },
  });

  try {
    const resultado = await criarCobrancaPix({
      valor:         VALOR_ASSINATURA,
      descricao:     'Assinatura WorkPro Control — 30 dias',
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
