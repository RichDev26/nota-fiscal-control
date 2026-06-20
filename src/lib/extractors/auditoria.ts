/**
 * Fase 11 — Sistema Central de Auditoria
 *
 * Registra, persiste e consulta todos os eventos auditáveis do sistema.
 *
 * DESIGN:
 *   - Append-only: eventos nunca são modificados após criação
 *   - Integridade: hash djb2 calculado no momento do registro
 *   - JSONL: um JSON por linha — eficiente para append sem carregar tudo
 *   - Isolado: não depende de parsers nem fases 1-10
 *
 * SENSIBILIDADE PADRÃO POR CATEGORIA:
 *   EXPORTACAO / VISUALIZACAO_SENSIVEL → critica
 *   LOGIN / FALHA_AUTORIZACAO          → alta
 *   CORRECAO / CONFIGURACAO            → alta
 *   VALIDACAO / CONFLITO               → media
 *   EXTRACAO / DOCUMENTO               → baixa
 */

import fs                from 'fs';
import path              from 'path';
import { randomUUID }    from 'crypto';
import { calcularHash }  from './integridade';
import type {
  AuditoriaEvento, SeveridadeEvento, SensibilidadeDados,
  CategoriaEvento, SubcategoriaEvento, OrigemEvento, StatusEvento,
  FiltrosAuditoria,
} from './auditoria-tipos';

// ─── VERSÃO DO MOTOR ─────────────────────────────────────────────────────────

export const VERSAO_MOTOR_ATUAL = '11.0.0';
const VERSAO_REGRA_ATUAL        = '1.0.0';

// ─── CAMINHOS ─────────────────────────────────────────────────────────────────

const DATA_DIR     = path.join(__dirname, 'data', 'auditoria');
const EVENTOS_PATH = path.join(DATA_DIR, 'eventos.jsonl');

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ─── PERSISTÊNCIA ─────────────────────────────────────────────────────────────

function appendEvento(evento: AuditoriaEvento): void {
  ensureDir();
  fs.appendFileSync(EVENTOS_PATH, JSON.stringify(evento) + '\n', 'utf-8');
  // Write-through: persiste evento no DB para sobreviver a redeploys
  import('@/lib/prisma').then(({ default: prisma }) =>
    prisma.eventoAuditoria.upsert({
      where:  { id: evento.evento_id },
      create: {
        id:         evento.evento_id,
        timestamp:  new Date(evento.timestamp),
        categoria:  String(evento.categoria),
        severidade: String(evento.severidade),
        dados:      JSON.stringify(evento),
      },
      update: { dados: JSON.stringify(evento) },
    })
  ).catch(err => console.error('[Auditoria] Falha ao sincronizar DB:', err));
}

export function carregarEventos(): AuditoriaEvento[] {
  ensureDir();
  if (!fs.existsSync(EVENTOS_PATH)) return [];
  return fs
    .readFileSync(EVENTOS_PATH, 'utf-8')
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as AuditoriaEvento);
}

// ─── INFERÊNCIA DE SENSIBILIDADE ─────────────────────────────────────────────

function inferirSensibilidade(
  cat:    CategoriaEvento,
  subcat: SubcategoriaEvento,
  campo:  string | null,
): SensibilidadeDados {
  if (subcat === 'EXPORTACAO' || subcat === 'VISUALIZACAO_SENSIVEL') return 'critica';
  if (subcat === 'LOGIN' || subcat === 'FALHA_LOGIN' || subcat === 'FALHA_AUTORIZACAO') return 'alta';
  if (cat === 'CONFIGURACAO') return 'alta';
  if (cat === 'CORRECAO') {
    const isCnpj = campo && ['cpf_cnpj', 'cnpj', 'cpfCnpj'].some(k => campo.includes(k));
    return isCnpj ? 'critica' : 'alta';
  }
  if (cat === 'VALIDACAO' || cat === 'CONFLITO') return 'media';
  if (subcat === 'REMOCAO' || subcat === 'SUBSTITUICAO') return 'alta';
  return 'baixa';
}

// ─── ENTRADA PARA REGISTRO ───────────────────────────────────────────────────

export interface EntradaEvento {
  documento_id?:       string | null;
  usuario_id?:         string | null;
  acao:                string;
  categoria:           CategoriaEvento;
  subcategoria:        SubcategoriaEvento;
  severidade:          SeveridadeEvento;
  sensibilidade?:      SensibilidadeDados;
  entidade:            string;
  campo?:              string | null;
  valor_antigo?:       string | null;
  valor_novo?:         string | null;
  origem:              OrigemEvento;
  metodo?:             string | null;
  confianca?:          number | null;
  status:              StatusEvento;
  ip?:                 string | null;
  session_id?:         string | null;
  versao_motor?:       string;
  versao_regra?:       string | null;
  evento_pai_id?:      string | null;
  reprocessamento_id?: string | null;
  reversao?:           boolean;
  observacao?:         string | null;
  dados_extras?:       Record<string, unknown>;
}

// ─── REGISTRO DE EVENTO ───────────────────────────────────────────────────────

/**
 * Registra um evento auditável, lacra com hash e persiste em JSONL.
 * Append-only — o arquivo nunca é reescrito, apenas recebe novas linhas.
 */
export function registrarEvento(entrada: EntradaEvento): AuditoriaEvento {
  const agora        = new Date().toISOString();
  const sensibilidade = entrada.sensibilidade
    ?? inferirSensibilidade(entrada.categoria, entrada.subcategoria, entrada.campo ?? null);

  const semHash: Omit<AuditoriaEvento, 'hash'> = {
    evento_id:          randomUUID(),
    documento_id:       entrada.documento_id       ?? null,
    usuario_id:         entrada.usuario_id          ?? null,
    acao:               entrada.acao,
    categoria:          entrada.categoria,
    subcategoria:       entrada.subcategoria,
    severidade:         entrada.severidade,
    sensibilidade,
    entidade:           entrada.entidade,
    campo:              entrada.campo              ?? null,
    valor_antigo:       entrada.valor_antigo       ?? null,
    valor_novo:         entrada.valor_novo         ?? null,
    origem:             entrada.origem,
    metodo:             entrada.metodo             ?? null,
    confianca:          entrada.confianca          ?? null,
    status:             entrada.status,
    timestamp:          agora,
    ip:                 entrada.ip                 ?? null,
    session_id:         entrada.session_id         ?? null,
    versao_motor:       entrada.versao_motor       ?? VERSAO_MOTOR_ATUAL,
    versao_regra:       entrada.versao_regra       ?? VERSAO_REGRA_ATUAL,
    evento_pai_id:      entrada.evento_pai_id      ?? null,
    reprocessamento_id: entrada.reprocessamento_id ?? null,
    reversao:           entrada.reversao           ?? false,
    observacao:         entrada.observacao         ?? null,
    dados_extras:       entrada.dados_extras       ?? {},
  };

  const evento: AuditoriaEvento = { ...semHash, hash: calcularHash(semHash) };
  appendEvento(evento);
  return evento;
}

// ─── CONSULTAS ────────────────────────────────────────────────────────────────

export function buscarEventos(filtros: FiltrosAuditoria): AuditoriaEvento[] {
  const todos = carregarEventos();
  return todos
    .filter(e => {
      if (filtros.documento_id && e.documento_id !== filtros.documento_id) return false;
      if (filtros.usuario_id   && e.usuario_id   !== filtros.usuario_id)   return false;
      if (filtros.categoria    && e.categoria    !== filtros.categoria)     return false;
      if (filtros.subcategoria && e.subcategoria !== filtros.subcategoria)  return false;
      if (filtros.severidade   && e.severidade   !== filtros.severidade)    return false;
      if (filtros.campo        && e.campo        !== filtros.campo)         return false;
      if (filtros.status       && e.status       !== filtros.status)        return false;
      if (filtros.de  && e.timestamp < filtros.de)  return false;
      if (filtros.ate && e.timestamp > filtros.ate) return false;
      return true;
    })
    .slice(filtros.offset ?? 0, (filtros.offset ?? 0) + (filtros.limite ?? 1000));
}

export function buscarEventosPorDocumento(documentoId: string): AuditoriaEvento[] {
  return buscarEventos({ documento_id: documentoId, limite: 500 });
}

export function buscarEventosPorUsuario(usuarioId: string): AuditoriaEvento[] {
  return buscarEventos({ usuario_id: usuarioId, limite: 500 });
}

export function buscarEventosPorSeveridade(severidade: SeveridadeEvento): AuditoriaEvento[] {
  return buscarEventos({ severidade, limite: 500 });
}

// ─── HELPERS PRÉ-FORMATADOS ──────────────────────────────────────────────────

/** Upload de PDF pelo usuário */
export function auditarUpload(
  documentoId:  string,
  usuarioId:    string | null,
  ip:           string | null,
  nomeArquivo:  string,
  tamanhoBytes: number,
): AuditoriaEvento {
  return registrarEvento({
    documento_id: documentoId,
    usuario_id:   usuarioId,
    acao:         'documento.upload',
    categoria:    'DOCUMENTO',
    subcategoria: 'UPLOAD',
    severidade:   'media',
    entidade:     'nota',
    origem:       'HUMANO',
    status:       'SUCESSO',
    ip,
    observacao:   `Arquivo: ${nomeArquivo}, ${tamanhoBytes} bytes`,
    dados_extras: { nome_arquivo: nomeArquivo, tamanho_bytes: tamanhoBytes },
  });
}

/** Execução de um bloco de extração (Fases 2-7) */
export function auditarExtracao(
  documentoId:        string,
  bloco:              'cabecalho' | 'prestador' | 'tomador' | 'servicos' | 'financeiro' | 'fiscal',
  scoreConfianca:     number,
  metodo:             string,
  camposEncontrados:  number,
  camposTotais:       number,
): AuditoriaEvento {
  const subcategorias: Record<string, SubcategoriaEvento> = {
    cabecalho:  'EXTRACAO_CABECALHO',
    prestador:  'EXTRACAO_PRESTADOR',
    tomador:    'EXTRACAO_TOMADOR',
    servicos:   'EXTRACAO_SERVICOS',
    financeiro: 'EXTRACAO_FINANCEIRO',
    fiscal:     'EXTRACAO_FISCAL',
  };
  return registrarEvento({
    documento_id: documentoId,
    acao:         `extracao.${bloco}`,
    categoria:    'EXTRACAO',
    subcategoria: subcategorias[bloco],
    severidade:   scoreConfianca < 70 ? 'alta' : 'baixa',
    entidade:     'nota',
    origem:       'AUTOMATICO',
    metodo,
    confianca:    scoreConfianca,
    status:       camposEncontrados === camposTotais ? 'SUCESSO' : 'PARCIAL',
    observacao:   `${camposEncontrados}/${camposTotais} campos encontrados`,
    dados_extras: { campos_encontrados: camposEncontrados, campos_totais: camposTotais, bloco },
  });
}

/** Resultado da validação cruzada (Fase 9) */
export function auditarValidacaoCruzada(
  documentoId:         string,
  taxaConcordancia:    number,
  divergenciasCriticas: number,
  bloqueado:           boolean,
  motivoBloqueio?:     string,
): AuditoriaEvento {
  return registrarEvento({
    documento_id: documentoId,
    acao:         'validacao.cruzada',
    categoria:    'VALIDACAO',
    subcategoria: 'VALIDACAO_CRUZADA',
    severidade:   bloqueado ? 'critica' : (divergenciasCriticas > 0 ? 'alta' : 'baixa'),
    entidade:     'nota',
    origem:       'AUTOMATICO',
    confianca:    taxaConcordancia,
    status:       bloqueado ? 'FALHA' : (divergenciasCriticas > 0 ? 'PARCIAL' : 'SUCESSO'),
    observacao:   bloqueado ? (motivoBloqueio ?? 'Bloqueado por divergência crítica') : undefined,
    dados_extras: { taxa_concordancia: taxaConcordancia, divergencias_criticas: divergenciasCriticas, bloqueado },
  });
}

/** Correção manual de campo pelo usuário */
export function auditarCorrecaoManual(
  documentoId: string,
  usuarioId:   string,
  campo:       string,
  valorAntigo: string | null,
  valorNovo:   string | null,
  observacao?: string,
): AuditoriaEvento {
  return registrarEvento({
    documento_id: documentoId,
    usuario_id:   usuarioId,
    acao:         'campo.corrigido',
    categoria:    'CORRECAO',
    subcategoria: 'CORRECAO_MANUAL',
    severidade:   'alta',
    entidade:     'campo',
    campo,
    valor_antigo: valorAntigo,
    valor_novo:   valorNovo,
    origem:       'HUMANO',
    status:       'PENDENTE',
    observacao,
  });
}

/** Motor de aprendizado aceita ou rejeita uma correção */
export function auditarResultadoCorrecao(
  documentoId:      string,
  campo:            string,
  aceita:           boolean,
  motivoRejeicao?:  string,
  eventoPaiId?:     string,
): AuditoriaEvento {
  return registrarEvento({
    documento_id:  documentoId,
    acao:          aceita ? 'correcao.aceita' : 'correcao.rejeitada',
    categoria:     'CORRECAO',
    subcategoria:  aceita ? 'CORRECAO_ACEITA' : 'CORRECAO_REJEITADA',
    severidade:    'media',
    entidade:      'campo',
    campo,
    origem:        'AUTOMATICO',
    status:        aceita ? 'SUCESSO' : 'FALHA',
    observacao:    motivoRejeicao,
    evento_pai_id: eventoPaiId ?? null,
    dados_extras:  { aceita, motivo_rejeicao: motivoRejeicao },
  });
}

/** Reprocessamento de documento com base de conhecimento atualizada */
export function auditarReprocessamento(
  documentoId:        string,
  scoreAntes:         number,
  scoreDepois:        number,
  camposRecalculados: string[],
  versaoBase:         string,
): AuditoriaEvento {
  const delta = Math.round((scoreDepois - scoreAntes) * 10) / 10;
  return registrarEvento({
    documento_id: documentoId,
    acao:         'documento.reprocessado',
    categoria:    'DOCUMENTO',
    subcategoria: 'REPROCESSAMENTO',
    severidade:   'media',
    entidade:     'nota',
    valor_antigo: String(scoreAntes),
    valor_novo:   String(scoreDepois),
    origem:       'AUTOMATICO',
    status:       'SUCESSO',
    observacao:   `Score: ${scoreAntes}% → ${scoreDepois}% (delta: ${delta > 0 ? '+' : ''}${delta}%)`,
    dados_extras: { score_antes: scoreAntes, score_depois: scoreDepois, delta, campos_recalculados: camposRecalculados, versao_base: versaoBase },
  });
}

/** Exportação de relatório pelo usuário */
export function auditarExportacao(
  usuarioId:      string,
  formato:        'PDF' | 'EXCEL' | 'CSV' | 'JSON',
  totalNotas:     number,
  documentosIds:  string[],
  filtros:        Record<string, unknown>,
  ip:             string | null,
  hashArquivo?:   string,
): AuditoriaEvento {
  return registrarEvento({
    usuario_id:    usuarioId,
    acao:          'relatorio.exportado',
    categoria:     'ACESSO',
    subcategoria:  'EXPORTACAO',
    severidade:    'alta',
    sensibilidade: 'critica',
    entidade:      'relatorio',
    origem:        'HUMANO',
    status:        'SUCESSO',
    ip,
    observacao:    `Exportação ${formato}: ${totalNotas} nota(s)`,
    dados_extras:  { formato, total_notas: totalNotas, documentos_ids: documentosIds, filtros, hash_arquivo: hashArquivo },
  });
}

/** Divergência detectada entre Método A e Método B */
export function auditarDivergencia(
  documentoId:     string,
  campo:           string,
  valorA:          string | null,
  valorB:          string | null,
  tipoDivergencia: string,
  campoCritico:    boolean,
): AuditoriaEvento {
  return registrarEvento({
    documento_id: documentoId,
    acao:         'conflito.divergencia_detectada',
    categoria:    'CONFLITO',
    subcategoria: 'DIVERGENCIA_METODOS',
    severidade:   campoCritico ? 'alta' : 'media',
    entidade:     'campo',
    campo,
    valor_antigo: valorA,
    valor_novo:   valorB,
    origem:       'AUTOMATICO',
    status:       'PARCIAL',
    observacao:   `Tipo: ${tipoDivergencia}`,
    dados_extras: { valor_metodo_a: valorA, valor_metodo_b: valorB, tipo: tipoDivergencia, critico: campoCritico },
  });
}

/** Erro técnico do sistema */
export function auditarErro(
  documentoId: string | null,
  subcategoria: SubcategoriaEvento,
  mensagem:    string,
  detalhe?:    string,
): AuditoriaEvento {
  return registrarEvento({
    documento_id: documentoId,
    acao:         'sistema.erro',
    categoria:    'ERRO',
    subcategoria,
    severidade:   'alta',
    entidade:     'sistema',
    origem:       'SISTEMA',
    status:       'FALHA',
    observacao:   mensagem,
    dados_extras: { detalhe },
  });
}

/** Mudança em configuração, âncora, fronteira ou versão do motor */
export function auditarMudancaConfiguracao(
  tipo:          'ANCORA' | 'FRONTEIRA' | 'REGRA_FISCAL' | 'LIMIAR_CONFIANCA' | 'VERSAO_MOTOR' | 'ALGORITMO',
  identificador: string,
  valorAntes:    unknown,
  valorDepois:   unknown,
  autor:         string | null,
  motivo:        string,
): AuditoriaEvento {
  const subcategorias: Record<string, SubcategoriaEvento> = {
    ANCORA:            'MUDANCA_ANCORA',
    FRONTEIRA:         'MUDANCA_FRONTEIRA',
    REGRA_FISCAL:      'MUDANCA_REGRA',
    LIMIAR_CONFIANCA:  'MUDANCA_LIMIAR_CONFIANCA',
    VERSAO_MOTOR:      'MUDANCA_VERSAO_MOTOR',
    ALGORITMO:         'MUDANCA_REGRA',
  };
  return registrarEvento({
    usuario_id:    autor,
    acao:          `configuracao.${tipo.toLowerCase()}.alterado`,
    categoria:     'CONFIGURACAO',
    subcategoria:  subcategorias[tipo],
    severidade:    'alta',
    sensibilidade: 'alta',
    entidade:      'configuracao',
    campo:         identificador,
    valor_antigo:  JSON.stringify(valorAntes),
    valor_novo:    JSON.stringify(valorDepois),
    origem:        autor ? 'HUMANO' : 'AUTOMATICO',
    status:        'SUCESSO',
    observacao:    motivo,
  });
}

/** Acesso de usuário a um documento sensível */
export function auditarAcessoDocumento(
  documentoId: string,
  usuarioId:   string,
  acao:        'ACESSO_DOCUMENTO' | 'DOWNLOAD' | 'VISUALIZACAO_SENSIVEL',
  ip:          string | null,
): AuditoriaEvento {
  return registrarEvento({
    documento_id: documentoId,
    usuario_id:   usuarioId,
    acao:         `documento.${acao.toLowerCase()}`,
    categoria:    'ACESSO',
    subcategoria: acao,
    severidade:   acao === 'VISUALIZACAO_SENSIVEL' ? 'alta' : 'media',
    entidade:     'nota',
    origem:       'HUMANO',
    status:       'SUCESSO',
    ip,
  });
}

/** Login / logout / falha de autenticação */
export function auditarAcesso(
  usuarioId: string | null,
  tipo:      'LOGIN' | 'LOGOUT' | 'FALHA_LOGIN',
  ip:        string | null,
  detalhes?: string,
): AuditoriaEvento {
  return registrarEvento({
    usuario_id:   usuarioId,
    acao:         `acesso.${tipo.toLowerCase()}`,
    categoria:    'ACESSO',
    subcategoria: tipo,
    severidade:   tipo === 'FALHA_LOGIN' ? 'alta' : 'media',
    entidade:     'usuario',
    origem:       'HUMANO',
    status:       tipo === 'FALHA_LOGIN' ? 'FALHA' : 'SUCESSO',
    ip,
    observacao:   detalhes,
  });
}

/** Remoção ou substituição de documento */
export function auditarRemocaoDocumento(
  documentoId: string,
  usuarioId:   string,
  tipo:        'REMOCAO' | 'SUBSTITUICAO',
  motivo:      string,
): AuditoriaEvento {
  return registrarEvento({
    documento_id: documentoId,
    usuario_id:   usuarioId,
    acao:         `documento.${tipo.toLowerCase()}`,
    categoria:    'DOCUMENTO',
    subcategoria: tipo,
    severidade:   'alta',
    sensibilidade: 'alta',
    entidade:     'nota',
    origem:       'HUMANO',
    status:       'SUCESSO',
    observacao:   motivo,
  });
}
