import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
import { extractFromPdfBuffer } from '@/lib/pdf-extractor';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) return NextResponse.json({ error: 'Nenhum arquivo enviado' }, { status: 400 });
    if (file.type !== 'application/pdf' && !file.name.endsWith('.pdf')) {
      return NextResponse.json({ error: 'Apenas arquivos PDF são aceitos' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Armazena o PDF como base64 para ser salvo no banco de dados.
    // Isso garante que o PDF persiste mesmo no Railway (filesystem efêmero).
    const pdfData = buffer.toString('base64');

    const result = await extractFromPdfBuffer(buffer);

    return NextResponse.json({
      ...result,
      pdfData,
      // arquivoPdfUrl continua para compatibilidade, mas o viewer usará /api/notas/[id]/pdf
      arquivoPdfUrl: `/api/notas/pdf-preview`,
    });
  } catch (err) {
    console.error('PDF extract error:', err);
    return NextResponse.json(
      { error: 'Erro ao processar o PDF. Verifique se o arquivo é válido.' },
      { status: 500 }
    );
  }
}
