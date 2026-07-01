import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';
import { extractDocumentFromPdfBuffer, NotaCanceladaError } from '@/lib/extractors/extrator-router';
import { checkRateLimit } from '@/lib/rate-limiter';
import { savePdf, generateTempId } from '@/lib/pdf-storage';

const MAX_BYTES = 50 * 1024 * 1024; // 50MB

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  // 2.3 Rate limiting: 30 uploads por hora por IP
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown';
  const { allowed, retryAfterSec } = checkRateLimit(ip);
  if (!allowed) {
    return NextResponse.json(
      { error: `Limite de uploads atingido. Tente novamente em ${Math.ceil(retryAfterSec / 60)} minuto(s).` },
      { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
    );
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) return NextResponse.json({ error: 'Nenhum arquivo enviado' }, { status: 400 });
    if (file.type !== 'application/pdf' && !file.name.endsWith('.pdf')) {
      return NextResponse.json({ error: 'Apenas arquivos PDF são aceitos' }, { status: 400 });
    }

    // 2.2 Limite de tamanho: 50MB
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `Arquivo muito grande. Limite: 50MB. Recebido: ${(file.size / 1024 / 1024).toFixed(1)}MB` },
        { status: 413 },
      );
    }

    const bytes    = await file.arrayBuffer();
    const buffer   = Buffer.from(bytes);
    const tempId   = generateTempId();
    savePdf(buffer, tempId);

    const result = await extractDocumentFromPdfBuffer(buffer);

    return NextResponse.json({
      ...result,
      pdfTempId:    tempId,
      arquivoPdfUrl: `/api/notas/pdf-preview`,
    });

  } catch (err) {
    // 3.2 Nota cancelada — bloqueio explícito (não é erro de servidor)
    if (err instanceof NotaCanceladaError) {
      return NextResponse.json(
        { error: err.message, bloqueado: true, situacaoNfse: err.situacao },
        { status: 422 },
      );
    }

    console.error('PDF extract error:', err);
    return NextResponse.json(
      { error: 'Erro ao processar o PDF. Verifique se o arquivo é válido.' },
      { status: 500 },
    );
  }
}
