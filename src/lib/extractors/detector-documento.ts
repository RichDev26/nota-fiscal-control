/**
 * Detector de Tipo de Documento — roteia o PDF para o pipeline correto.
 *
 * Decisão centralizada e por MÚLTIPLAS EVIDÊNCIAS (não uma regex isolada):
 * cada tipo acumula um score a partir de características estruturais do texto.
 * Projetado para ser estendido (CT-e, MDF-e, boleto, recibo…) só acrescentando
 * um conjunto de evidências — sem tocar nos pipelines existentes.
 *
 * IMPORTANTE: quando não há confiança suficiente de DANFE, o documento é tratado
 * como NFS-e (comportamento legado) — isso garante que nada que já funcionava
 * seja re-roteado por engano.
 */
import { stripAccents } from './ocr-normalizer';

export type TipoDocumento = 'NFSE' | 'DANFE' | 'DESCONHECIDO';

export interface Evidencia { re: RegExp; peso: number; nome: string }

export interface DeteccaoResult {
  tipo:        TipoDocumento;
  rota:        'NFSE' | 'DANFE';   // pipeline efetivo (DESCONHECIDO cai em NFSE)
  scoreDanfe:  number;
  scoreNfse:   number;
  evidencias:  { danfe: string[]; nfse: string[] };
}

// Evidências estruturais da DANFE (NF-e de mercadorias).
const EV_DANFE: Evidencia[] = [
  { re: /\bdanfe\b/,                             peso: 40, nome: 'DANFE' },
  { re: /nota fiscal eletronica/,                peso: 25, nome: 'Nota Fiscal Eletrônica' },
  { re: /chave de acesso/,                       peso: 25, nome: 'Chave de Acesso' },
  { re: /dados dos produtos\s*\/?\s*servicos/,   peso: 25, nome: 'Tabela de Produtos' },
  { re: /identificacao do emitente/,             peso: 20, nome: 'Identificação do Emitente' },
  { re: /destinatario\s*\/?\s*remetente/,        peso: 15, nome: 'Destinatário/Remetente' },
  { re: /natureza da operacao/,                  peso: 10, nome: 'Natureza da Operação' },
  { re: /\bnf-?e\b/,                             peso: 10, nome: 'NF-e' },
  { re: /\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}/, peso: 20, nome: 'Chave 44 dígitos' },
];

// Evidências estruturais da NFS-e (nota de serviço).
const EV_NFSE: Evidencia[] = [
  { re: /nfs-?e/,                        peso: 30, nome: 'NFS-e' },
  { re: /\bissqn\b/,                     peso: 30, nome: 'ISSQN' },
  { re: /prestador de servicos/,         peso: 25, nome: 'Prestador de Serviços' },
  { re: /tomador de servicos/,           peso: 25, nome: 'Tomador de Serviços' },
  { re: /codigo de verificacao/,         peso: 20, nome: 'Código de Verificação' },
  { re: /discriminacao dos servicos/,    peso: 15, nome: 'Discriminação dos Serviços' },
  { re: /data do fato gerador/,          peso: 10, nome: 'Data do Fato Gerador' },
];

// Score mínimo para afirmar que é DANFE (evita falso-positivo re-roteando NFS-e).
const LIMIAR_DANFE = 60;

function pontuar(texto: string, evidencias: Evidencia[]): { score: number; achadas: string[] } {
  let score = 0;
  const achadas: string[] = [];
  for (const e of evidencias) {
    if (e.re.test(texto)) { score += e.peso; achadas.push(e.nome); }
  }
  return { score, achadas };
}

// ─── LAYOUT INTERNO DA NFS-e ──────────────────────────────────────────────────

export type LayoutNfse = 'DANFSE_NACIONAL' | 'MUNICIPAL';

const EV_DANFSE_NAC: Evidencia[] = [
  { re: /\bdanfse\b/,                                   peso: 50, nome: 'DANFSe' },
  { re: /documento auxiliar da nfs-?e/,                 peso: 25, nome: 'Documento Auxiliar da NFS-e' },
  { re: /chave de acesso da nfs-?e/,                    peso: 25, nome: 'Chave de Acesso da NFS-e' },
  { re: /competencia da nfs-?e/,                        peso: 20, nome: 'Competência da NFS-e' },
  { re: /numero da dps/,                                peso: 20, nome: 'Número da DPS' },
  { re: /serie da dps/,                                 peso: 15, nome: 'Série da DPS' },
  { re: /\b\d{50}\b/,                                   peso: 20, nome: 'Chave 50 dígitos' },
  { re: /codigo de tributacao nacional/,                peso: 15, nome: 'Código de Tributação Nacional' },
  { re: /emitente da nfs-?e/,                           peso: 10, nome: 'Emitente da NFS-e' },
];

const LIMIAR_DANFSE_NAC = 50;

/** Detecta o layout interno de uma NFS-e já confirmada pelo roteador. */
export function detectarLayoutNfse(rawText: string): LayoutNfse {
  const texto = stripAccents(rawText).toLowerCase();
  const { score } = pontuar(texto, EV_DANFSE_NAC);
  return score >= LIMIAR_DANFSE_NAC ? 'DANFSE_NACIONAL' : 'MUNICIPAL';
}

export function detectarTipoDocumento(rawText: string): DeteccaoResult {
  const texto = stripAccents(rawText).toLowerCase();

  const danfe = pontuar(texto, EV_DANFE);
  const nfse  = pontuar(texto, EV_NFSE);

  // DANFE só vence com score suficiente E maior que o de NFS-e.
  const ehDanfe = danfe.score >= LIMIAR_DANFE && danfe.score > nfse.score;

  const tipo: TipoDocumento = ehDanfe ? 'DANFE' : (nfse.score > 0 ? 'NFSE' : 'DESCONHECIDO');

  return {
    tipo,
    rota:       ehDanfe ? 'DANFE' : 'NFSE',   // desconhecido → NFS-e (legado)
    scoreDanfe: danfe.score,
    scoreNfse:  nfse.score,
    evidencias: { danfe: danfe.achadas, nfse: nfse.achadas },
  };
}
