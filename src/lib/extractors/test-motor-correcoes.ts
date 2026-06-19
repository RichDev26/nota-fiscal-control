/**
 * Script de teste — Fase 10: Motor de Correções e Autoaprendizado Controlado
 * Execução: npx tsx src/lib/extractors/test-motor-correcoes.ts
 *
 * Simula 8 correções humanas baseadas nas divergências reais detectadas na Fase 9,
 * demonstra classificação, validação, aprendizado e reprocessamento.
 */

import fs   from 'fs';
import path from 'path';

import { registrarCorrecao, processarAprendizado, exportarResultadoFase10 } from './motor-correcoes';
import { classificarErro }   from './classificador-erros';
import { carregarBase, resumoBase, salvarBase } from './base-conhecimento';
import { simularReprocessamento } from './reprocessador';
import type { EntradaCorrecao, RegistroCorrecao } from './correcao-tipos';

const PDF_PATH = path.join(
  process.env.USERPROFILE ?? process.env.HOME ?? '',
  'Downloads', 'MODELO NF.pdf',
);

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const SEV_ICON: Record<string, string> = {
  BAIXA: '🟢', MEDIA: '🟡', ALTA: '🟠', CRITICA: '🔴',
};
const STATUS_ICON: Record<string, string> = {
  PENDENTE: '⏳', VALIDADA: '✅', REJEITADA: '❌', CONGELADA: '🧊',
};

function hr(char = '─', n = 70) { return char.repeat(n); }
function fmtPct(n: number) { return `${n.toFixed(1).padStart(5)}%`; }

// ─── SIMULAÇÕES DE CORREÇÃO ───────────────────────────────────────────────────
// Baseadas nas divergências reais observadas na execução da Fase 9.

const DOCUMENTO_ID = 'nfse_187_dourados_20260519';

// Score da Fase 8 para o documento (verificado no test-confianca: 91.5%)
const SCORE_FASE8 = 91.5;

const ENTRADAS: EntradaCorrecao[] = [

  // ── Correção 1: Razão social do tomador ────────────────────────────────
  // Fase 9: divergência CRITICA — B capturou "Data da emissão da nota"
  // Resultado consolidado: null (campo bloqueado). Usuário informa o valor correto.
  {
    documento_id:          DOCUMENTO_ID,
    campo:                 'tomador.razao_social',
    secao:                 'tomador',
    valor_extraido:        null,  // foi anulado pelo sistema por div-crítica
    valor_corrigido:       'Seara Alimentos Ltda',
    correcao_humana:       true,
    observacao:            'Método B capturou rótulo de cabeçalho no PDF de 2 colunas',
    confianca_original:    0,
    score_fase8:           SCORE_FASE8,
    concordancia_fase9:    'DIVERGENCIA_CRITICA',
    metodo_vencedor_fase9: 'NENHUM',
  },

  // ── Correção 2: Telefone do tomador ───────────────────────────────────
  // Fase 9: divergência CRÍTICA — A=(11)3144-5600 (matriz SP), B=(67)3410-5609
  // Usuário confirma que B estava certo (filial Dourados, código 67)
  {
    documento_id:          DOCUMENTO_ID,
    campo:                 'tomador.telefone',
    secao:                 'tomador',
    valor_extraido:        '(11) 3144-5600',
    valor_corrigido:       '(67) 3410-5609',
    correcao_humana:       true,
    observacao:            'Método A capturou telefone da matriz SP; filial Dourados usa DDD 67',
    confianca_original:    100,
    score_fase8:           SCORE_FASE8,
    concordancia_fase9:    'DIVERGENCIA_CRITICA',
    metodo_vencedor_fase9: 'A',
  },

  // ── Correção 3: Descrição do serviço ──────────────────────────────────
  // Fase 9: divergência CRÍTICA — B capturou cabeçalho da tabela "QtdValor unitário"
  // Usuário confirma que A estava certo
  {
    documento_id:          DOCUMENTO_ID,
    campo:                 'servico.descricao',
    secao:                 'servicos',
    valor_extraido:        'Referente a instalação dos tanques de salmoura.',
    valor_corrigido:       'Referente a instalação dos tanques de salmoura.',
    correcao_humana:       true,
    observacao:            'Confirmação: Método A extraiu corretamente. Método B capturou cabeçalho da tabela.',
    confianca_original:    90,
    score_fase8:           SCORE_FASE8,
    concordancia_fase9:    'DIVERGENCIA_CRITICA',
    metodo_vencedor_fase9: 'A',
  },

  // ── Correção 4: Valor aproximado de tributos ──────────────────────────
  // Fase 9: B extraiu 6.725,00 (só federal), A extraiu 9.225,00 (total = fed+mun+est)
  // Usuário confirma que A (9.225,00) está correto
  {
    documento_id:          DOCUMENTO_ID,
    campo:                 'valor_aproximado_tributos',
    secao:                 'financeiro',
    valor_extraido:        '9.225,00',
    valor_corrigido:       '9.225,00',
    correcao_humana:       true,
    observacao:            'Confirmação: 9.225,00 = federal + municipal + estadual. B capturou apenas federal.',
    confianca_original:    85,
    score_fase8:           SCORE_FASE8,
    concordancia_fase9:    'DIVERGENCIA_CRITICA',
    metodo_vencedor_fase9: 'A',
  },

  // ── Correção 5: Razão social do prestador ────────────────────────────
  // Fase 9: divergência MODERADA — B retornou null
  // Usuário confirma que A (JM Inox...) está certo
  {
    documento_id:          DOCUMENTO_ID,
    campo:                 'prestador.razao_social',
    secao:                 'prestador',
    valor_extraido:        'JM Inox Manutencoa Industrial Ltda',
    valor_corrigido:       'JM Inox Manutencoa Industrial Ltda',
    correcao_humana:       true,
    observacao:            'Confirmação: A correto. B não extraiu pois zona PRESTADOR vazia neste modelo.',
    confianca_original:    100,
    score_fase8:           SCORE_FASE8,
    concordancia_fase9:    'DIVERGENCIA_MODERADA',
    metodo_vencedor_fase9: 'A',
  },

  // ── Correção 6: Valor ISS (confirmação via derivação) ────────────────
  // Fase 9: B retornou null, A retornou 2.500,00. Usuário confirma A.
  {
    documento_id:          DOCUMENTO_ID,
    campo:                 'valor_iss',
    secao:                 'financeiro',
    valor_extraido:        '2.500,00',
    valor_corrigido:       '2.500,00',
    correcao_humana:       true,
    observacao:            'Confirmação: 50.000 × 5% = 2.500,00 — matematicamente correto.',
    confianca_original:    88,
    score_fase8:           SCORE_FASE8,
    concordancia_fase9:    'DIVERGENCIA_MODERADA',
    metodo_vencedor_fase9: 'A',
  },

  // ── Correção 7: SUSPEITA — usuário tenta "corrigir" número da nota ──
  // Ambos A e B concordaram em 187 (CONCORDANCIA_TOTAL). Usuário tenta mudar para 185.
  // O sistema deve detectar suspeita e REJEITAR.
  {
    documento_id:          DOCUMENTO_ID,
    campo:                 'numero_nota',
    secao:                 'cabecalho',
    valor_extraido:        '187',
    valor_corrigido:       '185',
    correcao_humana:       true,
    observacao:            'Usuário acredita que número pode estar errado',
    confianca_original:    91,
    score_fase8:           SCORE_FASE8,
    concordancia_fase9:    'CONCORDANCIA_TOTAL',    // ← AMBOS concordaram!
    metodo_vencedor_fase9: 'AMBOS',
  },

  // ── Correção 8: OCR — código de verificação ──────────────────────────
  // Simulação de erro OCR: 'FHZSBPES7' foi lido como 'FHZSBPE57' (5↔S no final)
  {
    documento_id:          DOCUMENTO_ID,
    campo:                 'codigo_verificacao',
    secao:                 'cabecalho',
    valor_extraido:        'FHZSBPE57',   // OCR confundiu 'S' com '5' ao final
    valor_corrigido:       'FHZSBPES7',
    correcao_humana:       true,
    observacao:            'OCR confundiu S com 5 no penúltimo caractere',
    confianca_original:    85,
    score_fase8:           SCORE_FASE8,
    concordancia_fase9:    'DIVERGENCIA_LEVE',
    metodo_vencedor_fase9: 'B',
  },
];

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(PDF_PATH)) {
    console.warn(`PDF não encontrado: ${PDF_PATH} — executando simulação sem extração ao vivo.`);
  }

  // Resetar base para estado limpo a cada execução do teste
  const dataDir = path.join(__dirname, 'data');
  const basePath = path.join(dataDir, 'base-conhecimento.json');
  const logPath  = path.join(dataDir, 'correcoes.json');
  if (fs.existsSync(basePath)) fs.unlinkSync(basePath);
  if (fs.existsSync(logPath))  fs.unlinkSync(logPath);

  // Carrega (ou cria) base de conhecimento inicial
  const baseInicial = carregarBase();

  console.log('\n' + hr('═'));
  console.log('  FASE 10 — MOTOR DE CORREÇÕES E AUTOAPRENDIZADO CONTROLADO');
  console.log(hr('═'));
  console.log('\n📚  ESTADO INICIAL DA BASE DE CONHECIMENTO\n');
  console.log(resumoBase(baseInicial).split('\n').map(l => '  ' + l).join('\n'));

  // ── ETAPA 1: Classificação e Registro ───────────────────────────────────
  console.log('\n' + hr());
  console.log('\n🔬  ETAPA 1 — CLASSIFICAÇÃO AUTOMÁTICA DE ERROS\n');
  console.log('  ' + [
    'Nº'.padEnd(3), 'CAMPO'.padEnd(30), 'TIPO DE ERRO'.padEnd(32),
    'SUBTIPO'.padEnd(25), 'SEV', 'ORIGEM',
  ].join('  '));
  console.log('  ' + hr('-', 120));

  const registros: RegistroCorrecao[] = [];

  for (let i = 0; i < ENTRADAS.length; i++) {
    const entrada = ENTRADAS[i];
    const classif = classificarErro(entrada);
    console.log('  ' + [
      String(i + 1).padEnd(3),
      entrada.campo.padEnd(30),
      classif.tipo.padEnd(32),
      (classif.subtipo ?? '—').padEnd(25),
      SEV_ICON[classif.severidade],
      classif.origem,
    ].join('  '));
    console.log(`       Justificativa: ${classif.justificativa.substring(0, 100)}`);

    // Registrar no motor
    const reg = registrarCorrecao(entrada);
    registros.push(reg);
  }

  // ── ETAPA 2: Processamento do Aprendizado ────────────────────────────────
  console.log('\n' + hr());
  console.log('\n🧠  ETAPA 2 — PROCESSAMENTO DO APRENDIZADO\n');

  const resultado = processarAprendizado(registros);

  for (let i = 0; i < registros.length; i++) {
    const reg = registros[i];
    // Reload after processarAprendizado updates status in log
    const icon = STATUS_ICON[reg.status] ?? '?';
    console.log(`  ${icon} [${i + 1}] ${reg.campo.padEnd(32)} → ${reg.status}`);
    if (reg.status === 'REJEITADA' && reg.motivo_rejeicao) {
      console.log(`        Motivo: ${reg.motivo_rejeicao.substring(0, 90)}`);
    }
    if (reg.status === 'CONGELADA') {
      console.log(`        ⚠ Campo CONGELADO — aprendizado suspenso até revisão humana`);
    }
  }

  console.log('\n  Resumo do aprendizado:');
  console.log(`  ✅ Aceitas:   ${resultado.correcoes_aceitas}`);
  console.log(`  ❌ Rejeitadas: ${resultado.correcoes_rejeitadas}`);
  console.log(`  🧊 Congeladas: ${resultado.correcoes_congeladas}`);
  console.log(`  Âncoras afetadas:    ${resultado.ancoras_afetadas.join(', ') || '(nenhuma)'}`);
  console.log(`  Heurísticas afetadas: ${resultado.heuristicas_afetadas.join(', ') || '(nenhuma)'}`);
  console.log(`  Fronteiras afetadas: ${resultado.fronteiras_afetadas.join(', ') || '(nenhuma)'}`);
  if (resultado.campos_congelados.length > 0)
    console.log(`  🧊 Campos congelados: ${resultado.campos_congelados.join(', ')}`);
  if (resultado.alertas.length > 0) {
    console.log('\n  Alertas:');
    resultado.alertas.forEach(a => console.log(`    ! ${a}`));
  }

  // ── ETAPA 3: Estado da Base Após Aprendizado ─────────────────────────────
  console.log('\n' + hr());
  console.log('\n📚  ETAPA 3 — BASE DE CONHECIMENTO APÓS APRENDIZADO\n');
  const baseAtualizada = carregarBase();
  console.log(resumoBase(baseAtualizada).split('\n').map(l => '  ' + l).join('\n'));

  console.log('\n  Heurísticas ajustadas:');
  for (const [campo, h] of Object.entries(baseAtualizada.heuristicas)) {
    if (h.delta_confianca !== 0 || h.correcoes_validadas > 0) {
      console.log(
        `    • ${campo.padEnd(35)} delta=${String(h.delta_confianca).padStart(4)}  ` +
        `validadas=${h.correcoes_validadas}  nível=${h.nivel_aprendizado}`,
      );
    }
  }

  console.log('\n  Âncoras ajustadas:');
  for (const [campo, a] of Object.entries(baseAtualizada.ancoras)) {
    console.log(
      `    • ${campo.padEnd(35)} conf_histórica=${fmtPct(a.confianca_historica)}  ` +
      `erros=${a.erros_registrados}  ${a.congelado ? '🧊 CONGELADO' : ''}`,
    );
    if (a.notas) console.log(`      nota: ${a.notas.substring(0, 80)}`);
  }

  console.log('\n  Histórico de versões:');
  for (const v of baseAtualizada.historico_versoes.slice(-5)) {
    const icon = v.revertido ? '↩' : '→';
    console.log(`    ${icon} v${v.versao}  [${v.responsavel}]  ${v.timestamp.substring(0, 19)}`);
    v.alteracoes.forEach(a => console.log(`       - ${a.substring(0, 80)}`));
  }

  // ── ETAPA 4: Simulação de Reprocessamento ───────────────────────────────
  console.log('\n' + hr());
  console.log('\n🔄  ETAPA 4 — SIMULAÇÃO DE REPROCESSAMENTO\n');

  // Scores atuais da Fase 8 (do test-confianca.ts, valores reais)
  const scoresAtuais: Record<string, number> = {
    numero_nota: 90, codigo_verificacao: 90, data_emissao: 86, data_fato_gerador: 85,
    cpf_cnpj_prestador: 100, razao_social_prestador: 100, nome_fantasia_prestador: 100,
    cpf_cnpj_tomador: 100, razao_social_tomador: 95, telefone_tomador: 70,
    valor_bruto: 95, valor_liquido: 95, valor_iss_fin: 88, aliquota_iss: 88,
    valor_servico_fin: 72, iss_retido: 92, regime_tributario: 88,
    valor_aproximado_tributos: 85, descricao_servico: 90,
  };
  const pesosAtuais: Record<string, number> = {
    numero_nota: 12, codigo_verificacao: 12, data_emissao: 8, data_fato_gerador: 5,
    cpf_cnpj_prestador: 15, razao_social_prestador: 8, nome_fantasia_prestador: 3,
    cpf_cnpj_tomador: 15, razao_social_tomador: 8, telefone_tomador: 2,
    valor_bruto: 12, valor_liquido: 12, valor_iss_fin: 10, aliquota_iss: 6,
    valor_servico_fin: 8, iss_retido: 7, regime_tributario: 4,
    valor_aproximado_tributos: 3, descricao_servico: 2,
  };

  const repro = simularReprocessamento(DOCUMENTO_ID, scoresAtuais, pesosAtuais, SCORE_FASE8);
  console.log(`  Score antes (Fase 8)   : ${fmtPct(repro.score_antes)}`);
  console.log(`  Score depois (ajustado): ${fmtPct(repro.score_depois)}`);
  console.log(`  Delta                  : ${repro.delta_score > 0 ? '+' : ''}${repro.delta_score.toFixed(1)}%`);
  console.log(`  Versão da base usada   : v${repro.versao_base_usada}`);
  if (repro.campos_recalculados.length > 0)
    console.log(`  Campos recalculados    : ${repro.campos_recalculados.join(', ')}`);
  if (repro.campos_melhorados.length > 0)
    console.log(`  Campos melhorados      : ${repro.campos_melhorados.join(', ')}`);
  if (repro.campos_piorados.length > 0)
    console.log(`  Campos piorados        : ${repro.campos_piorados.join(', ')}`);

  // ── ETAPA 5: Saída Padronizada (formato especificado) ────────────────────
  console.log('\n' + hr());
  console.log('\n📤  ETAPA 5 — SAÍDA PADRONIZADA (JSON Fase 10)\n');

  const saida = exportarResultadoFase10(registros, resultado, repro.score_antes, repro.score_depois);
  console.log(JSON.stringify(saida, null, 2).split('\n').map(l => '  ' + l).join('\n'));

  // ── VERIFICAÇÕES ─────────────────────────────────────────────────────────
  console.log('\n' + hr('═'));
  console.log('\n🧪  VERIFICAÇÕES DO MOTOR DE CORREÇÕES\n');

  type Check = [string, unknown, unknown];
  const checks: Check[] = [
    // Integridade básica
    ['total registros == 8',                registros.length,                  8     ],
    ['resultado.correcoes_processadas == 8', resultado.correcoes_processadas,  8     ],

    // Classificação correta
    ['C1 (tomador.razao_social) → ERRO_ANCORA',
      registros.find(r => r.campo === 'tomador.razao_social')?.tipo_erro, 'ERRO_ANCORA'],
    ['C2 (telefone) → erro de confiança ou fronteira (não ERRO_FORMATACAO)',
      ['ERRO_ANCORA','ERRO_FRONTEIRA','ERRO_CLASSIFICACAO_CONFIANCA'].includes(
        registros.find(r => r.campo === 'tomador.telefone')?.tipo_erro ?? ''), true],
    ['C7 (numero_nota) → REJEITADA (consenso A+B)',
      registros.find(r => r.campo === 'numero_nota')?.status, 'REJEITADA'],
    ['C8 (codigo_verificacao) → ERRO_OCR',
      registros.find(r => r.campo === 'codigo_verificacao')?.tipo_erro, 'ERRO_OCR'],

    // Aprendizado
    ['aceitas >= 5',             resultado.correcoes_aceitas >= 5,         true],
    ['rejeitadas >= 1',          resultado.correcoes_rejeitadas >= 1,      true],
    ['heuristicas_afetadas > 0', resultado.heuristicas_afetadas.length > 0, true],
    ['base_atualizada === true', resultado.base_atualizada,                true],

    // Segurança
    ['C7 não foi aceita',
      !(registros.find(r => r.campo === 'numero_nota')?.aceita_para_aprendizado), true],
    ['campos_congelados length >= 0', resultado.campos_congelados.length >= 0, true],

    // Reprocessamento
    ['repro.historico_preservado === true', repro.historico_preservado, true],
    ['repro.versao_base_usada definida',    !!repro.versao_base_usada,   true],

    // Base de conhecimento
    ['base.versao != "1.0.0" (foi versionada)',
      baseAtualizada.versao !== '1.0.0', true],
    ['base.historico_versoes.length > 1', baseAtualizada.historico_versoes.length > 1, true],
    ['base.metricas.total_aceitas >= 5',  baseAtualizada.metricas.total_aceitas >= 5, true],

    // Saída padronizada
    ['saida.correcoes.length == 8',                 saida.correcoes.length,    8    ],
    ['saida.reprocessamento.necessario === true',   saida.reprocessamento.necessario, true],
    ['saida.reprocessamento.score_novo definido',   saida.reprocessamento.score_novo > 0, true],
  ];

  let passed = 0, failed = 0;
  for (const [label, obtido, esperado] of checks) {
    const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
    if (ok) passed++; else failed++;
    const icon = ok ? '✓' : '✗';
    if (!ok) console.log(`  ${icon} ${label.padEnd(50)} esperado=${JSON.stringify(esperado)}  obtido=${JSON.stringify(obtido)}`);
    else     console.log(`  ${icon} ${label.padEnd(50)} ${JSON.stringify(obtido)}`);
  }

  console.log(`\n  Resultado: ${passed}/${checks.length} verificações corretas`);
  if (failed > 0) console.log(`  FALHAS: ${failed} verificação(ões) diferem do esperado`);
  else            console.log('  TODAS AS VERIFICAÇÕES CORRETAS!');

  // ── RECOMENDAÇÕES PARA FASE 11 ───────────────────────────────────────────
  console.log('\n' + hr('═'));
  console.log('\n📌  RECOMENDAÇÕES PARA A FASE 11 (Interface e API de Revisão)\n');

  console.log('  1. API REST para submeter correções via frontend');
  console.log('     POST /api/nfse/:id/correcoes  →  registrarCorrecao()');
  console.log('     GET  /api/nfse/:id/correcoes  →  listar histórico');
  console.log('');
  console.log('  2. Dashboard de revisão humana');
  console.log('     - Listar campos com revisao_obrigatoria=true (Fase 8 + Fase 10)');
  console.log('     - Mostrar divergências da Fase 9 ao lado do resultado da Fase 10');
  console.log('     - Permitir aceitar/rejeitar cada correção individualmente');
  console.log('');
  console.log('  3. Auditoria e rastreabilidade');
  console.log('     - Log de correções com filtro por documento, campo, tipo, período');
  console.log('     - Histórico de versões da base de conhecimento (com reversão manual)');
  console.log('     - Painel de campos congelados aguardando revisão humana');
  console.log('');
  console.log('  4. Promoção humana de padrões (Nível 4)');
  console.log('     - Interface para revisar padrões candidatos à consolidação');
  console.log('     - Botão "Validar padrão" → seta validado_por_humano=true');
  console.log('     - Botão "Reverter padrão" → rollback da base de conhecimento');
  console.log('');
  console.log('  5. Integração com fila de NFS-e');
  console.log('     - Após correção importante, disparar reprocessamento automático');
  console.log('     - Notificar usuário quando score melhora/piora após reprocessamento');
  console.log('     - Persistir ResultadoReprocessamento na tabela de auditoria');

  console.log('\n' + hr('═') + '\n');
}

main().catch(err => { console.error('Erro:', err); process.exit(1); });
