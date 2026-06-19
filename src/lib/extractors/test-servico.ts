/**
 * Script de teste — Fase 5: Extrator DISCRIMINAÇÃO DOS SERVIÇOS
 * Execução: npx tsx src/lib/extractors/test-servico.ts
 */

import fs from 'fs';
import path from 'path';
import { extractServico } from './servico';

const PDF_PATH = path.join(
  process.env.USERPROFILE ?? process.env.HOME ?? '',
  'Downloads', 'MODELO NF.pdf',
);

async function main() {
  if (!fs.existsSync(PDF_PATH)) {
    console.error(`PDF não encontrado: ${PDF_PATH}`);
    process.exit(1);
  }

  const buf    = fs.readFileSync(PDF_PATH);
  const result = await extractServico(buf);
  const s      = result.servico;

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  FASE 5 — RESULTADO DA EXTRAÇÃO: DISCRIMINAÇÃO DOS SERVIÇOS');
  console.log('══════════════════════════════════════════════════════════════');

  console.log(`\n📍 ZONA DETECTADA`);
  console.log(`  Estratégia  : ${result.zona.estrategia}`);
  console.log(`  Índice ini  : ${result.zona.inicio}`);
  console.log(`  Índice fim  : ${result.zona.fim}`);
  console.log(`  Segmentos   :`);
  result.zona.segmentos.forEach((seg, i) => {
    console.log(`    [${String(i).padStart(2, '0')}] "${seg}"`);
  });

  const bar  = (n: number) => '█'.repeat(Math.round(n / 5)) + '░'.repeat(20 - Math.round(n / 5));
  const line = (label: string, f: typeof s.descricao) => {
    const v   = f.valor ?? '(nulo)';
    const pct = `${String(f.confianca).padStart(3)}%`;
    const lvl = f.nivel.padEnd(6);
    console.log(`  ${label.padEnd(22)} ${pct}  [${lvl}]  ${bar(f.confianca)}  ${v}`);
  };

  console.log('\n📋 CAMPOS EXTRAÍDOS\n');
  console.log(`  ${'CAMPO'.padEnd(22)} ${'CONF'}  ${'NÍVEL'.padEnd(8)}  ${'BARRA'.padEnd(20)}  VALOR`);
  console.log('  ' + '─'.repeat(110));

  line('descricao',      s.descricao);
  line('of',             s.of);
  line('quantidade',     s.quantidade);
  line('valor_unitario', s.valor_unitario);
  line('valor_servico',  s.valor_servico);
  line('base_calculo',   s.base_calculo);
  line('aliquota_iss',   s.aliquota_iss);
  line('valor_iss',      s.valor_iss);
  line('codigo_servico', s.codigo_servico);

  console.log('\n──────────────────────────────────────────────────────────────');
  console.log(`  Confiança global : ${result.globalConfidence.toFixed(1)}%  [${result.globalLevel}]`);
  console.log(`  Tempo extração   : ${result.extractionMs}ms`);

  console.log('\n🔍 VALIDAÇÕES DETALHADAS\n');
  for (const [key, field] of Object.entries(s)) {
    const f = field as typeof s.descricao;
    if (f.validacoes.length === 0) continue;
    console.log(`  ${key}: método="${f.metodo}"`);
    f.validacoes.forEach(v => {
      const icon = v.passed ? '✓' : '✗';
      const det  = v.detail ? ` (${v.detail})` : '';
      console.log(`    ${icon} ${v.rule}${det}`);
    });
    console.log('');
  }

  console.log('══════════════════════════════════════════════════════════════');
  console.log('\n🧪 VERIFICAÇÃO DOS VALORES ESPERADOS (PDF modelo)\n');

  const checks: Array<[string, string | null, string | null]> = [
    ['descricao',      s.descricao.valor,      'Referente a instalação dos tanques de salmoura.'],
    ['of',             s.of.valor,             '6866682'],
    ['quantidade',     s.quantidade.valor,     '1,0000'],
    ['valor_unitario', s.valor_unitario.valor, '50.000,0000'],
    ['valor_servico',  s.valor_servico.valor,  '50.000,0000'],
    ['base_calculo',   s.base_calculo.valor,   '50.000,00'],
    ['aliquota_iss',   s.aliquota_iss.valor,   '5,00'],
    ['valor_iss',      s.valor_iss.valor,      '2.500,00'],
    ['codigo_servico', s.codigo_servico.valor, '14.01'],
  ];

  let passed = 0;
  let failed = 0;
  for (const [campo, obtido, esperado] of checks) {
    const ok   = obtido === esperado;
    if (ok) passed++; else failed++;
    const icon = ok ? '✓' : '✗';
    const esp  = esperado === null ? '(nulo)' : esperado;
    const obt  = obtido   === null ? '(nulo)' : obtido;
    if (!ok) console.log(`  ${icon} ${campo.padEnd(22)}  esperado="${esp}"  obtido="${obt}"`);
    else     console.log(`  ${icon} ${campo.padEnd(22)}  "${obt}"`);
  }

  console.log(`\n  Resultado: ${passed}/${checks.length} campos corretos`);
  if (failed > 0) console.log(`  FALHAS: ${failed} campo(s) diferem do esperado`);
  else            console.log('  TODOS OS CAMPOS CORRETOS!');
  console.log('══════════════════════════════════════════════════════════════\n');
}

main().catch(err => { console.error('Erro:', err); process.exit(1); });
