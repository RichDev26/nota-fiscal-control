/**
 * Fase 11 — Teste de Simulação Completa de Auditoria
 *
 * Simula a trilha completa de um documento NFS-e desde o upload até a
 * exportação, sem chamar parsers reais. Usa dados do PDF modelo.
 *
 * Demonstra:
 *   1. Upload e versão original
 *   2. Extração dos blocos (Fases 2-7)
 *   3. Validação cruzada e divergências (Fase 9)
 *   4. Correção humana com aprendizado (Fase 10)
 *   5. Reprocessamento com base atualizada
 *   6. Versão final consolidada
 *   7. Exportação auditada
 *   8. Linhagem completa de dois campos
 *   9. Relatório de integridade da trilha
 *
 * Para executar: npx ts-node src/lib/extractors/test-auditoria.ts
 */

import { randomUUID } from 'crypto';

import {
  registrarEvento,
  auditarUpload,
  auditarExtracao,
  auditarValidacaoCruzada,
  auditarCorrecaoManual,
  auditarResultadoCorrecao,
  auditarReprocessamento,
  auditarExportacao,
  auditarDivergencia,
  buscarEventosPorDocumento,
  carregarEventos,
} from './auditoria';

import {
  criarVersao,
  listarVersoes,
  compararVersoes,
} from './versoes-documento';

import {
  registrarHistoricoCampo,
  listarCorrecoesHumanas,
  resumoInstabilidade,
} from './historico-campo';

import {
  registrarEtapaLinhagem,
  confirmarLinhagem,
  registrarLinhageCorrecaoHumana,
  rastrearCampo,
} from './linhagem';

import { logInfo, logNegocio } from './logger';
import { relatorioIntegridade, calcularHash } from './integridade';

// ─── DADOS DO PDF MODELO ──────────────────────────────────────────────────────
// Representam uma NFS-e emitida em Dourados/MS

const DOCUMENTO_ID = randomUUID();
const USUARIO_ID   = 'user_richard';
const IP_USUARIO   = '192.168.1.10';

const dadosExtraidos: Record<string, string> = {
  numero_nota:              '123',
  codigo_verificacao:       'ABCD-1234-EFGH-5678',
  data_emissao:             '2026-05-18',   // errado — será corrigido
  data_fato_gerador:        '2026-05-19',
  'prestador.razao_social': 'EMPRESA PRESTADORA LTDA',
  'prestador.cpf_cnpj':     '00.000.000/0001-91',
  'tomador.razao_social':   'EMPRESA TOMADORA S.A.',
  'tomador.cpf_cnpj':       '11.111.111/0001-23',
  valor_bruto:              '5000.00',
  valor_liquido:            '4750.00',
  aliquota_iss:             '5.00',
  valor_iss:                '250.00',
};

// ─── SIMULAÇÃO ────────────────────────────────────────────────────────────────

async function simular(): Promise<void> {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  FASE 11 — SIMULAÇÃO DE AUDITORIA COMPLETA');
  console.log(`  Documento ID: ${DOCUMENTO_ID}`);
  console.log('══════════════════════════════════════════════════════════════\n');

  // ── 1. UPLOAD ───────────────────────────────────────────────────────────────
  console.log('[ 1 ] Upload do PDF...');
  const evUpload = auditarUpload(DOCUMENTO_ID, USUARIO_ID, IP_USUARIO, 'nfse_dourados_123.pdf', 412800);
  logInfo('upload', 'PDF recebido', { tamanho: 412800 }, DOCUMENTO_ID);
  logNegocio('upload.pdf', 'nota', { nome_arquivo: 'nfse_dourados_123.pdf' }, DOCUMENTO_ID, USUARIO_ID);

  const v1 = criarVersao(DOCUMENTO_ID, {}, 'original', evUpload.evento_id, USUARIO_ID, 'Upload inicial');
  console.log(`   ✓ evento=${evUpload.evento_id.slice(0, 8)}… | hash_evento=${evUpload.hash} | versao="${v1.label}"\n`);

  // ── 2. EXTRAÇÃO DO CABEÇALHO ────────────────────────────────────────────────
  console.log('[ 2 ] Extração do cabeçalho (Fase 2)...');
  const evCab = auditarExtracao(DOCUMENTO_ID, 'cabecalho', 95, 'regex_anchor', 4, 4);

  registrarHistoricoCampo(DOCUMENTO_ID, 'numero_nota', '123', 'AUTOMATICO', 'regex_anchor', 95, null, evCab.evento_id, 'extração inicial');
  registrarEtapaLinhagem(DOCUMENTO_ID, 'numero_nota', { fase: 'fase_2', metodo: 'regex_anchor', valor: '123', confianca: 95, descricao: 'Âncora "NFS-e Nº" encontrada, valor: 123', confirmado: false }, '123', 95);

  // data_emissao extraída com bug de UTC (18 em vez de 19)
  registrarHistoricoCampo(DOCUMENTO_ID, 'data_emissao', '2026-05-18', 'AUTOMATICO', 'regex_multiline', 78, null, evCab.evento_id, 'extração inicial');
  registrarEtapaLinhagem(DOCUMENTO_ID, 'data_emissao', { fase: 'fase_2', metodo: 'regex_multiline', valor: '2026-05-18', confianca: 78, descricao: 'Data extraída como 18/05 por bug de UTC-3', confirmado: false }, '2026-05-18', 78);

  console.log(`   ✓ confiança=95% | status=${evCab.status}\n`);

  // ── 3. EXTRAÇÃO DO PRESTADOR ────────────────────────────────────────────────
  console.log('[ 3 ] Extração do Prestador (Fase 3)...');
  const evPrest = auditarExtracao(DOCUMENTO_ID, 'prestador', 93, 'zone_anchor_prestador', 8, 10);
  registrarHistoricoCampo(DOCUMENTO_ID, 'prestador.razao_social', 'EMPRESA PRESTADORA LTDA', 'AUTOMATICO', 'zone_razao_social', 93, null, evPrest.evento_id, 'extração inicial');
  registrarEtapaLinhagem(DOCUMENTO_ID, 'prestador.razao_social', { fase: 'fase_3', metodo: 'zone_razao_social', valor: 'EMPRESA PRESTADORA LTDA', confianca: 93, descricao: 'Zona PRESTADOR DE SERVIÇOS detectada via âncora de cabeçalho', confirmado: false }, 'EMPRESA PRESTADORA LTDA', 93);
  console.log(`   ✓ confiança=93% | ${evPrest.status}\n`);

  // ── 4. EXTRAÇÃO DO TOMADOR ──────────────────────────────────────────────────
  console.log('[ 4 ] Extração do Tomador (Fase 4)...');
  const evTom = auditarExtracao(DOCUMENTO_ID, 'tomador', 87, 'zone_anchor_tomador', 7, 10);
  registrarHistoricoCampo(DOCUMENTO_ID, 'tomador.razao_social', 'EMPRESA TOMADORA S.A.', 'AUTOMATICO', 'zone_razao_social_tomador', 87, null, evTom.evento_id, 'extração inicial');
  console.log(`   ✓ confiança=87% | ${evTom.status}\n`);

  // Versão 2: estado após extração completa
  const v2 = criarVersao(DOCUMENTO_ID, dadosExtraidos, 'apos_extracao', evPrest.evento_id, 'SISTEMA', 'Extração completa das Fases 2-7');
  console.log(`   ✓ Versão 2 criada: "${v2.label}" | diff=${v2.diff.length} campo(s)\n`);

  // ── 5. DIVERGÊNCIA DETECTADA (FASE 9) ────────────────────────────────────────
  console.log('[ 5 ] Validação cruzada — divergência detectada (Fase 9)...');
  const evDiv = auditarDivergencia(
    DOCUMENTO_ID, 'tomador.razao_social',
    'EMPRESA TOMADORA S.A.', 'TOMADORA EMPRESA S.A.',
    'DIVERGENCIA_LEVE', false,
  );
  registrarEtapaLinhagem(DOCUMENTO_ID, 'tomador.razao_social', {
    fase:       'fase_9_metodo_b',
    metodo:     'semantic_razao_social',
    valor:      'TOMADORA EMPRESA S.A.',
    confianca:  75,
    descricao:  'Método B extraiu ordem inversa das palavras',
    confirmado: false,
  }, 'EMPRESA TOMADORA S.A.', 87, 'A');
  console.log(`   ✓ campo=${evDiv.campo} | tipo=DIVERGENCIA_LEVE | campo_critico=false\n`);

  // ── 6. RESOLUÇÃO E VALIDAÇÃO CRUZADA ────────────────────────────────────────
  console.log('[ 6 ] Resolução de conflitos e validação cruzada...');
  const evVal = auditarValidacaoCruzada(DOCUMENTO_ID, 92.5, 0, false);
  confirmarLinhagem(DOCUMENTO_ID, 'numero_nota', 'metodo_b');

  const v3 = criarVersao(DOCUMENTO_ID, { ...dadosExtraidos, _concordancia: '92.5%' }, 'apos_validacao', evVal.evento_id, 'SISTEMA', 'Fase 9: concordância 92.5%');
  console.log(`   ✓ taxa_concordancia=92.5% | status=${evVal.status} | versão="${v3.label}"\n`);

  // ── 7. CORREÇÃO HUMANA ────────────────────────────────────────────────────────
  console.log('[ 7 ] Correção humana — data_emissao (bug UTC-3)...');
  const evCorr = auditarCorrecaoManual(
    DOCUMENTO_ID, USUARIO_ID, 'data_emissao',
    '2026-05-18', '2026-05-19',
    'Bug UTC-3: new Date("2026-05-19") = 18/05 no Brasil',
  );

  registrarHistoricoCampo(DOCUMENTO_ID, 'data_emissao', '2026-05-19', 'HUMANO', 'correcao_manual', 100, USUARIO_ID, evCorr.evento_id, 'Correção humana: data UTC-3 ajustada');
  registrarLinhageCorrecaoHumana(DOCUMENTO_ID, 'data_emissao', '2026-05-18', '2026-05-19', USUARIO_ID);

  const evAceita = auditarResultadoCorrecao(DOCUMENTO_ID, 'data_emissao', true, undefined, evCorr.evento_id);
  logNegocio('correcao.campo', 'nota', { campo: 'data_emissao', de: '2026-05-18', para: '2026-05-19' }, DOCUMENTO_ID, USUARIO_ID);

  const dadosCorrigidos = { ...dadosExtraidos, data_emissao: '2026-05-19' };
  const v4 = criarVersao(DOCUMENTO_ID, dadosCorrigidos, 'apos_correcao', evCorr.evento_id, USUARIO_ID, 'Correção da data de emissão (UTC-3)');
  console.log(`   ✓ correção aceita | evento_resultado=${evAceita.evento_id.slice(0, 8)}… | versão="${v4.label}"\n`);

  // ── 8. REPROCESSAMENTO ────────────────────────────────────────────────────────
  console.log('[ 8 ] Reprocessamento com base de conhecimento atualizada...');
  const evReproc = auditarReprocessamento(DOCUMENTO_ID, 88.5, 91.2, ['data_emissao', 'tomador.razao_social'], '1.0.1');
  registrarEtapaLinhagem(DOCUMENTO_ID, 'data_emissao', {
    fase:       'reprocessamento',
    metodo:     'reprocessador_fase10',
    valor:      '2026-05-19',
    confianca:  100,
    descricao:  'Reprocessamento confirmou valor corrigido pelo usuário',
    confirmado: true,
  }, '2026-05-19', 100, 'HUMANO');

  const v5 = criarVersao(DOCUMENTO_ID, dadosCorrigidos, 'apos_reprocessamento', evReproc.evento_id, 'SISTEMA', 'Reprocessamento com base v1.0.1');
  console.log(`   ✓ score 88.5% → 91.2% (+2.7%) | versão="${v5.label}"\n`);

  // ── 9. VERSÃO FINAL ───────────────────────────────────────────────────────────
  console.log('[ 9 ] Consolidação da versão final...');
  const evFinal = registrarEvento({
    documento_id: DOCUMENTO_ID,
    usuario_id:   USUARIO_ID,
    acao:         'documento.finalizado',
    categoria:    'DOCUMENTO',
    subcategoria: 'ARQUIVAMENTO',
    severidade:   'media',
    entidade:     'nota',
    origem:       'HUMANO',
    status:       'SUCESSO',
    observacao:   'Documento aprovado como versão final — score 91.2%',
    dados_extras: { score_final: 91.2 },
  });
  const v6 = criarVersao(DOCUMENTO_ID, dadosCorrigidos, 'final', evFinal.evento_id, USUARIO_ID, 'Versão final aprovada');
  console.log(`   ✓ versão="${v6.label}" | evento=${evFinal.evento_id.slice(0, 8)}…\n`);

  // ── 10. EXPORTAÇÃO ────────────────────────────────────────────────────────────
  console.log('[ 10 ] Exportação de relatório auditada...');
  const hashRel = calcularHash({ notas: [DOCUMENTO_ID], gerado_em: new Date().toISOString() });
  const evExp   = auditarExportacao(USUARIO_ID, 'PDF', 1, [DOCUMENTO_ID], { periodo: '2026-05' }, IP_USUARIO, hashRel);
  logNegocio('exportacao.relatorio', 'relatorio', { formato: 'PDF', total: 1, hash: hashRel }, null, USUARIO_ID);
  console.log(`   ✓ formato=PDF | hash=${hashRel} | evento=${evExp.evento_id.slice(0, 8)}…\n`);

  // ── RESUMO ────────────────────────────────────────────────────────────────────
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  RESUMO DA TRILHA DE AUDITORIA');
  console.log('══════════════════════════════════════════════════════════════\n');

  const todosEventos = buscarEventosPorDocumento(DOCUMENTO_ID);
  console.log(`Eventos do documento: ${todosEventos.length}`);
  todosEventos.forEach((e, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. [${e.severidade.toUpperCase().padEnd(6)}] ${e.categoria}/${e.subcategoria} — ${e.acao} (${e.status})`);
  });

  const versoes = listarVersoes(DOCUMENTO_ID);
  console.log(`\nVersões do documento: ${versoes.length}`);
  versoes.forEach(v => {
    console.log(`  v${v.numero_versao}. "${v.label.padEnd(22)}" — ${v.diff.length} campo(s) alterado(s) — autor: ${v.autor}`);
  });

  const comp = compararVersoes(DOCUMENTO_ID, v2.versao_id, v4.versao_id);
  if (comp) {
    console.log('\nDiff v2 → v4 (extração → após correção):');
    comp.diff.forEach(d => console.log(`   • ${d.campo}: "${d.valor_antes}" → "${d.valor_depois}"`));
  }

  console.log('\n' + rastrearCampo(DOCUMENTO_ID, 'data_emissao'));
  console.log('\n' + rastrearCampo(DOCUMENTO_ID, 'numero_nota'));

  const correcoes = listarCorrecoesHumanas(DOCUMENTO_ID);
  console.log(`\nCorreções humanas registradas: ${correcoes.length}`);
  correcoes.forEach(c => {
    console.log(`   • ${c.campo}: "${c.valor_sistema}" → "${c.valor_humano}" por ${c.usuario_id} em ${c.timestamp}`);
  });

  const instab = resumoInstabilidade(DOCUMENTO_ID);
  console.log('\nInstabilidade de campos (nº de mudanças de valor):');
  Object.entries(instab).filter(([, n]) => n > 0).forEach(([campo, n]) => {
    console.log(`   • ${campo}: ${n} mudança(s)`);
  });

  const todosParaAudit = carregarEventos() as unknown as Array<Record<string, unknown> & { evento_id: string; hash: string; timestamp: string; severidade: string }>;
  const rel = relatorioIntegridade(todosParaAudit);
  console.log(`\nIntegridade da trilha:`);
  console.log(`   Total de eventos : ${rel.total_eventos}`);
  console.log(`   Eventos válidos  : ${rel.eventos_validos}`);
  console.log(`   Corrompidos      : ${rel.eventos_corrompidos}`);
  console.log(`   Lacunas          : ${rel.lacunas_detectadas}`);
  console.log(`   Aprovado         : ${rel.aprovado ? 'SIM ✓' : 'NÃO ✗'}`);

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  SIMULAÇÃO CONCLUÍDA COM SUCESSO');
  console.log('══════════════════════════════════════════════════════════════\n');
}

simular().catch(console.error);
