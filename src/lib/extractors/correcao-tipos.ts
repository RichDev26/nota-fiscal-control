/**
 * Fase 10 — Tipos do Motor de Correções e Autoaprendizado Controlado
 *
 * Define toda a taxonomia de erros, registros de correção, estrutura da base
 * de conhecimento e resultado de aprendizado. Nenhuma lógica aqui — apenas tipos.
 */

// ─── TAXONOMIA DE ERROS ──────────────────────────────────────────────────────

export type TipoErro =
  | 'ERRO_OCR'                      // caractere(s) lido(s) errado por ruído visual
  | 'ERRO_ANCORA'                   // âncora ausente, frágil ou ambígua
  | 'ERRO_FRONTEIRA'                // zona de bloco avançou ou ficou curta
  | 'ERRO_ASSOCIACAO_SECAO'         // campo atribuído à seção errada
  | 'ERRO_FORMATACAO'               // valor correto mas formato diferente
  | 'ERRO_CALCULO'                  // inconsistência matemática
  | 'ERRO_VALIDACAO_FISCAL'         // tecnicamente coerente, fiscalmente inválido
  | 'ERRO_INFERENCIA'               // campo derivado com inferência incorreta
  | 'ERRO_CLASSIFICACAO_CONFIANCA'  // score muito alto/baixo para o resultado
  | 'ERRO_EXTRACAO_PARCIAL';        // campo encontrado mas truncado ou sobreposto

export type SubtipoErro =
  | 'ocr_caractere'           // 1 ou 2 chars trocados (0↔O, l↔1, 5↔S…)
  | 'ocr_sequencia'           // trecho inteiro corrompido
  | 'ancora_ausente'          // label/marcador não foi localizado no texto
  | 'ancora_fragil'           // âncora encontrada mas contexto ambíguo
  | 'ancora_trocada'          // âncora do campo errado foi ativada
  | 'fronteira_avancada'      // bloco foi longe demais, capturou dado da próxima seção
  | 'fronteira_curta'         // bloco parou cedo, perdeu parte do campo
  | 'secao_invertida'         // prestador ↔ tomador trocados
  | 'secao_errada'            // campo em seção completamente diferente
  | 'formatacao_moeda'        // "R$50000,00" vs "R$ 50.000,00"
  | 'formatacao_data'         // "19052026" vs "19/05/2026"
  | 'formatacao_cnpj'         // "49521060000149" vs "49.521.060/0001-49"
  | 'formatacao_percentual'   // "5" vs "5,00" vs "5%"
  | 'calculo_base_aliquota'   // base × alíquota ≠ valor ISS declarado
  | 'calculo_bruto_retencoes' // bruto − retenções ≠ líquido
  | 'regra_simples_nacional'  // alíquota incompatível com regime tributário
  | 'derivacao_invalida'      // campo derivado de campo ausente ou errado
  | 'derivacao_circular'      // derivação que depende de si mesma
  | 'confianca_superestimada' // conf ≥ 90 mas valor errado
  | 'confianca_subestimada'   // conf ≤ 40 mas valor era correto
  | 'campo_truncado'          // extração cortou o valor pela metade
  | 'campo_sobreposto';       // dois campos capturaram o mesmo texto

export type SeveridadeErro = 'BAIXA' | 'MEDIA' | 'ALTA' | 'CRITICA';

export type StatusCorrecao =
  | 'PENDENTE'    // registrada, aguardando validação
  | 'VALIDADA'    // aceita para aprendizado
  | 'REJEITADA'   // recusada (formato inválido, suspeita, etc.)
  | 'CONGELADA';  // contradição detectada — aguarda revisão humana

export type OrigemErro =
  | 'METODO_A'      // erro exclusivo do Método A (estrutural)
  | 'METODO_B'      // erro exclusivo do Método B (semântico)
  | 'AMBOS'         // ambos erraram da mesma forma
  | 'DERIVADO'      // campo derivado que herdou o erro
  | 'DESCONHECIDO'; // não foi possível determinar a origem

export type NivelAprendizado =
  | 'MEMORIA'             // Nível 1: apenas registra
  | 'HEURISTICA'          // Nível 2: ajusta confiança do campo
  | 'CONFIANCA'           // Nível 3: ajusta score de seção
  | 'PADRAO_CONSOLIDADO'; // Nível 4: promove padrão para produção

// ─── REGISTRO DE CORREÇÃO ────────────────────────────────────────────────────

export interface RegistroCorrecao {
  id:                    string;
  documento_id:          string;
  campo:                 string;
  secao:                 string;
  valor_extraido:        string | null;
  valor_corrigido:       string | null;
  tipo_erro:             TipoErro;
  subtipo_erro:          SubtipoErro | null;
  origem_erro:           OrigemErro;
  confianca_original:    number;
  correcao_humana:       boolean;
  timestamp:             string;
  observacao:            string | null;
  // Contexto das fases anteriores
  score_fase8:           number | null;
  concordancia_fase9:    string | null;
  metodo_vencedor_fase9: 'A' | 'B' | 'AMBOS' | 'NENHUM' | null;
  severidade:            SeveridadeErro;
  aceita_para_aprendizado: boolean;
  status:                StatusCorrecao;
  motivo_rejeicao:       string | null;
}

export interface EntradaCorrecao {
  documento_id:          string;
  campo:                 string;
  secao:                 string;
  valor_extraido:        string | null;
  valor_corrigido:       string | null;
  correcao_humana:       boolean;
  observacao?:           string;
  confianca_original?:   number;
  score_fase8?:          number;
  concordancia_fase9?:   string;
  metodo_vencedor_fase9?: 'A' | 'B' | 'AMBOS' | 'NENHUM';
}

export interface ClassificacaoErro {
  tipo:          TipoErro;
  subtipo:       SubtipoErro | null;
  severidade:    SeveridadeErro;
  origem:        OrigemErro;
  justificativa: string;
}

// ─── BASE DE CONHECIMENTO ────────────────────────────────────────────────────

export interface AjusteAncora {
  campo:                   string;
  padrao_original:         string;
  padroes_alternativos:    string[];
  confianca_historica:     number;   // 0–100, começa no valor base da fase
  erros_registrados:       number;
  correcoes_validadas:     number;
  congelado:               boolean;
  ultima_atualizacao:      string;
  notas:                   string;
}

export interface AjusteHeuristica {
  campo:                   string;
  secao:                   string;
  delta_confianca:         number;   // –20 a +20; aplicado sobre o score base
  correcoes_validadas:     number;
  correcoes_rejeitadas:    number;
  padrao_erro_frequente:   string | null;
  nivel_aprendizado:       NivelAprendizado;
  ultima_atualizacao:      string;
}

export interface AjusteFronteira {
  secao:                     string;
  ancora_inicio_alternativa: string | null;
  ancora_fim_alternativa:    string | null;
  casos_erro:                number;
  casos_correcao:            number;
  congelado:                 boolean;
  ultima_atualizacao:        string;
}

export interface PadraoConsolidado {
  id:                    string;
  campo:                 string;
  tipo:                  'regex' | 'ancora' | 'normalizacao' | 'derivacao';
  padrao:                string;
  descricao:             string;
  evidencias:            number;
  validado_por_humano:   boolean;
  timestamp_promovido:   string;
  reversivel:            boolean;
  versao:                string;
}

export interface HistoricoVersao {
  versao:         string;
  timestamp:      string;
  alteracoes:     string[];
  revertido:      boolean;
  responsavel:    'SISTEMA' | 'HUMANO';
  hash_estado:    string;  // SHA-like checksum for state verification
}

export interface BaseConhecimento {
  versao:                         string;
  timestamp_criacao:              string;
  timestamp_atualizacao:          string;
  total_correcoes_processadas:    number;
  ancoras:                        Record<string, AjusteAncora>;
  heuristicas:                    Record<string, AjusteHeuristica>;
  fronteiras:                     Record<string, AjusteFronteira>;
  padroes_consolidados:           PadraoConsolidado[];
  historico_versoes:              HistoricoVersao[];
  campos_congelados:              string[];  // proibidos de aprender automaticamente
  // Métricas
  metricas: {
    total_aceitas:          number;
    total_rejeitadas:       number;
    total_congeladas:       number;
    padroes_promovidos:     number;
    reversoes:              number;
  };
}

// ─── VALIDAÇÃO DE CORREÇÃO ───────────────────────────────────────────────────

export interface ValidacaoCorrecao {
  aceita:                    boolean;
  nivel_confianca_correcao:  number;   // 0–100: quão confiável é esta correção
  motivos_rejeicao:          string[];
  alertas:                   string[];
  requer_revisao_humana:     boolean;
  deve_congelar:             boolean;
}

// ─── RESULTADO DO APRENDIZADO ────────────────────────────────────────────────

export interface ResultadoAprendizado {
  correcoes_processadas:   number;
  correcoes_aceitas:       number;
  correcoes_rejeitadas:    number;
  correcoes_congeladas:    number;
  heuristicas_afetadas:    string[];
  ancoras_afetadas:        string[];
  fronteiras_afetadas:     string[];
  padroes_promovidos:      string[];
  campos_congelados:       string[];
  confianca_ajustada:      boolean;
  base_atualizada:         boolean;
  alertas:                 string[];
}

// ─── RESULTADO DO REPROCESSAMENTO ────────────────────────────────────────────

export interface ResultadoReprocessamento {
  documento_id:             string;
  timestamp:                string;
  score_antes:              number;
  score_depois:             number;
  delta_score:              number;
  campos_recalculados:      string[];
  campos_melhorados:        string[];
  campos_piorados:          string[];
  versao_base_usada:        string;
  divergencias_resolvidas:  string[];
  divergencias_novas:       string[];
  historico_preservado:     boolean;
  reprocessamento_ms:       number;
}

// ─── SAÍDA CONSOLIDADA DA FASE 10 ───────────────────────────────────────────

export interface ResultadoFase10 {
  correcoes:       Pick<RegistroCorrecao, 'documento_id'|'campo'|'valor_extraido'|
                        'valor_corrigido'|'tipo_erro'|'subtipo_erro'|'aceita_para_aprendizado'>[];
  aprendizado:     Pick<ResultadoAprendizado, 'heuristicas_afetadas'|'ancoras_afetadas'|
                        'fronteiras_afetadas'|'confianca_ajustada'>;
  reprocessamento: {
    necessario:          boolean;
    campos_recalculados: string[];
    score_novo:          number;
  };
}
