/**
 * Script de teste — Fase 4: Extrator TOMADOR DE SERVIÇOS
 * Execução: npx tsx src/lib/extractors/test-tomador.ts
 */

import fs from 'fs';
import path from 'path';
import { extractTomador } from './tomador';

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
  const result = await extractTomador(buf);
  const t      = result.tomador;

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  FASE 4 — RESULTADO DA EXTRAÇÃO: TOMADOR DE SERVIÇOS');
  console.log('══════════════════════════════════════════════════════════════');

  console.log(`\n📍 ZONA DETECTADA`);
  console.log(`  Estratégia  : ${result.zona.estrategia}`);
  console.log(`  Índice ini   : ${result.zona.inicio}`);
  console.log(`  Índice fim   : ${result.zona.fim}`);
  console.log(`  Data start   : ${result.zona.dataStart} (primeiro dado real do TOMADOR)`);
  console.log(`  Segmentos    :`);
  result.zona.segmentos.forEach((s, i) => {
    const marker = i === result.zona.dataStart ? ' ← data_start' : '';
    console.log(`    [${String(i).padStart(2, '0')}] "${s}"${marker}`);
  });

  const bar = (n: number) => '█'.repeat(Math.round(n / 5)) + '░'.repeat(20 - Math.round(n / 5));
  const line = (label: string, f: { valor: string | null; confianca: number; nivel: string; metodo: string }) => {
    const v     = f.valor ?? '(nulo)';
    const score = `${String(f.confianca).padStart(3)}%`;
    const lvl   = f.nivel.padEnd(6);
    console.log(`  ${label.padEnd(22)} ${score}  [${lvl}]  ${bar(f.confianca)}  ${v}`);
  };

  console.log('\n📋 CAMPOS EXTRAÍDOS\n');
  console.log(`  ${'CAMPO'.padEnd(22)} ${'CONF'}  ${'NÍVEL'.padEnd(8)}  ${'BARRA'.padEnd(20)}  VALOR`);
  console.log('  ' + '─'.repeat(100));

  line('razao_social',        t.razao_social);
  line('nome_fantasia',       t.nome_fantasia);
  line('cpf_cnpj',            t.cpf_cnpj);
  line('inscricao_municipal', t.inscricao_municipal);
  line('inscricao_estadual',  t.inscricao_estadual);
  line('endereco',            t.endereco);
  line('numero',              t.numero);
  line('complemento',         t.complemento);
  line('bairro',              t.bairro);
  line('cep',                 t.cep);
  line('municipio',           t.municipio);
  line('uf',                  t.uf);
  line('email',               t.email);
  line('telefone',            t.telefone);
  line('celular',             t.celular);
  line('site',                t.site);

  console.log('\n──────────────────────────────────────────────────────────────');
  console.log(`  Confiança global : ${result.globalConfidence}%  [${result.globalLevel}]`);
  console.log(`  Tempo extração   : ${result.extractionMs}ms`);

  console.log('\n🔍 VALIDAÇÕES DETALHADAS\n');
  for (const [key, field] of Object.entries(t)) {
    const f = field as typeof t.razao_social;
    if (f.validacoes.length === 0) continue;
    console.log(`  ${key}: método="${f.metodo}"`);
    f.validacoes.forEach(v => {
      const icon = v.passed ? '✓' : '✗';
      const det  = v.detail ? ` (${v.detail})` : '';
      console.log(`    ${icon} ${v.rule}${det}`);
    });
    console.log('');
  }

  console.log('══════════════════════════════════════════════════════════════\n');

  console.log('🧪 VERIFICAÇÃO DOS VALORES ESPERADOS (Seara Alimentos — PDF modelo)\n');
  const checks: Array<[string, string | null, string | null]> = [
    ['razao_social',        t.razao_social.valor,        'Seara Alimentos Ltda'],
    ['nome_fantasia',       t.nome_fantasia.valor,       'Seara Alimentos'],
    ['cpf_cnpj',            t.cpf_cnpj.valor,            '02.914.460/0061-91'],
    ['inscricao_municipal', t.inscricao_municipal.valor, '15632008'],
    ['inscricao_estadual',  t.inscricao_estadual.valor,  null],
    ['endereco',            t.endereco.valor,            'ROD BR 163'],
    ['numero',              t.numero.valor,              'S/N'],
    ['complemento',         t.complemento.valor,         'KM 6'],
    ['bairro',              t.bairro.valor,              'CENTRO'],
    ['cep',                 t.cep.valor,                 '79804-970'],
    ['municipio',           t.municipio.valor,           'Dourados'],
    ['uf',                  t.uf.valor,                  'MS'],
    ['email',               t.email.valor,               null],
    ['telefone',            t.telefone.valor,            '(11) 3144-5600'],
    ['celular',             t.celular.valor,             null],
    ['site',                t.site.valor,                null],
  ];

  let passed = 0;
  let failed = 0;
  for (const [campo, obtido, esperado] of checks) {
    const ok  = obtido === esperado;
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
