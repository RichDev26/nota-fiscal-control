/**
 * Script de teste — Fase 8: Sistema de Confiança Global
 * Execução: npx tsx src/lib/extractors/test-confianca.ts
 *
 * Orquestra todas as fases anteriores (2-7) e passa os resultados ao
 * motor de confiança global. NÃO re-extrai campos nem reimplementa fases.
 */

import fs   from 'fs';
import path from 'path';

import { extractCriticalFields } from './critical-fields';
import { extractPrestador }      from './prestador';
import { extractTomador }        from './tomador';
import { extractServico }        from './servico';
import { extractFinanceiro }     from './financeiro';
import { analyzeTributario }     from './tributario';
import { calculateConfiancaGlobal } from './confianca';
import type { ValoresExtrados }  from './tributario';
import type { NivelConfianca, NivelRisco, CampoConfianca } from './confianca';

const PDF_PATH = path.join(
  process.env.USERPROFILE ?? process.env.HOME ?? '',
  'Downloads', 'MODELO NF.pdf',
);

// ─── HELPERS DE DISPLAY ───────────────────────────────────────────────────────

const NIVEL_EMOJI: Record<NivelConfianca, string> = {
  MUITO_ALTA: '🟢', ALTA: '🟢', MEDIA: '🟡', BAIXA: '🔴', MUITO_BAIXA: '🔴',
};

const RISCO_LABEL: Record<NivelRisco, string> = {
  BAIXO: 'BAIXO  ', MEDIO: 'MÉDIO  ', ALTO: 'ALTO   ', CRITICO: 'CRÍTICO',
};

function barPct(pct: number): string {
  const filled = Math.round(pct / 5);
  return '█'.repeat(filled) + '░'.repeat(20 - filled);
}

function fmtPct(n: number): string { return `${String(n.toFixed(1)).padStart(6)}%`; }

function printCampo(c: CampoConfianca) {
  const icon  = NIVEL_EMOJI[c.nivel];
  const val   = c.valor !== null ? c.valor.substring(0, 30) : '(nulo)';
  const risco = RISCO_LABEL[c.risco];
  const crit  = c.critico ? '★' : ' ';
  const rev   = c.revisao_obrigatoria ? '⚠' : ' ';
  console.log(
    `  ${icon}${crit}${rev} ${c.nome.padEnd(30)} ${fmtPct(c.confianca)}` +
    `  [${c.nivel.padEnd(10)}]  risco:${risco}  ${val}`,
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(PDF_PATH)) {
    console.error(`PDF não encontrado: ${PDF_PATH}`);
    process.exit(1);
  }

  const buf = fs.readFileSync(PDF_PATH);

  // ── Executar todas as fases de extração ────────────────────────────────────
  console.log('\nCarregando fases de extração...');
  const t0 = Date.now();

  const [criticalResult, prestadorResult, tomadorResult, servicoResult, financeiroResult] =
    await Promise.all([
      extractCriticalFields(buf),
      extractPrestador(buf),
      extractTomador(buf),
      extractServico(buf),
      extractFinanceiro(buf),
    ]);

  // Fase 7 exige os valores financeiros
  const f = financeiroResult.financeiro;
  const s = servicoResult.servico;
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
  const tributarioResult = await analyzeTributario(buf, valores);

  const tempoExtracao = Date.now() - t0;

  // ── Fase 8: Sistema de Confiança Global ────────────────────────────────────
  const resultado = calculateConfiancaGlobal({
    critical:   criticalResult,
    prestador:  prestadorResult,
    tomador:    tomadorResult,
    servico:    servicoResult,
    financeiro: financeiroResult,
    tributario: tributarioResult,
  });

  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('  FASE 8 — SISTEMA DE CONFIANÇA GLOBAL');
  console.log('══════════════════════════════════════════════════════════════════════');

  // ── SCORES GLOBAIS ────────────────────────────────────────────────────────
  console.log('\n🎯  SCORES GLOBAIS\n');
  const g = resultado;
  console.log(`  Score Global      ${fmtPct(g.score_global)}  [${barPct(g.score_global)}]  ${g.nivel_global}`);
  console.log(`  Score OCR         ${fmtPct(g.score_ocr)}  [${barPct(g.score_ocr)}]`);
  console.log(`  Score Estrutural  ${fmtPct(g.score_estrutural)}  [${barPct(g.score_estrutural)}]`);
  console.log(`  Score Fiscal      ${fmtPct(g.score_fiscal)}  [${barPct(g.score_fiscal)}]`);

  // ── STATUS GERAL ──────────────────────────────────────────────────────────
  console.log('\n📊  STATUS\n');
  console.log(`  ${resultado.bloqueado ? '🚫 BLOQUEADO' : '✅ APROVADO'}`);
  if (resultado.motivo_bloqueio) console.log(`  Motivo: ${resultado.motivo_bloqueio}`);
  console.log(`  Revisão obrigatória: ${resultado.revisao_obrigatoria ? 'SIM' : 'NÃO'}`);
  console.log(`\n  ${resultado.resumo}`);

  // ── SCORES POR SEÇÃO ──────────────────────────────────────────────────────
  console.log('\n📋  SCORES POR SEÇÃO\n');
  const secoesNomes = ['cabecalho', 'prestador', 'tomador', 'servicos', 'financeiro', 'fiscal'] as const;
  for (const sec of secoesNomes) {
    const sc = resultado.secoes[sec];
    const icon = NIVEL_EMOJI[sc.nivel];
    const rev  = sc.revisao_obrigatoria ? '⚠ ' : '  ';
    console.log(`  ${icon} ${rev}${sec.padEnd(12)}  ${fmtPct(sc.score)}  [${sc.nivel.padEnd(10)}]`);
    if (sc.alertas.length > 0) sc.alertas.forEach(a => console.log(`          ↳ ${a}`));
  }

  // ── CAMPOS POR SEÇÃO ──────────────────────────────────────────────────────
  console.log('\n🔍  CAMPOS DETALHADOS\n');
  console.log('  🟢★⚠ NOME                           CONF%     NÍVEL        RISCO     VALOR');
  console.log('  ' + '─'.repeat(110));

  for (const sec of secoesNomes) {
    console.log(`\n  ─── ${sec.toUpperCase()} ───`);
    const campos = Object.values(resultado.campos).filter(c => c.secao === sec);
    campos.sort((a, b) => b.peso - a.peso);
    campos.forEach(printCampo);
  }

  // ── CAMPOS CRÍTICOS COM PROBLEMA ──────────────────────────────────────────
  const critProb = Object.values(resultado.campos).filter(c => c.critico && c.confianca < 85);
  if (critProb.length > 0) {
    console.log('\n⚠️  CAMPOS CRÍTICOS COM CONFIANÇA REDUZIDA\n');
    critProb.forEach(c => {
      console.log(`  • ${c.nome} (${c.secao}): ${c.confianca.toFixed(1)}% [${c.nivel}]`);
      c.motivos.forEach(m => console.log(`    – ${m}`));
      console.log('');
    });
  } else {
    console.log('\n✅  TODOS OS CAMPOS CRÍTICOS COM CONFIANÇA SUFICIENTE\n');
  }

  // ── EXPLICAÇÃO ────────────────────────────────────────────────────────────
  console.log('\n💡  ANÁLISE DE CONFIANÇA\n');
  console.log('  Fatores positivos:');
  resultado.explicacao.fatores_positivos.forEach(f => console.log(`    + ${f}`));

  if (resultado.explicacao.fatores_negativos.length > 0) {
    console.log('\n  Fatores negativos:');
    resultado.explicacao.fatores_negativos.forEach(f => console.log(`    - ${f}`));
  }

  if (resultado.explicacao.acoes_recomendadas.length > 0) {
    console.log('\n  Ações recomendadas:');
    resultado.explicacao.acoes_recomendadas.forEach((a, i) => console.log(`    ${i + 1}. ${a}`));
  }

  // ── METODOLOGIA ───────────────────────────────────────────────────────────
  console.log('\n📐  METODOLOGIA\n');
  const palavras = resultado.explicacao.metodologia.split(' ');
  let linha = '  ';
  palavras.forEach(p => {
    if (linha.length + p.length > 100) { console.log(linha); linha = '  ' + p + ' '; }
    else linha += p + ' ';
  });
  if (linha.trim()) console.log(linha);

  // ── ESTATÍSTICAS DE ORIGEM ────────────────────────────────────────────────
  console.log('\n📊  DISTRIBUIÇÃO DE ORIGENS\n');
  const origens = { TEXTO_DIRETO: 0, OCR: 0, FALLBACK_HEURISTICO: 0, INFERENCIA: 0 };
  const camposArr = Object.values(resultado.campos);
  camposArr.forEach(c => { origens[c.origem]++; });
  const total = camposArr.length;
  for (const [orig, cnt] of Object.entries(origens)) {
    const pct = cnt / total * 100;
    console.log(`  ${orig.padEnd(22)}  ${String(cnt).padStart(3)} campos  (${pct.toFixed(1).padStart(5)}%)  [${barPct(pct)}]`);
  }

  // ── RISCOS ────────────────────────────────────────────────────────────────
  console.log('\n⚡  DISTRIBUIÇÃO DE RISCOS\n');
  const riscos = { BAIXO: 0, MEDIO: 0, ALTO: 0, CRITICO: 0 };
  camposArr.forEach(c => { riscos[c.risco]++; });
  for (const [risco, cnt] of Object.entries(riscos)) {
    const pct = cnt / total * 100;
    const icon = risco === 'CRITICO' ? '🔴' : risco === 'ALTO' ? '🟠' : risco === 'MEDIO' ? '🟡' : '🟢';
    console.log(`  ${icon} ${risco.padEnd(10)}  ${String(cnt).padStart(3)} campos  (${pct.toFixed(1).padStart(5)}%)`);
  }

  console.log(`\n──────────────────────────────────────────────────────────────────────`);
  console.log(`  Tempo extração (fases 2-7)  : ${tempoExtracao}ms`);
  console.log(`  Tempo cálculo  (fase 8)     : ${resultado.calculoMs}ms`);
  console.log(`  Total de campos analisados  : ${total}`);
  console.log(`  Campos críticos             : ${camposArr.filter(c => c.critico).length}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // VERIFICAÇÃO DOS VALORES ESPERADOS (PDF modelo)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('\n🧪  VERIFICAÇÃO DOS VALORES ESPERADOS (PDF modelo)\n');

  const r = resultado;
  const c = r.campos;

  type Check = [string, unknown, unknown];
  const checks: Check[] = [
    // Scores globais
    ['score_global >= 80',           r.score_global >= 80,      true],
    ['score_ocr >= 90',              r.score_ocr >= 90,         true],
    ['score_estrutural >= 80',       r.score_estrutural >= 80,  true],
    ['score_fiscal >= 90',           r.score_fiscal >= 90,      true],
    ['nivel_global alta ou muito_alta', ['ALTA', 'MUITO_ALTA'].includes(r.nivel_global), true],
    ['bloqueado === false',          r.bloqueado,                false],
    ['revisao_obrigatoria === false', r.revisao_obrigatoria,     false],

    // Scores de seção
    ['secoes.cabecalho.score >= 80',  r.secoes.cabecalho.score  >= 80, true],
    ['secoes.prestador.score >= 75',  r.secoes.prestador.score  >= 75, true],
    ['secoes.tomador.score >= 75',    r.secoes.tomador.score    >= 75, true],
    ['secoes.servicos.score >= 80',   r.secoes.servicos.score   >= 80, true],
    ['secoes.financeiro.score >= 80', r.secoes.financeiro.score >= 80, true],
    ['secoes.fiscal.score >= 70',     r.secoes.fiscal.score     >= 70, true],

    // Campos críticos — nível mínimo MEDIA
    ['cpf_cnpj_prestador >= 70',     c.cpf_cnpj_prestador?.confianca     >= 70, true],
    ['cpf_cnpj_tomador >= 70',       c.cpf_cnpj_tomador?.confianca       >= 70, true],
    ['valor_bruto >= 80',            c.valor_bruto?.confianca             >= 80, true],
    ['valor_liquido >= 80',          c.valor_liquido?.confianca           >= 80, true],
    ['valor_iss_fin >= 70',          c.valor_iss_fin?.confianca           >= 70, true],
    ['numero_nota >= 80',            c.numero_nota?.confianca             >= 80, true],
    ['codigo_verificacao >= 80',     c.codigo_verificacao?.confianca      >= 80, true],

    // Campos críticos — sem bloqueio
    ['risco valor_bruto != CRITICO',     c.valor_bruto?.risco     !== 'CRITICO', true],
    ['risco cpf_cnpj_prestador != CRITICO', c.cpf_cnpj_prestador?.risco !== 'CRITICO', true],
    ['risco iss_retido != CRITICO',      c.iss_retido?.risco      !== 'CRITICO', true],

    // Origem — PDF digital deve ter maioria TEXTO_DIRETO
    ['TEXTO_DIRETO >= 70% dos campos',
      camposArr.filter(x => x.origem === 'TEXTO_DIRETO').length / total >= 0.70, true],

    // Campos fiscais extraídos
    ['natureza_operacao.valor != null', c.natureza_operacao?.valor !== null, true],
    ['situacao_nfse.valor != null',     c.situacao_nfse?.valor    !== null, true],
    ['regime_tributario.valor === SIMPLES_NACIONAL',
      c.regime_tributario?.valor === 'SIMPLES_NACIONAL', true],

    // Explicação tem fatores positivos
    ['explicacao tem fatores_positivos', r.explicacao.fatores_positivos.length > 0, true],
  ];

  let passed = 0;
  let failed = 0;
  for (const [campo, obtido, esperado] of checks) {
    const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
    if (ok) passed++; else failed++;
    const icon = ok ? '✓' : '✗';
    const obt  = JSON.stringify(obtido);
    const esp  = JSON.stringify(esperado);
    if (!ok) console.log(`  ${icon} ${campo.padEnd(42)}  esperado=${esp}  obtido=${obt}`);
    else     console.log(`  ${icon} ${campo.padEnd(42)}  ${obt}`);
  }

  console.log(`\n  Resultado: ${passed}/${checks.length} verificações corretas`);
  if (failed > 0) console.log(`  FALHAS: ${failed} verificação(ões) diferem do esperado`);
  else            console.log('  TODAS AS VERIFICAÇÕES CORRETAS!');
  console.log('══════════════════════════════════════════════════════════════════════\n');
}

main().catch(err => { console.error('Erro:', err); process.exit(1); });
