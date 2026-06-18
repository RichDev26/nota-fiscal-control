/**
 * Script de análise — Mapeamento da zona TOMADOR no PDF modelo
 * Execução: npx tsx src/lib/extractors/analyze-tomador.ts
 */
import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';

const PDF_PATH = path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', 'Downloads', 'MODELO NF.pdf');

async function main() {
  const buf  = fs.readFileSync(PDF_PATH);
  const raw  = await pdfParse(buf);
  const segs = raw.text.split('\n').map((s: string) => s.trim()).filter((s: string) => s.length > 0);

  const enderecos = segs.map((s: string, i: number) => ({ s, i })).filter(({ s }: { s: string }) => /^Endereço:/i.test(s));
  console.log('\n=== TODAS AS OCORRÊNCIAS DE "Endereço:" ===');
  enderecos.forEach(({ s, i }: { s: string; i: number }) => console.log(`  [${i}] "${s}"`));

  const secondEnderecoIdx = enderecos.length >= 2 ? enderecos[1].i : segs.length;
  const tomadorEnd = secondEnderecoIdx - 1;

  console.log(`\n=== ZONA TOMADOR (idx 0 → ${tomadorEnd}) ===`);
  console.log(`  (Tudo antes da 2ª ocorrência de Endereço: em idx ${secondEnderecoIdx})\n`);

  for (let i = 0; i <= tomadorEnd; i++) {
    console.log(`  [${String(i).padStart(2, '0')}] "${segs[i]}"`);
  }

  console.log('\n=== TODOS OS SEGMENTOS (visão completa) ===');
  segs.forEach((s: string, i: number) => {
    const zona = i < secondEnderecoIdx ? 'TOM' : 'PRE';
    console.log(`  [${String(i).padStart(2, '0')}][${zona}] "${s}"`);
  });
}

main().catch(console.error);
