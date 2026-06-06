import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const nota = await prisma.notaFiscal.findUnique({
      where: { id: params.id },
      select: { pdfData: true, arquivoPdfUrl: true },
    });

    if (!nota) {
      return new NextResponse('Nota não encontrada', { status: 404 });
    }

    if (!nota.pdfData) {
      return new NextResponse('PDF não disponível para esta nota', { status: 404 });
    }

    const buffer = Buffer.from(nota.pdfData, 'base64');

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': buffer.length.toString(),
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    console.error('[GET /api/notas/[id]/pdf]', err);
    return new NextResponse('Erro ao carregar PDF', { status: 500 });
  }
}
