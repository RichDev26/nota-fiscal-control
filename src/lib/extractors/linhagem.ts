/**
 * Fase 11 — Sistema de Linhagem (Lineage)
 *
 * Rastreia a proveniência de cada valor final do documento.
 * Responde: "De onde veio este dado e como chegou ao valor final?"
 *
 * ESTRUTURA:
 *   Para cada campo de cada documento, mantém uma trilha de etapas:
 *   1. Fase 2-7: qual método extraiu, com que confiança
 *   2. Fase 9: Método A vs B e como o conflito foi resolvido
 *   3. Fase 10: se houve correção ou reprocessamento
 *   4. Humano: se algum usuário confirmou ou alterou o valor
 *
 * OPERAÇÕES SEGURAS:
 *   - Etapas são append-only
 *   - Reversões são registradas como etapa adicional (não apagam histórico)
 *   - Confirmações somam à lista de confirmadores sem apagar etapas
 */

import fs   from 'fs';
import path from 'path';
import type { LinhagemdeCampo, LinhageEtapa } from './auditoria-tipos';

// ─── CAMINHOS ─────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, 'data', 'auditoria', 'linhagem');

function getDocPath(documentoId: string): string {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  return path.join(DATA_DIR, `${documentoId}.json`);
}

type LinhagemDoc = Record<string, LinhagemdeCampo>;

function carregar(documentoId: string): LinhagemDoc {
  const p = getDocPath(documentoId);
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as LinhagemDoc;
}

function salvar(documentoId: string, dados: LinhagemDoc): void {
  fs.writeFileSync(getDocPath(documentoId), JSON.stringify(dados, null, 2), 'utf-8');
}

// ─── OPERAÇÕES ────────────────────────────────────────────────────────────────

/** Registra uma etapa na linhagem de um campo */
export function registrarEtapaLinhagem(
  documentoId:     string,
  campo:           string,
  etapa:           Omit<LinhageEtapa, 'timestamp'>,
  valorFinal:      string | null,
  confiancaFinal:  number | null,
  metodoVencedor?: string,
): void {
  const dados = carregar(documentoId);
  const agora = new Date().toISOString();

  if (!dados[campo]) {
    dados[campo] = {
      campo,
      documento_id:    documentoId,
      valor_final:     valorFinal,
      confianca_final: confiancaFinal,
      etapas:          [],
      metodo_vencedor: metodoVencedor ?? null,
      confirmado_por:  [],
      reversoes:       0,
      criado_em:       agora,
      atualizado_em:   agora,
    };
  }

  const l = dados[campo];
  l.etapas.push({ ...etapa, timestamp: agora });
  l.valor_final       = valorFinal;
  l.confianca_final   = confiancaFinal;
  l.atualizado_em     = agora;
  if (metodoVencedor) l.metodo_vencedor = metodoVencedor;

  salvar(documentoId, dados);
}

/** Adiciona um método/usuário à lista de confirmadores do valor atual */
export function confirmarLinhagem(documentoId: string, campo: string, confirmador: string): void {
  const dados = carregar(documentoId);
  if (!dados[campo]) return;
  if (!dados[campo].confirmado_por.includes(confirmador)) {
    dados[campo].confirmado_por.push(confirmador);
    dados[campo].atualizado_em = new Date().toISOString();
    salvar(documentoId, dados);
  }
}

/** Registra uma reversão — a reversão fica como etapa, o histórico não é apagado */
export function registrarReversao(documentoId: string, campo: string, motivo: string): void {
  const dados = carregar(documentoId);
  if (!dados[campo]) return;
  const agora = new Date().toISOString();
  dados[campo].reversoes += 1;
  dados[campo].atualizado_em = agora;
  dados[campo].etapas.push({
    fase:       'reversao',
    metodo:     'reversao_manual',
    valor:      dados[campo].valor_final,
    confianca:  null,
    timestamp:  agora,
    descricao:  `Reversão registrada: ${motivo}`,
    confirmado: false,
  });
  salvar(documentoId, dados);
}

/** Obtém a linhagem completa de um campo */
export function obterLinhagem(documentoId: string, campo: string): LinhagemdeCampo | null {
  return carregar(documentoId)[campo] ?? null;
}

/** Obtém a linhagem de todos os campos de um documento */
export function obterLinhagemDocumento(documentoId: string): LinhagemDoc {
  return carregar(documentoId);
}

/**
 * Rastreia um campo desde a origem até o valor final — saída legível por humano.
 * Responde: "Como chegamos a este valor?"
 */
export function rastrearCampo(documentoId: string, campo: string): string {
  const linhagem = obterLinhagem(documentoId, campo);
  if (!linhagem) return `Campo "${campo}" não possui linhagem registrada para o documento ${documentoId}.`;

  const linhas: string[] = [
    `══ LINHAGEM: ${campo}`,
    `   Documento : ${documentoId}`,
    `   Valor final: ${linhagem.valor_final ?? '(nulo)'}`,
    `   Confiança  : ${linhagem.confianca_final != null ? linhagem.confianca_final + '%' : '—'}`,
    `   Método vencedor: ${linhagem.metodo_vencedor ?? '(desconhecido)'}`,
    `   Confirmado por: ${linhagem.confirmado_por.join(', ') || '(nenhum)'}`,
    `   Reversões: ${linhagem.reversoes}`,
    '',
    `   Etapas (${linhagem.etapas.length}):`,
  ];

  linhagem.etapas.forEach((etapa, i) => {
    linhas.push(
      `   ${String(i + 1).padStart(2, '0')}. [${etapa.fase}] ${etapa.descricao}`,
      `       Método: ${etapa.metodo} | Valor: ${etapa.valor ?? '(nulo)'} | Confiança: ${etapa.confianca != null ? etapa.confianca + '%' : '—'} | Confirmado: ${etapa.confirmado ? 'Sim' : 'Não'}`,
      `       Timestamp: ${etapa.timestamp}`,
    );
  });

  return linhas.join('\n');
}

/**
 * Registra automaticamente a linhagem dos campos resultantes da validação cruzada (Fase 9).
 * Recebe o array de comparação do ValidacaoCruzadaResult.
 */
export function registrarLinhagemValidacaoCruzada(
  documentoId: string,
  comparacao: Array<{
    campo:             string;
    metodo_a:          { valor: string | null; confianca: number; metodo: string };
    metodo_b:          { valor: string | null; confianca: number; metodo: string };
    tipo_concordancia: string;
    resultado_final:   { valor: string | null; confianca: number; metodo_vencedor: string };
    explicacao:        string;
  }>,
): void {
  for (const c of comparacao) {
    const concordou = c.tipo_concordancia === 'CONCORDANCIA_TOTAL' || c.tipo_concordancia === 'CONCORDANCIA_FUNCIONAL';

    // Etapa A — extração estrutural
    registrarEtapaLinhagem(documentoId, c.campo, {
      fase:       'fase_9_metodo_a',
      metodo:     c.metodo_a.metodo,
      valor:      c.metodo_a.valor,
      confianca:  c.metodo_a.confianca,
      descricao:  `Método A (Estrutural): ${c.metodo_a.valor ?? '(nulo)'} — ${c.metodo_a.confianca}% confiança`,
      confirmado: concordou,
    }, c.resultado_final.valor, c.resultado_final.confianca);

    // Etapa B — extração semântica
    registrarEtapaLinhagem(documentoId, c.campo, {
      fase:       'fase_9_metodo_b',
      metodo:     c.metodo_b.metodo,
      valor:      c.metodo_b.valor,
      confianca:  c.metodo_b.confianca,
      descricao:  `Método B (Semântico): ${c.metodo_b.valor ?? '(nulo)'} — ${c.metodo_b.confianca}% confiança`,
      confirmado: concordou,
    }, c.resultado_final.valor, c.resultado_final.confianca, c.resultado_final.metodo_vencedor);

    // Etapa de resolução (só quando há conflito)
    if (!concordou) {
      registrarEtapaLinhagem(documentoId, c.campo, {
        fase:       'fase_9_resolucao',
        metodo:     `resolucao_${c.tipo_concordancia.toLowerCase()}`,
        valor:      c.resultado_final.valor,
        confianca:  c.resultado_final.confianca,
        descricao:  c.explicacao,
        confirmado: true,
      }, c.resultado_final.valor, c.resultado_final.confianca, c.resultado_final.metodo_vencedor);
    }

    if (concordou) {
      confirmarLinhagem(documentoId, c.campo, 'metodo_a');
      confirmarLinhagem(documentoId, c.campo, 'metodo_b');
    }
  }
}

/**
 * Registra a etapa de confirmação humana na linhagem de um campo.
 */
export function registrarLinhageCorrecaoHumana(
  documentoId: string,
  campo:       string,
  valorAntigo: string | null,
  valorNovo:   string | null,
  usuarioId:   string,
): void {
  registrarEtapaLinhagem(documentoId, campo, {
    fase:       'correcao_humana',
    metodo:     'correcao_manual_usuario',
    valor:      valorNovo,
    confianca:  100,
    descricao:  `Usuário "${usuarioId}" corrigiu "${valorAntigo ?? '(nulo)'}" → "${valorNovo ?? '(nulo)'}"`,
    confirmado: true,
  }, valorNovo, 100, 'HUMANO');
  confirmarLinhagem(documentoId, campo, usuarioId);
}

/**
 * Exporta a linhagem de todos os campos em formato JSON para relatório.
 */
export function exportarLinhagemCompleta(documentoId: string): {
  documento_id:   string;
  total_campos:   number;
  campos:         LinhagemdeCampo[];
  gerado_em:      string;
} {
  const dados  = carregar(documentoId);
  return {
    documento_id: documentoId,
    total_campos: Object.keys(dados).length,
    campos:       Object.values(dados),
    gerado_em:    new Date().toISOString(),
  };
}
