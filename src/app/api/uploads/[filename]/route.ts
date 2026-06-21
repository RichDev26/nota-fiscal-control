import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { readFile } from 'fs/promises';
import { join } from 'path';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { filename: string } }) {
  const session = await getSession();
  if (!session) return new NextResponse('Não autorizado', { status: 401 });

  // Prevenir path traversal
  const safeName = params.filename.replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safeName || safeName !== params.filename) {
    return new NextResponse('Nome de arquivo inválido', { status: 400 });
  }

  try {
    const uploadsDir = join(
      process.cwd(),
      process.env.NODE_ENV === 'production' ? 'data' : 'tmp',
      'uploads',
    );
    const buffer = await readFile(join(uploadsDir, safeName));
    const ext = safeName.split('.').pop()?.toLowerCase();
    const contentType =
      ext === 'pdf'  ? 'application/pdf' :
      ext === 'png'  ? 'image/png' :
      ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
      'application/octet-stream';

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${safeName}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch {
    return new NextResponse('Arquivo não encontrado', { status: 404 });
  }
}
