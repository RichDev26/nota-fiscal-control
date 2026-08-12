import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { verificarAcessoAssinatura } from '@/lib/assinatura/acesso';
import prisma from '@/lib/prisma';
import { logError } from '@/lib/extractors/logger';

export const dynamic = 'force-dynamic';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  try {
    await verificarAcessoAssinatura(session.sub);
  } catch {
    return NextResponse.json({ error: 'Assinatura inativa ou trial expirado.' }, { status: 402 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'Nenhum arquivo' }, { status: 400 });

    const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Tipo não permitido. Use PDF, JPG ou PNG.' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const uploadsDir = join(
      process.cwd(),
      process.env.NODE_ENV === 'production' ? 'data' : 'tmp',
      'uploads',
    );
    await mkdir(uploadsDir, { recursive: true });
    const filename = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    await writeFile(join(uploadsDir, filename), buffer);

    // Respaldo no banco — o disco é efêmero em produção (Railway redeploy apaga
    // data/uploads sem um Volume garantido). Mesmo padrão de NotaFiscal.pdfData.
    // Não fatal: se o respaldo falhar, o upload já está no disco e continua
    // funcionando normalmente até o próximo redeploy — melhor que falhar a
    // requisição inteira por causa de um passo de segurança extra.
    try {
      await prisma.arquivoUpload.create({
        data: { filename, mimeType: file.type, dados: buffer.toString('base64'), usuarioId: session.sub },
      });
    } catch (err) {
      logError('upload', `Falha ao gravar respaldo em banco para ${filename}`, err as Error);
    }

    return NextResponse.json({ url: `/api/uploads/${filename}`, filename });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Erro no upload' }, { status: 500 });
  }
}
