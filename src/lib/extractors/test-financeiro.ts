/**
 * Script de teste — Fase 6: Extrator BLOCO FINANCEIRO E RETENÇÕES
 * Execução: npx tsx src/lib/extractors/test-financeiro.ts
 */

import fs from 'fs';
import path from 'path';
import { extractFinanceiro } from './financeiro';
import type { FinanceiroField } from './financeiro';

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
  const result = await extractFinanceiro(buf);
  const f      = result.financeiro;

  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  FASE 6 — RESULTADO DA EXTRAÇÃO: BLOCO FINANCEIRO E RETENÇÕES');
  console.log('══════════════════════════════════════════════════════════════════');

  console.log('\n📍 ZONAS DETECTADAS');
  const z = result.zonas;
  console.log(`  Retenções     : estratégia="${z.retencao.estrategia}" idx=[${z.retencao.inicio}..${z.retencao.fim}] anchor=${z.retencao.anchorIdx} ir=${z.retencao.irIdx}`);
  console.log(`  Tabela ISS    : idx=[${z.iss.inicio}..${z.iss.fim}]`);
  console.log(`  Outras Info   : idx=${z.outrasInfo.inicio}`);

  console.log('\n📋 SEGMENTOS RELEVANTES (zona retenções + ISS + outras info)\n');
  const relevant = new Set<number>();
  for (let i = z.retencao.inicio; i <= z.retencao.fim; i++) relevant.add(i);
  for (let i = z.iss.inicio; i <= z.iss.fim; i++) relevant.add(i);
  for (let i = z.outrasInfo.inicio; i < Math.min(result.segmentos.length, z.outrasInfo.inicio + 15); i++) relevant.add(i);
  [...relevant].sort((a, b) => a - b).forEach(i => {
    if (result.segmentos[i]) console.log(`  [${String(i).padStart(2, '0')}] "${result.segmentos[i]}"`);
  });

  const bar  = (n: number) => '█'.repeat(Math.round(n / 5)) + '░'.repeat(20 - Math.round(n / 5));
  const line = (label: string, field: FinanceiroField) => {
    const v   = field.valor ?? '(nulo)';
    const pct = `${String(field.confianca).padStart(3)}%`;
    const lvl = field.nivel.padEnd(6);
    console.log(`  ${label.padEnd(26)} ${pct}  [${lvl}]  ${bar(field.confianca)}  ${v}`);
  };

  console.log('\n📋 CAMPOS EXTRAÍDOS\n');
  console.log(`  ${'CAMPO'.padEnd(26)} ${'CONF'}  ${'NÍVEL'.padEnd(8)}  ${'BARRA'.padEnd(20)}  VALOR`);
  console.log('  ' + '─'.repeat(115));

  line('valor_servico',             f.valor_servico);
  line('valor_bruto',               f.valor_bruto);
  line('valor_liquido',             f.valor_liquido);
  line('base_calculo',              f.base_calculo);
  line('aliquota_iss',              f.aliquota_iss);
  line('valor_iss',                 f.valor_iss);
  console.log('  ' + '─'.repeat(115));
  line('ir',                        f.ir);
  line('pis_pasep',                 f.pis_pasep);
  line('cofins',                    f.cofins);
  line('inss',                      f.inss);
  line('csll',                      f.csll);
  line('outras_retencoes',          f.outras_retencoes);
  line('total_tributos_encargos',   f.total_tributos_encargos);
  console.log('  ' + '─'.repeat(115));
  line('valor_aproximado_tributos', f.valor_aproximado_tributos);
  line('valor_liquido_antecipacao', f.valor_liquido_antecipacao);

  console.log('\n──────────────────────────────────────────────────────────────────');
  console.log(`  Confiança global : ${result.globalConfidence.toFixed(1)}%  [${result.globalLevel}]`);
  console.log(`  Tempo extração   : ${result.extractionMs}ms`);

  console.log('\n🔍 VALIDAÇÕES DETALHADAS\n');
  for (const [key, field] of Object.entries(f)) {
    const fld = field as FinanceiroField;
    if (fld.validacoes.length === 0) continue;
    const failures = fld.validacoes.filter(v => !v.passed);
    if (failures.length === 0 && fld.valor !== null) continue;
    console.log(`  ${key}: método="${fld.metodo}"`);
    fld.validacoes.forEach(v => {
      const icon = v.passed ? '✓' : '✗';
      const det  = v.detail ? ` (${v.detail})` : '';
      console.log(`    ${icon} ${v.rule}${det}`);
    });
    console.log('');
  }

  // Validações matemáticas (no campo valor_liquido)
  const mathVals = f.valor_liquido.validacoes.filter(v => v.rule.includes('_eq_'));
  if (mathVals.length > 0) {
    console.log('  🔢 VALIDAÇÕES MATEMÁTICAS');
    mathVals.forEach(v => {
      const icon = v.passed ? '✓' : '✗';
      console.log(`    ${icon} ${v.rule}: ${v.detail ?? ''}`);
    });
    console.log('');
  }

  console.log('══════════════════════════════════════════════════════════════════');
  console.log('\n🧪 VERIFICAÇÃO DOS VALORES ESPERADOS (PDF modelo)\n');

  const checks: Array<[string, string | null, string | null]> = [
    ['valor_servico',             f.valor_servico.valor,             '50.000,00'],
    ['valor_bruto',               f.valor_bruto.valor,               '50.000,00'],
    ['valor_liquido',             f.valor_liquido.valor,             '47.500,00'],
    ['base_calculo',              f.base_calculo.valor,              '50.000,00'],
    ['aliquota_iss',              f.aliquota_iss.valor,              '5'],
    ['valor_iss',                 f.valor_iss.valor,                 '2.500,00'],
    ['ir',                        f.ir.valor,                        '0,00'],
    ['pis_pasep',                 f.pis_pasep.valor,                 '0,00'],
    ['cofins',                    f.cofins.valor,                    '0,00'],
    ['inss',                      f.inss.valor,                      '0,00'],
    ['csll',                      f.csll.valor,                      '0,00'],
    ['outras_retencoes',          f.outras_retencoes.valor,          '0,00'],
    ['valor_aproximado_tributos', f.valor_aproximado_tributos.valor, '9.225,00'],
    ['valor_liquido_antecipacao', f.valor_liquido_antecipacao.valor, null],
    ['total_tributos_encargos',   f.total_tributos_encargos.valor,   '0,00'],
  ];

  let passed = 0;
  let failed = 0;
  for (const [campo, obtido, esperado] of checks) {
    const ok   = obtido === esperado;
    if (ok) passed++; else failed++;
    const icon = ok ? '✓' : '✗';
    const esp  = esperado === null ? '(nulo)' : esperado;
    const obt  = obtido   === null ? '(nulo)' : obtido;
    if (!ok) console.log(`  ${icon} ${campo.padEnd(26)}  esperado="${esp}"  obtido="${obt}"`);
    else     console.log(`  ${icon} ${campo.padEnd(26)}  "${obt}"`);
  }

  console.log(`\n  Resultado: ${passed}/${checks.length} campos corretos`);
  if (failed > 0) console.log(`  FALHAS: ${failed} campo(s) diferem do esperado`);
  else            console.log('  TODOS OS CAMPOS CORRETOS!');
  console.log('══════════════════════════════════════════════════════════════════\n');
}

main().catch(err => { console.error('Erro:', err); process.exit(1); });
