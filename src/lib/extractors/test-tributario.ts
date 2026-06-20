/**
 * Script de teste — Fase 7: Motor Tributário e Validação Fiscal
 * Execução: npx tsx src/lib/extractors/test-tributario.ts
 *
 * Encadeia as extrações das fases 5 e 6, depois submete os valores
 * ao motor tributário para classificação, validação e auditoria.
 */

import fs from 'fs';
import path from 'path';
import { extractServico }     from './servico';
import { extractFinanceiro }  from './financeiro';
import { analyzeTributario }  from './tributario';
import type { ValoresExtrados, RegraFiscal } from './tributario';

const PDF_PATH = path.join(
  process.env.USERPROFILE ?? process.env.HOME ?? '',
  'Downloads', 'MODELO NF.pdf',
);

const ICON_RESULTADO: Record<string, string> = {
  APROVADO:      '✓',
  REPROVADO:     '✗',
  AVISO:         '⚠',
  NAO_APLICAVEL: '–',
};

const SEV_COLOR: Record<string, string> = {
  CRITICO: '[CRÍTICO]',
  MEDIO:   '[MÉDIO  ]',
  BAIXO:   '[BAIXO  ]',
};

async function main() {
  if (!fs.existsSync(PDF_PATH)) {
    console.error(`PDF não encontrado: ${PDF_PATH}`);
    process.exit(1);
  }

  const buf = fs.readFileSync(PDF_PATH);

  // ── Fase 5: extração de serviços ──────────────────────────────────────────
  const servicoResult  = await extractServico(buf);
  const s              = servicoResult.servico;

  // ── Fase 6: extração financeira ───────────────────────────────────────────
  const finResult      = await extractFinanceiro(buf);
  const f              = finResult.financeiro;

  // ── Construir ValoresExtrados para o motor tributário ─────────────────────
  const valores: ValoresExtrados = {
    valor_bruto:      f.valor_bruto.valor,
    valor_liquido:    f.valor_liquido.valor,
    valor_iss:        f.valor_iss.valor,
    base_calculo:     f.base_calculo.valor,
    aliquota_iss:     f.aliquota_iss.valor,
    ir:               f.ir.valor,
    pis_pasep:        f.pis_pasep.valor,
    cofins:           f.cofins.valor,
    inss:             f.inss.valor,
    csll:             f.csll.valor,
    outras_retencoes: f.outras_retencoes.valor,
    codigo_servico:   s.codigo_servico.valor,
  };

  // ── Fase 7: motor tributário ──────────────────────────────────────────────
  const resultado = await analyzeTributario(buf, valores);
  const c         = resultado.classificacao;
  const ibpt      = resultado.ibpt;
  const aud       = resultado.auditoria;

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('  FASE 7 — MOTOR TRIBUTÁRIO E VALIDAÇÃO FISCAL');
  console.log('══════════════════════════════════════════════════════════════════════');

  // ── CLASSIFICAÇÃO FISCAL ─────────────────────────────────────────────────
  console.log('\n🏷  CLASSIFICAÇÃO FISCAL\n');
  const labelC = (k: string, v: string | boolean | null) =>
    console.log(`  ${k.padEnd(26)} : ${v === null ? '(não encontrado)' : String(v)}`);

  labelC('Regime tributário',      c.regime_tributario);
  labelC('Tipo de prestador',      c.tipo_prestador);
  labelC('Simples Nacional',       c.simples_nacional);
  labelC('ISS retido',             c.iss_retido);
  labelC('Responsável pelo ISS',   c.responsavel_iss);
  labelC('Natureza da operação',   c.natureza_operacao);
  labelC('Situação ISSQN',         c.situacao_issqn);
  labelC('Situação NFS-e',         c.situacao_nfse);
  labelC('Local da prestação',     c.local_prestacao);
  labelC('Município de incidência', c.municipio_incidencia);

  // ── DADOS IBPT ────────────────────────────────────────────────────────────
  console.log('\n📊  TRIBUTOS APROXIMADOS — LEI 12.741/2012\n');
  console.log(`  ${'Esfera'.padEnd(12)}  ${'Valor'.padEnd(14)}  Percentual`);
  console.log('  ' + '─'.repeat(40));
  console.log(`  ${'Federal'.padEnd(12)}  R$ ${(ibpt.federal_val ?? '?').padEnd(12)}  ${ibpt.federal_pct ?? '?'}%`);
  console.log(`  ${'Estadual'.padEnd(12)}  R$ ${(ibpt.estadual_val ?? '?').padEnd(12)}  ${ibpt.estadual_pct ?? '?'}%`);
  console.log(`  ${'Municipal'.padEnd(12)}  R$ ${(ibpt.municipal_val ?? '?').padEnd(12)}  ${ibpt.municipal_pct ?? '?'}%`);

  // ── VALORES INJETADOS (Fases 5 e 6) ──────────────────────────────────────
  console.log('\n💰  VALORES FINANCEIROS (injetados pelas Fases 5 e 6)\n');
  const labelV = (k: string, v: string | null) =>
    console.log(`  ${k.padEnd(26)} : R$ ${v ?? '?'}`);
  labelV('Valor bruto',         valores.valor_bruto);
  labelV('Valor ISS',           valores.valor_iss);
  labelV('Valor líquido',       valores.valor_liquido);
  labelV('Base de cálculo',     valores.base_calculo);
  console.log(`  ${'Alíquota ISS'.padEnd(26)} : ${valores.aliquota_iss ?? '?'}%`);
  labelV('IR',                  valores.ir);
  labelV('PIS/PASEP',           valores.pis_pasep);
  labelV('COFINS',              valores.cofins);
  labelV('INSS',                valores.inss);
  labelV('CSLL',                valores.csll);
  labelV('Outras retenções',    valores.outras_retencoes);
  console.log(`  ${'Código do serviço'.padEnd(26)} : ${valores.codigo_servico ?? '?'}`);

  // ── REGRAS FISCAIS ────────────────────────────────────────────────────────
  console.log('\n⚖️  REGRAS FISCAIS APLICADAS\n');
  const printRegra = (r: RegraFiscal) => {
    const icon = ICON_RESULTADO[r.resultado] ?? '?';
    const sev  = SEV_COLOR[r.severidade] ?? '';
    console.log(`  ${icon} ${r.codigo}  ${sev}  ${r.descricao}`);
    if (r.resultado !== 'APROVADO') {
      console.log(`       ${r.detalhe}`);
    }
  };
  resultado.regras.forEach(printRegra);

  // ── ALERTAS ───────────────────────────────────────────────────────────────
  if (resultado.alertas.length > 0) {
    console.log('\n🚨  ALERTAS FISCAIS\n');
    for (const a of resultado.alertas) {
      console.log(`  ${SEV_COLOR[a.severidade]}  ${a.codigo}: ${a.descricao}`);
      if (a.detalhe) console.log(`    → ${a.detalhe}`);
    }
  } else {
    console.log('\n✅  NENHUM ALERTA FISCAL DETECTADO');
  }

  // ── AUDITORIA ─────────────────────────────────────────────────────────────
  console.log('\n📋  PARECER DE AUDITORIA\n');
  const nivelBar = aud.score >= 90 ? '████████████████████' :
                   aud.score >= 75 ? '███████████████░░░░░' :
                   aud.score >= 50 ? '██████████░░░░░░░░░░' :
                   aud.score >= 25 ? '█████░░░░░░░░░░░░░░░' : '░░░░░░░░░░░░░░░░░░░░';

  console.log(`  Nível       : ${aud.nivel}`);
  console.log(`  Score       : ${aud.score}%  [${nivelBar}]`);
  console.log(`  Resumo      : ${aud.resumo}`);
  console.log('\n  Recomendações:');
  aud.recomendacoes.forEach((r, i) => console.log(`  ${i + 1}. ${r}`));

  // ── RESUMO GERAL ──────────────────────────────────────────────────────────
  const aprovadas    = resultado.regras.filter(r => r.resultado === 'APROVADO').length;
  const reprovadas   = resultado.regras.filter(r => r.resultado === 'REPROVADO').length;
  const avisos       = resultado.regras.filter(r => r.resultado === 'AVISO').length;
  const naoAplicavel = resultado.regras.filter(r => r.resultado === 'NAO_APLICAVEL').length;

  console.log('\n──────────────────────────────────────────────────────────────────────');
  console.log(`  Regras: ${resultado.regras.length} total  |  ` +
    `✓ ${aprovadas} aprovadas  |  ✗ ${reprovadas} reprovadas  |  ` +
    `⚠ ${avisos} avisos  |  – ${naoAplicavel} n/a`);
  console.log(`  Confiança fiscal : ${resultado.confianca_fiscal}%  [${aud.nivel}]`);
  console.log(`  Inconsistências  : ${resultado.possui_inconsistencias ? 'SIM' : 'NÃO'}`);
  console.log(`  Tempo            : ${resultado.extractionMs}ms`);

  // ─── VERIFICAÇÃO DOS VALORES ESPERADOS ───────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('\n🧪  VERIFICAÇÃO DOS VALORES ESPERADOS (PDF modelo)\n');

  type Check = [string, unknown, unknown];
  const checks: Check[] = [
    // Classificação fiscal
    ['regime_tributario',           c.regime_tributario,      'SIMPLES_NACIONAL'],
    ['tipo_prestador',              c.tipo_prestador,         'ME_EPP'],
    ['simples_nacional',            c.simples_nacional,       true],
    ['iss_retido',                  c.iss_retido,             true],
    ['responsavel_iss',             c.responsavel_iss,        'TOMADOR'],
    ['natureza_operacao',           c.natureza_operacao,      'Operação Tributável'],
    ['situacao_issqn',              c.situacao_issqn,         'Retenção'],
    ['situacao_nfse',               c.situacao_nfse,          'Retida'],
    ['local_prestacao',             c.local_prestacao,        'Dourados'],
    // IBPT
    ['ibpt.federal_val',            ibpt.federal_val,         '6.725,00'],
    ['ibpt.federal_pct',            ibpt.federal_pct,         '13,45'],
    ['ibpt.estadual_val',           ibpt.estadual_val,        '0,00'],
    ['ibpt.estadual_pct',           ibpt.estadual_pct,        '0,00'],
    ['ibpt.municipal_val',          ibpt.municipal_val,       '2.500,00'],
    ['ibpt.municipal_pct',          ibpt.municipal_pct,       '5,00'],
    // Resultado global
    ['possui_inconsistencias',      resultado.possui_inconsistencias, false],
    ['confianca_fiscal >= 90',      resultado.confianca_fiscal >= 90, true],
    ['auditoria.nivel',             aud.nivel,                'APROVADO'],
    ['alertas.length === 0',        resultado.alertas.length === 0,   true],
    ['regras aprovadas >= 14',      aprovadas >= 14,          true],
  ];

  let passed = 0;
  let failed = 0;
  for (const [campo, obtido, esperado] of checks) {
    const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
    if (ok) passed++; else failed++;
    const icon = ok ? '✓' : '✗';
    const obt  = JSON.stringify(obtido);
    const esp  = JSON.stringify(esperado);
    if (!ok) console.log(`  ${icon} ${campo.padEnd(30)}  esperado=${esp}  obtido=${obt}`);
    else     console.log(`  ${icon} ${campo.padEnd(30)}  ${obt}`);
  }

  console.log(`\n  Resultado: ${passed}/${checks.length} verificações corretas`);
  if (failed > 0) console.log(`  FALHAS: ${failed} verificação(ões) diferem do esperado`);
  else            console.log('  TODAS AS VERIFICAÇÕES CORRETAS!');
  console.log('══════════════════════════════════════════════════════════════════════\n');
}

main().catch(err => { console.error('Erro:', err); process.exit(1); });
