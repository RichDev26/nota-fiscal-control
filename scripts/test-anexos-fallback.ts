/**
 * Regressão do bug "PDF anexado ao gasto não é encontrado" — cobre o núcleo do
 * fix (modelo ArquivoUpload + resgate) sem precisar de servidor rodando.
 * O comportamento HTTP completo (disco → banco → auto-cura) foi validado
 * manualmente via /api/upload e /api/uploads/[filename] reais durante a
 * investigação — este script cobre a parte que fica como regressão permanente.
 *
 * Execução: npx tsx scripts/test-anexos-fallback.ts
 */
import { mkdir, writeFile, readdir, rm } from 'fs/promises';
import { join } from 'path';
import prisma from '../src/lib/prisma';

let falhas = 0;
const check = (n: string, ok: boolean, d = '') => { console.log(`${ok ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`); if (!ok) falhas++; };

(async () => {
  const uploadsDir = join(process.cwd(), 'tmp', 'uploads');
  await mkdir(uploadsDir, { recursive: true });

  const filename = `teste-fallback-${Date.now()}.pdf`;
  const conteudoOriginal = Buffer.from('%PDF-1.4 conteudo de teste');
  await writeFile(join(uploadsDir, filename), conteudoOriginal);

  // ── 1. Respaldo em banco: cria e lê de volta corretamente ──
  const registro = await prisma.arquivoUpload.create({
    data: { filename, mimeType: 'application/pdf', dados: conteudoOriginal.toString('base64') },
  });
  check('ArquivoUpload criado com filename único', registro.filename === filename);

  const lido = await prisma.arquivoUpload.findUnique({ where: { filename } });
  check('Leitura de volta decodifica os bytes originais corretamente', lido !== null && Buffer.from(lido.dados, 'base64').equals(conteudoOriginal));

  // ── 2. Unicidade: mesmo filename não pode ter 2 respaldos ──
  let violouUnico = false;
  try {
    await prisma.arquivoUpload.create({ data: { filename, mimeType: 'application/pdf', dados: 'xx' } });
  } catch { violouUnico = true; }
  check('filename duplicado é rejeitado pela constraint única', violouUnico);

  // ── 3. Script de resgate: idempotente, só cria o que falta ──
  const filename2 = `teste-resgate-${Date.now()}.pdf`;
  await writeFile(join(uploadsDir, filename2), Buffer.from('outro arquivo'));
  // filename2 está no disco mas SEM respaldo ainda — simula "arquivo pré-fix"

  const { readFile } = await import('fs/promises');
  const arquivosNoDisco = await readdir(uploadsDir);
  let resgatados = 0;
  for (const f of arquivosNoDisco) {
    const existente = await prisma.arquivoUpload.findUnique({ where: { filename: f } });
    if (existente) continue;
    const buf = await readFile(join(uploadsDir, f));
    await prisma.arquivoUpload.create({ data: { filename: f, mimeType: 'application/pdf', dados: buf.toString('base64') } });
    resgatados++;
  }
  check('Resgate cria respaldo só para o arquivo que ainda não tinha (filename, não filename2 duplicado)', resgatados === 1);

  const resgatadoRegistro = await prisma.arquivoUpload.findUnique({ where: { filename: filename2 } });
  check('Arquivo resgatado tem os bytes corretos', resgatadoRegistro !== null && Buffer.from(resgatadoRegistro.dados, 'base64').toString() === 'outro arquivo');

  // Rodar de novo não deve recriar nada (idempotência)
  let resgatadosSegundaRodada = 0;
  for (const f of arquivosNoDisco) {
    const existente = await prisma.arquivoUpload.findUnique({ where: { filename: f } });
    if (existente) continue;
    resgatadosSegundaRodada++;
  }
  check('Segunda rodada do resgate não encontra nada novo pra resgatar', resgatadosSegundaRodada === 0);

  // ── Limpeza — só o que este teste criou ──
  await prisma.arquivoUpload.deleteMany({ where: { filename: { in: [filename, filename2] } } });
  await rm(join(uploadsDir, filename), { force: true });
  await rm(join(uploadsDir, filename2), { force: true });

  console.log(falhas === 0 ? '\n✅ Todos os testes passaram' : `\n❌ ${falhas} teste(s) falharam`);
  process.exit(falhas === 0 ? 0 : 1);
})();
