/**
 * Fase 10 — Classificador Automático de Erros
 *
 * Determina TipoErro, SubtipoErro, SeveridadeErro e OrigemErro a partir
 * da comparação entre o valor extraído e o valor corrigido pelo usuário.
 * Não faz I/O — função pura.
 */

import type {
  ClassificacaoErro, EntradaCorrecao,
  TipoErro, SubtipoErro, SeveridadeErro, OrigemErro,
} from './correcao-tipos';
import { normalize } from './normalizador';
import type { NormTipo } from './normalizador';

// ─── METADADOS DE CAMPOS ─────────────────────────────────────────────────────

interface CampoMeta {
  critico:  boolean;
  derivado: boolean;
  fiscal:   boolean;
  normTipo: NormTipo;
}

const CAMPO_META: Record<string, CampoMeta> = {
  numero_nota:               { critico: true,  derivado: false, fiscal: false, normTipo: 'raw'     },
  codigo_verificacao:        { critico: true,  derivado: false, fiscal: false, normTipo: 'raw'     },
  data_emissao:              { critico: true,  derivado: false, fiscal: false, normTipo: 'date'    },
  data_fato_gerador:         { critico: false, derivado: false, fiscal: false, normTipo: 'date'    },
  'prestador.razao_social':  { critico: true,  derivado: false, fiscal: false, normTipo: 'text'    },
  'prestador.cpf_cnpj':      { critico: true,  derivado: false, fiscal: false, normTipo: 'cnpj'    },
  'prestador.municipio':     { critico: false, derivado: false, fiscal: false, normTipo: 'text'    },
  'tomador.razao_social':    { critico: true,  derivado: false, fiscal: false, normTipo: 'text'    },
  'tomador.cpf_cnpj':        { critico: true,  derivado: false, fiscal: false, normTipo: 'cnpj'    },
  'tomador.municipio':       { critico: false, derivado: false, fiscal: false, normTipo: 'text'    },
  'tomador.telefone':        { critico: false, derivado: false, fiscal: false, normTipo: 'raw'     },
  'tomador.endereco':        { critico: false, derivado: false, fiscal: false, normTipo: 'text'    },
  'servico.descricao':       { critico: false, derivado: false, fiscal: false, normTipo: 'text'    },
  'servico.valor_servico':   { critico: true,  derivado: false, fiscal: false, normTipo: 'money'   },
  valor_bruto:               { critico: true,  derivado: false, fiscal: false, normTipo: 'money'   },
  valor_liquido:             { critico: true,  derivado: false, fiscal: false, normTipo: 'money'   },
  base_calculo:              { critico: false, derivado: false, fiscal: true,  normTipo: 'money'   },
  aliquota_iss:              { critico: true,  derivado: false, fiscal: true,  normTipo: 'percent' },
  valor_iss:                 { critico: true,  derivado: false, fiscal: true,  normTipo: 'money'   },
  valor_servico_fin:         { critico: true,  derivado: true,  fiscal: false, normTipo: 'money'   },
  iss_retido:                { critico: true,  derivado: true,  fiscal: true,  normTipo: 'boolean' },
  natureza_operacao:         { critico: false, derivado: false, fiscal: true,  normTipo: 'text'    },
  situacao_issqn:            { critico: false, derivado: false, fiscal: true,  normTipo: 'text'    },
  regime_tributario:         { critico: false, derivado: false, fiscal: true,  normTipo: 'raw'     },
  valor_aproximado_tributos: { critico: false, derivado: true,  fiscal: false, normTipo: 'money'   },
};

// ─── MATRIZ DE CONFUSÃO OCR ──────────────────────────────────────────────────

const OCR_CONFUSIONS: [string, string][] = [
  ['0', 'O'], ['0', 'o'], ['1', 'l'], ['1', 'I'], ['1', '|'],
  ['5', 'S'], ['5', 's'], ['8', 'B'], ['6', 'b'], ['6', 'G'],
  ['9', 'q'], ['9', 'g'], ['2', 'Z'], ['rn', 'm'], ['cl', 'd'],
  ['li', 'h'], ['ij', 'y'], ['ri', 'n'],
];

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

function isOCRError(extracted: string, corrected: string): boolean {
  // Levenshtein distance ≤ 3 AND the diffs align with known OCR confusions
  const dist = levenshtein(extracted.toLowerCase(), corrected.toLowerCase());
  if (dist > 3) return false;
  // Check if applying confusion matrix transforms extracted → corrected
  let candidate = extracted.toLowerCase();
  for (const [from, to] of OCR_CONFUSIONS) {
    candidate = candidate.replaceAll(from, to);
  }
  if (candidate.toLowerCase() === corrected.toLowerCase()) return true;
  // Reverse direction
  candidate = corrected.toLowerCase();
  for (const [from, to] of OCR_CONFUSIONS) {
    candidate = candidate.replaceAll(from, to);
  }
  return candidate.toLowerCase() === extracted.toLowerCase();
}

function isFormatOnly(extracted: string, corrected: string, normTipo: NormTipo): boolean {
  const na = normalize(extracted, normTipo);
  const nb = normalize(corrected, normTipo);
  return na !== null && nb !== null && na === nb;
}

function isSectionSwap(campo: string, secao: string): boolean {
  // Check if field belongs to the section — if not, it's a section error
  const isPrestzSection = campo.startsWith('prestador.');
  const isTomadorSection = campo.startsWith('tomador.');
  if (isPrestzSection && secao === 'tomador') return true;
  if (isTomadorSection && secao === 'prestador') return true;
  return false;
}

function isOCRSubtype(extracted: string, corrected: string): SubtipoErro {
  const dist = levenshtein(extracted, corrected);
  return dist <= 2 ? 'ocr_caractere' : 'ocr_sequencia';
}

function isFormatSubtype(campo: string): SubtipoErro {
  const meta = CAMPO_META[campo] ?? { normTipo: 'raw' as NormTipo };
  switch (meta.normTipo) {
    case 'money':   return 'formatacao_moeda';
    case 'date':    return 'formatacao_data';
    case 'cnpj':
    case 'cpf':     return 'formatacao_cnpj';
    case 'percent': return 'formatacao_percentual';
    default:        return 'formatacao_moeda'; // generic
  }
}

function calcSeveridade(campo: string, tipo: TipoErro): SeveridadeErro {
  const meta = CAMPO_META[campo] ?? { critico: false, derivado: false, fiscal: false, normTipo: 'raw' as NormTipo };
  if (meta.critico) {
    if (tipo === 'ERRO_FORMATACAO') return 'ALTA';
    return 'CRITICA';
  }
  if (meta.fiscal) return 'ALTA';
  if (tipo === 'ERRO_OCR')        return 'MEDIA';
  if (tipo === 'ERRO_FORMATACAO') return 'BAIXA';
  return 'MEDIA';
}

function inferOrigemErro(entrada: EntradaCorrecao): OrigemErro {
  const { metodo_vencedor_fase9, concordancia_fase9 } = entrada;
  if (concordancia_fase9 === 'DIVERGENCIA_CRITICA') return 'DESCONHECIDO';
  if (metodo_vencedor_fase9 === 'A') return 'METODO_A';
  if (metodo_vencedor_fase9 === 'B') return 'METODO_B';
  if (metodo_vencedor_fase9 === 'AMBOS') return 'AMBOS';
  return 'DESCONHECIDO';
}

// ─── CLASSIFICAÇÃO PRINCIPAL ─────────────────────────────────────────────────

/**
 * Classifica automaticamente o tipo de erro de uma correção.
 * Baseado em comparação semântica dos valores, metadados do campo e contexto.
 */
export function classificarErro(entrada: EntradaCorrecao): ClassificacaoErro {
  const { campo, secao, valor_extraido: ve, valor_corrigido: vc, confianca_original } = entrada;
  const meta    = CAMPO_META[campo] ?? { critico: false, derivado: false, fiscal: false, normTipo: 'raw' as NormTipo };
  const origem  = inferOrigemErro(entrada);

  // ── Caso 1: campo ausente — âncora não encontrou nada ────────────────────
  if (ve === null && vc !== null) {
    const tipo: TipoErro      = 'ERRO_ANCORA';
    const subtipo: SubtipoErro = 'ancora_ausente';
    return {
      tipo, subtipo, severidade: calcSeveridade(campo, tipo), origem,
      justificativa: `Campo "${campo}" não foi extraído (nulo) mas possui valor correto "${vc}". A âncora falhou em localizar o campo.`,
    };
  }

  // ── Caso 2: campo extraído mas usuário diz que deveria ser nulo ──────────
  if (ve !== null && vc === null) {
    const tipo: TipoErro      = 'ERRO_EXTRACAO_PARCIAL';
    const subtipo: SubtipoErro = 'campo_sobreposto';
    return {
      tipo, subtipo, severidade: calcSeveridade(campo, tipo), origem,
      justificativa: `Campo "${campo}" foi extraído como "${ve}" mas não deveria existir. Extração capturou dado de outra seção.`,
    };
  }

  // ── Caso 3: ambos não-nulos, valores diferentes ───────────────────────────
  if (ve !== null && vc !== null) {

    // 3a. Erro de formatação (mesma semântica após normalização)
    if (isFormatOnly(ve, vc, meta.normTipo)) {
      const subtipo = isFormatSubtype(campo);
      return {
        tipo: 'ERRO_FORMATACAO', subtipo, severidade: 'BAIXA', origem,
        justificativa: `"${ve}" e "${vc}" são semanticamente iguais após normalização — apenas formato diferente (${subtipo}).`,
      };
    }

    // 3b. Erro de OCR (caracteres visualmente similares)
    if (isOCRError(ve, vc)) {
      const subtipo = isOCRSubtype(ve, vc);
      return {
        tipo: 'ERRO_OCR', subtipo, severidade: calcSeveridade(campo, 'ERRO_OCR'), origem,
        justificativa: `"${ve}" → "${vc}": distância de edição pequena com padrão de confusão OCR (0↔O, 1↔l, etc.).`,
      };
    }

    // 3c. Campo derivado com inferência errada
    if (meta.derivado) {
      const subtipo: SubtipoErro = 'derivacao_invalida';
      return {
        tipo: 'ERRO_INFERENCIA', subtipo, severidade: calcSeveridade(campo, 'ERRO_INFERENCIA'), origem,
        justificativa: `"${campo}" é derivado e foi inferido como "${ve}" mas o valor correto é "${vc}".`,
      };
    }

    // 3d. Campo fiscal com erro (regime, alíquota, situação ISSQN)
    if (meta.fiscal) {
      const subtipo: SubtipoErro = 'regra_simples_nacional';
      return {
        tipo: 'ERRO_VALIDACAO_FISCAL', subtipo, severidade: 'ALTA', origem,
        justificativa: `Campo fiscal "${campo}" extraído como "${ve}" contradiz regra fiscal — valor correto "${vc}".`,
      };
    }

    // 3e. Campo de seção trocada (prestador ↔ tomador)
    if (isSectionSwap(campo, secao)) {
      return {
        tipo: 'ERRO_ASSOCIACAO_SECAO', subtipo: 'secao_invertida',
        severidade: 'ALTA', origem,
        justificativa: `Campo "${campo}" foi atribuído à seção "${secao}" mas pertence à seção oposta.`,
      };
    }

    // 3f. Score de confiança muito alto para um valor errado
    if ((confianca_original ?? 0) >= 90) {
      return {
        tipo: 'ERRO_CLASSIFICACAO_CONFIANCA', subtipo: 'confianca_superestimada',
        severidade: 'MEDIA', origem,
        justificativa: `Confiança original ${confianca_original}% mas valor estava errado ("${ve}" → "${vc}"). Score superestimado.`,
      };
    }

    // 3g. Erro de fronteira: campo de seção adjacente capturado
    // Heurística: se o valor errado parece um rótulo ou dado de outra seção
    const pareceLabelOutroBloco = /^(Data|Endereço|Nome|Número|CEP|Bairro|QtdValor|Município)/i.test(ve);
    if (pareceLabelOutroBloco) {
      return {
        tipo: 'ERRO_FRONTEIRA', subtipo: 'fronteira_avancada', severidade: 'ALTA', origem,
        justificativa: `"${ve}" parece rótulo/dado de bloco adjacente — fronteira da seção avançou demais.`,
      };
    }

    // 3h. Default: âncora frágil (encontrou algo mas no contexto errado)
    return {
      tipo: 'ERRO_ANCORA', subtipo: 'ancora_fragil', severidade: calcSeveridade(campo, 'ERRO_ANCORA'), origem,
      justificativa: `Valor extraído "${ve}" difere do correto "${vc}". Âncora provavelmente frágil ou ambígua neste documento.`,
    };
  }

  // Caso 4: ambos nulos — sem alteração, não deveria ser uma correção
  return {
    tipo: 'ERRO_EXTRACAO_PARCIAL', subtipo: null, severidade: 'BAIXA', origem,
    justificativa: 'Valor extraído e corrigido são ambos nulos — sem alteração real.',
  };
}

/**
 * Identifica quais heurísticas e âncoras podem ser impactadas por uma correção.
 */
export function identificarImpactos(
  campo: string,
  tipo: TipoErro,
): { ancoras: string[]; heuristicas: string[]; fronteiras: string[] } {
  const ancoras: string[]    = [];
  const heuristicas: string[] = [];
  const fronteiras: string[] = [];

  switch (tipo) {
    case 'ERRO_ANCORA':
      ancoras.push(campo);
      heuristicas.push(campo);
      break;
    case 'ERRO_FRONTEIRA':
      // Fronteira da seção afetada
      if (campo.startsWith('prestador.')) { fronteiras.push('prestador'); ancoras.push(campo); }
      else if (campo.startsWith('tomador.')) { fronteiras.push('tomador'); ancoras.push(campo); }
      else if (campo.startsWith('servico.')) { fronteiras.push('servicos'); }
      else { fronteiras.push('financeiro'); }
      break;
    case 'ERRO_OCR':
      heuristicas.push(campo);
      break;
    case 'ERRO_FORMATACAO':
      heuristicas.push(campo);
      break;
    case 'ERRO_ASSOCIACAO_SECAO':
      fronteiras.push('prestador');
      fronteiras.push('tomador');
      ancoras.push(campo);
      break;
    case 'ERRO_INFERENCIA':
      heuristicas.push(campo);
      break;
    case 'ERRO_VALIDACAO_FISCAL':
      heuristicas.push(campo);
      ancoras.push(campo);
      break;
    case 'ERRO_CLASSIFICACAO_CONFIANCA':
      heuristicas.push(campo);
      break;
    case 'ERRO_EXTRACAO_PARCIAL':
      ancoras.push(campo);
      fronteiras.push(campo.split('.')[0] || 'desconhecido');
      break;
    case 'ERRO_CALCULO':
      heuristicas.push(campo);
      break;
  }

  return { ancoras, heuristicas, fronteiras };
}
