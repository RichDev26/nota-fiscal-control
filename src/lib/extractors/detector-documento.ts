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

export type LayoutNfse = 'DANFSE_V2' | 'DANFSE_NACIONAL' | 'MUNICIPAL';

/**
 * Evidências do DANFSe v2.0 (layout com blocos IBS/CBS da reforma tributária).
 *
 * Duas particularidades guiaram estas regexes:
 *
 * 1. `\s*` entre as palavras. O PDF do v2.0 costuma sair do pdf-parse com os
 *    espaços colapsados ("documentoauxiliardanfs-e"). Sem o `\s*` nenhuma
 *    evidência casaria e o documento cairia no pipeline municipal — foi
 *    exatamente o que acontecia antes deste detector existir.
 *
 * 2. Os sinais fortes são os EXCLUSIVOS do v2.0: o bloco IBS/CBS, `cClassTrib`
 *    e os rótulos "PRESTADOR / FORNECEDOR" e "TOMADOR / ADQUIRENTE" (o v1.0 usa
 *    "EMITENTE DA NFS-e" e "TOMADOR DO SERVIÇO"). Rótulos comuns aos dois
 *    layouts entram com peso baixo, para confirmar — nunca para decidir
 *    sozinhos.
 */
const EV_DANFSE_V2: Evidencia[] = [
  { re: /danfse\s*v\s*2\.0/,                              peso: 50, nome: 'DANFSe v2.0' },
  { re: /tributacao\s*ibs\s*\/?\s*cbs/,                   peso: 35, nome: 'Tributação IBS/CBS' },
  { re: /cclasstrib/,                                     peso: 25, nome: 'cClassTrib' },
  { re: /prestador\s*\/\s*fornecedor/,                    peso: 25, nome: 'Prestador / Fornecedor' },
  { re: /tomador\s*\/\s*adquirente/,                      peso: 25, nome: 'Tomador / Adquirente' },
  { re: /tributacao\s*federal\s*\(?\s*exceto\s*cbs/,      peso: 20, nome: 'Tributação Federal (exceto CBS)' },
  { re: /valor\s*liquido\s*da\s*nfs-?e\s*\+\s*ibs\s*\/?\s*cbs/, peso: 20, nome: 'Valor Líquido + IBS/CBS' },
  { re: /indicador\s*municipal\s*\(\s*inscricao/,         peso: 15, nome: 'Indicador Municipal (Inscrição)' },
  { re: /codigo\s*ibge\s*\/\s*cep/,                       peso: 15, nome: 'Código IBGE / CEP' },
  // Comuns ao v1.0 — só confirmam.
  { re: /documento\s*auxiliar\s*da\s*nfs-?e/,             peso: 10, nome: 'Documento Auxiliar da NFS-e' },
  { re: /chave\s*de\s*acesso\s*da\s*nfs-?e/,              peso: 10, nome: 'Chave de Acesso da NFS-e' },
  { re: /competencia\s*da\s*nfs-?e/,                      peso: 10, nome: 'Competência da NFS-e' },
  { re: /numero\s*da\s*dps/,                              peso: 10, nome: 'Número da DPS' },
  { re: /serie\s*da\s*dps/,                               peso: 10, nome: 'Série da DPS' },
];

/**
 * Limiar alto de propósito: exige várias evidências independentes, de modo que
 * nenhum documento entre no parser v2.0 só por conter "NFS-e" ou "DANFSe".
 */
const LIMIAR_DANFSE_V2 = 110;

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

/** Diagnóstico da escolha de layout — usado pelo roteador e pelos testes. */
export interface DeteccaoLayoutNfse {
  layout:      LayoutNfse;
  scoreV2:     number;
  scoreV1:     number;
  evidenciasV2: string[];
  evidenciasV1: string[];
}

/**
 * Detecta o layout interno de uma NFS-e já confirmada pelo roteador.
 *
 * O v2.0 é testado ANTES do v1.0 porque o v2.0 também contém os rótulos
 * genéricos do v1.0 ("DANFSe", "Chave de Acesso da NFS-e"…) — invertendo a
 * ordem, todo v2.0 seria classificado como v1.0 e extraído pelo parser errado.
 */
export function detectarLayoutNfseDetalhado(rawText: string): DeteccaoLayoutNfse {
  const texto = stripAccents(rawText).toLowerCase();
  const v2 = pontuar(texto, EV_DANFSE_V2);
  const v1 = pontuar(texto, EV_DANFSE_NAC);

  const layout: LayoutNfse =
    v2.score >= LIMIAR_DANFSE_V2  ? 'DANFSE_V2'
    : v1.score >= LIMIAR_DANFSE_NAC ? 'DANFSE_NACIONAL'
    : 'MUNICIPAL';

  return { layout, scoreV2: v2.score, scoreV1: v1.score, evidenciasV2: v2.achadas, evidenciasV1: v1.achadas };
}

export function detectarLayoutNfse(rawText: string): LayoutNfse {
  return detectarLayoutNfseDetalhado(rawText).layout;
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
