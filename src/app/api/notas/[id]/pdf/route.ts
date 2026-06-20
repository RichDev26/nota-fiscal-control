import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getPdf } from '@/lib/pdf-storage';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function pdfResponse(buf: Buffer): NextResponse {
  return new NextResponse(buf as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Length':      buf.length.toString(),
      'Content-Disposition': 'inline',
      'Cache-Control':       'private, max-age=3600',
    },
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return new NextResponse('Não autorizado', { status: 401 });

  try {
    const nota = await prisma.notaFiscal.findUnique({
      where:  { id: params.id },
      select: { usuarioId: true, pdfData: true },
    });

    if (!nota) return new NextResponse('Nota não encontrada', { status: 404 });
    if (nota.usuarioId && nota.usuarioId !== session.sub)
      return new NextResponse('Acesso negado', { status: 403 });

    // Tenta ler do sistema de arquivos primeiro (notas recentes)
    const fsBuf = getPdf(params.id);
    if (fsBuf) return pdfResponse(fsBuf);

    // Fallback: lê pdfData (base64) do banco
    if (!nota.pdfData) return new NextResponse('PDF não disponível para esta nota', { status: 404 });
    return pdfResponse(Buffer.from(nota.pdfData, 'base64'));
  } catch (err) {
    console.error('[GET /api/notas/[id]/pdf]', err);
    return new NextResponse('Erro ao carregar PDF', { status: 500 });
  }
}
