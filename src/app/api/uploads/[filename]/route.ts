import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { verificarAcessoAssinatura } from '@/lib/assinatura/acesso';
import prisma from '@/lib/prisma';
import { logError } from '@/lib/extractors/logger';

export const dynamic = 'force-dynamic';

function contentTypeFor(safeName: string): string {
  const ext = safeName.split('.').pop()?.toLowerCase();
  return ext === 'pdf'  ? 'application/pdf' :
         ext === 'png'  ? 'image/png' :
         ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
         'application/octet-stream';
}

function fileResponse(buffer: Buffer, safeName: string): NextResponse {
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': contentTypeFor(safeName),
      'Content-Disposition': `inline; filename="${safeName}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  });
}

export async function GET(_req: NextRequest, { params }: { params: { filename: string } }) {
  const session = await getSession();
  if (!session) return new NextResponse('Não autorizado', { status: 401 });
  try {
    await verificarAcessoAssinatura(session.sub);
  } catch {
    return new NextResponse('Assinatura inativa ou trial expirado.', { status: 402 });
  }

  // Prevenir path traversal
  const safeName = params.filename.replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safeName || safeName !== params.filename) {
    return new NextResponse('Nome de arquivo inválido', { status: 400 });
  }

  const uploadsDir = join(
    process.cwd(),
    process.env.NODE_ENV === 'production' ? 'data' : 'tmp',
    'uploads',
  );

  // Tenta ler do disco primeiro (caminho rápido, comum).
  try {
    const buffer = await readFile(join(uploadsDir, safeName));
    return fileResponse(buffer, safeName);
  } catch {
    // Segue para o respaldo em banco — disco é efêmero em produção
    // (Railway redeploy apaga data/uploads sem um Volume garantido).
  }

  try {
    const registro = await prisma.arquivoUpload.findUnique({ where: { filename: safeName } });
    if (!registro) return new NextResponse('Arquivo não encontrado', { status: 404 });

    const buffer = Buffer.from(registro.dados, 'base64');

    // Auto-cura: regrava no disco pra próxima leitura não precisar do banco de novo.
    // Não fatal — se falhar, o arquivo já foi servido corretamente pelo fallback.
    try {
      await mkdir(uploadsDir, { recursive: true });
      await writeFile(join(uploadsDir, safeName), buffer);
    } catch (err) {
      logError('uploads', `Falha ao regravar ${safeName} no disco após servir do banco`, err as Error);
    }

    return fileResponse(buffer, safeName);
  } catch (err) {
    logError('uploads', `Falha ao buscar respaldo em banco para ${safeName}`, err as Error);
    return new NextResponse('Arquivo não encontrado', { status: 404 });
  }
}
