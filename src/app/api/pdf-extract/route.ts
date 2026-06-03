import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
import { extractFromPdfBuffer } from '@/lib/pdf-extractor';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

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

    // Save file
    const uploadsDir = join(process.cwd(), 'public', 'uploads');
    await mkdir(uploadsDir, { recursive: true });
    const filename = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const filepath = join(uploadsDir, filename);
    await writeFile(filepath, buffer);

    const result = await extractFromPdfBuffer(buffer);

    return NextResponse.json({
      ...result,
      arquivoPdfUrl: `/uploads/${filename}`,
    });
  } catch (err) {
    console.error('PDF extract error:', err);
    return NextResponse.json(
      { error: 'Erro ao processar o PDF. Verifique se o arquivo é válido.' },
      { status: 500 }
    );
  }
}
