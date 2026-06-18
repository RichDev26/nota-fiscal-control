/**
 * Script de teste — Fase 3: Extrator PRESTADOR DE SERVIÇOS
 * Execução: npx tsx src/lib/extractors/test-prestador.ts
 */

import fs from 'fs';
import path from 'path';
import { extractPrestador } from './prestador';

const PDF_PATH = path.join(
  process.env.USERPROFILE ?? process.env.HOME ?? '',
  'Downloads',
  'MODELO NF.pdf',
);

async function main() {
  if (!fs.existsSync(PDF_PATH)) {
    console.error(`PDF não encontrado: ${PDF_PATH}`);
    process.exit(1);
  }

  const buf = fs.readFileSync(PDF_PATH);
  const result = await extractPrestador(buf);

  const p = result.prestador;

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  FASE 3 — RESULTADO DA EXTRAÇÃO: PRESTADOR DE SERVIÇOS');
  console.log('══════════════════════════════════════════════════════════════');

  console.log(`\n📍 ZONA DETECTADA`);
  console.log(`  Estratégia : ${result.zona.estrategia}`);
  console.log(`  Índice ini  : ${result.zona.inicio}`);
  console.log(`  Índice fim  : ${result.zona.fim}`);
  console.log(`  Segmentos  :`);
  result.zona.segmentos.forEach((s, i) => {
    console.log(`    [${String(i).padStart(2, '0')}] "${s}"`);
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

  line('razao_social',        p.razao_social);
  line('nome_fantasia',       p.nome_fantasia);
  line('cpf_cnpj',            p.cpf_cnpj);
  line('inscricao_municipal', p.inscricao_municipal);
  line('inscricao_estadual',  p.inscricao_estadual);
  line('endereco',            p.endereco);
  line('numero',              p.numero);
  line('complemento',         p.complemento);
  line('bairro',              p.bairro);
  line('cep',                 p.cep);
  line('municipio',           p.municipio);
  line('uf',                  p.uf);
  line('email',               p.email);
  line('telefone',            p.telefone);
  line('celular',             p.celular);
  line('site',                p.site);

  console.log('\n──────────────────────────────────────────────────────────────');
  console.log(`  Confiança global : ${result.globalConfidence}%  [${result.globalLevel}]`);
  console.log(`  Tempo extração   : ${result.extractionMs}ms`);

  console.log('\n🔍 VALIDAÇÕES DETALHADAS\n');
  for (const [key, field] of Object.entries(p)) {
    const f = field as typeof p.razao_social;
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

  // Verificação de valores esperados (modelo JM Inox)
  console.log('🧪 VERIFICAÇÃO DOS VALORES ESPERADOS\n');
  const checks: Array<[string, string | null, string | null]> = [
    ['razao_social',        p.razao_social.valor,        'JM Inox Manutencoa Industrial Ltda'],
    ['nome_fantasia',       p.nome_fantasia.valor,       'JM INOX MANUTENCAO INDUSTRIAL'],
    ['cpf_cnpj',            p.cpf_cnpj.valor,            '49.521.060/0001-49'],
    ['inscricao_municipal', p.inscricao_municipal.valor, '100219493'],
    ['inscricao_estadual',  p.inscricao_estadual.valor,  null],
    ['endereco',            p.endereco.valor,            'R VEREADOR ATAULFO DE MATTOS'],
    ['numero',              p.numero.valor,              '6430'],
    ['complemento',         p.complemento.valor,         null],
    ['bairro',              p.bairro.valor,              'JARDIM JOAO PAULO II'],
    ['cep',                 p.cep.valor,                 '79841-090'],
    ['municipio',           p.municipio.valor,           'Dourados'],
    ['uf',                  p.uf.valor,                  'MS'],
    ['email',               p.email.valor,               'jminoxmanutencaoindustrial@gmail.com'],
    ['telefone',            p.telefone.valor,            '(67) 9237-6776'],
    ['celular',             p.celular.valor,             null],
    ['site',                p.site.valor,                null],
  ];

  let passed = 0;
  let failed = 0;
  for (const [campo, obtido, esperado] of checks) {
    const ok = obtido === esperado;
    if (ok) passed++;
    else failed++;
    const icon = ok ? '✓' : '✗';
    const esp  = esperado === null ? '(nulo)' : esperado;
    const obt  = obtido  === null ? '(nulo)' : obtido;
    if (!ok) console.log(`  ${icon} ${campo.padEnd(22)}  esperado="${esp}"  obtido="${obt}"`);
    else     console.log(`  ${icon} ${campo.padEnd(22)}  "${obt}"`);
  }

  console.log(`\n  Resultado: ${passed}/${checks.length} campos corretos`);
  if (failed > 0) console.log(`  FALHAS: ${failed} campo(s) diferem do esperado`);
  else            console.log('  TODOS OS CAMPOS CORRETOS!');

  console.log('══════════════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Erro:', err);
  process.exit(1);
});
