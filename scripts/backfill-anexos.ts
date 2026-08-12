/**
 * Resgate único (idempotente): para todo arquivo que ainda estiver presente em
 * data/uploads (ou tmp/uploads em dev) e ainda NÃO tiver um respaldo em
 * ArquivoUpload, cria o respaldo. Protege qualquer anexo de Gasto que tenha
 * sido enviado desde o último redeploy — antes que o PRÓXIMO redeploy apague
 * o disco e perca esse arquivo pra sempre (o disco é efêmero em produção).
 *
 * Só LÊ o disco e SÓ CRIA linhas novas em ArquivoUpload — nunca apaga nada,
 * nunca sobrescreve um registro já existente, nunca toca em Gasto/NotaFiscal.
 *
 * Execução: npx tsx scripts/backfill-anexos.ts
 */
import { readdir, readFile } from 'fs/promises';
import { join, extname } from 'path';
import prisma from '../src/lib/prisma';

const MIME_POR_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

(async () => {
  const uploadsDir = join(
    process.cwd(),
    process.env.NODE_ENV === 'production' ? 'data' : 'tmp',
    'uploads',
  );

  let arquivos: string[];
  try {
    arquivos = await readdir(uploadsDir);
  } catch {
    console.log(`Diretório ${uploadsDir} não existe (nada pra resgatar). Encerrando.`);
    process.exit(0);
  }

  console.log(`Encontrados ${arquivos.length} arquivo(s) em ${uploadsDir}.`);

  let resgatados = 0;
  let jaProtegidos = 0;
  let falhas = 0;

  for (const filename of arquivos) {
    try {
      const existente = await prisma.arquivoUpload.findUnique({ where: { filename } });
      if (existente) { jaProtegidos++; continue; }

      const buffer = await readFile(join(uploadsDir, filename));
      const mimeType = MIME_POR_EXT[extname(filename).toLowerCase()] ?? 'application/octet-stream';

      await prisma.arquivoUpload.create({
        data: { filename, mimeType, dados: buffer.toString('base64') },
      });
      resgatados++;
      console.log(`  🟢 resgatado: ${filename}`);
    } catch (err) {
      falhas++;
      console.error(`  🔴 falha ao resgatar ${filename}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`\nConcluído: ${resgatados} resgatado(s), ${jaProtegidos} já protegido(s), ${falhas} falha(s).`);
  process.exit(0);
})();
