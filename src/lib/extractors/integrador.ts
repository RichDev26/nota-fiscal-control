/**
 * Integrador das Fases 1-11 → API de Produção
 *
 * Ponto de entrada único que substitui extractFromPdfBuffer do motor legado.
 * Orquestra validateCrossCheck (Fase 9) e mapeia ValidacaoCruzadaResult
 * para PdfExtractResult — o contrato esperado pelo route.ts e pelo banco.
 *
 * Validações adicionais (Partes 2-3):
 *   - Nota cancelada → lança NotaCanceladaError (route.ts retorna 422)
 *   - CNPJ/CPF → dígito verificador; inválidos adicionados a camposBaixaConfianca
 *
 * Fallback automático: se qualquer fase lançar erro, o motor legado
 * (pdf-extractor.ts) é chamado e o resultado é marcado com 'fallback-legado'.
 */

import type { PdfExtractResult } from '@/types';
import { validateCrossCheck } from './validacao-cruzada';
import type { ValidacaoCruzadaResult } from './validacao-cruzada';
import { logInfo, logError, logNegocio } from './logger';
import { validarDocumento } from '@/lib/validators/documento-fiscal';

const VERSAO_INTEGRADOR = '1.0.0';

// Campos cujo valor abaixo deste limiar de confiança geram alerta
const LIMIAR_BAIXA_CONFIANCA = 60;

// ─── ERRO ESPECIAL: NOTA CANCELADA ────────────────────────────────────────────

export class NotaCanceladaError extends Error {
  constructor(public readonly situacao: string) {
    super(`Nota fiscal cancelada ("${situacao}") — não importada. Importe a nota substituta.`);
    this.name = 'NotaCanceladaError';
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function toFloat(valor: string | null | undefined): number | undefined {
  if (!valor) return undefined;
  const n = parseFloat(valor.replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? undefined : n;
}

function toStr(valor: string | null | undefined): string | undefined {
  const s = valor?.trim();
  return s && s.length > 0 ? s : undefined;
}

// ─── MAPEAMENTO ValidacaoCruzadaResult → PdfExtractResult ────────────────────

function mapearResultado(cruzado: ValidacaoCruzadaResult): PdfExtractResult {
  const consolidado = cruzado.resultado_final_consolidado;
  const campos      = consolidado.campos;

  const get = (key: string): string | null => campos[key]?.valor ?? null;

  // Classifica campos por qualidade
  const camposBaixaConfianca: string[] = [];
  const camposNaoEncontrados: string[] = [];
  for (const [nome, info] of Object.entries(campos)) {
    if (info.valor === null || info.valor === '') {
      camposNaoEncontrados.push(nome);
    } else if (info.confianca < LIMIAR_BAIXA_CONFIANCA) {
      camposBaixaConfianca.push(nome);
    }
  }

  // Prestador
  const prestadorRaw = {
    nomeRazaoSocial:    toStr(get('prestador.razao_social')),
    nomeFantasia:       toStr(get('prestador.nome_fantasia')),
    cpfCnpj:            toStr(get('prestador.cpf_cnpj')),
    inscricaoMunicipal: toStr(get('prestador.inscricao_municipal')),
    municipio:          toStr(get('prestador.municipio')),
    uf:                 toStr(get('prestador.uf')),
    email:              toStr(get('prestador.email')),
    telefone:           toStr(get('prestador.telefone')),
    endereco:           toStr(get('prestador.endereco')),
    cep:                toStr(get('prestador.cep')),
  };
  const prestador = Object.values(prestadorRaw).some(v => v !== undefined)
    ? prestadorRaw
    : undefined;

  // Tomador
  const tomadorRaw = {
    nomeRazaoSocial:    toStr(get('tomador.razao_social')),
    nomeFantasia:       toStr(get('tomador.nome_fantasia')),
    cpfCnpj:            toStr(get('tomador.cpf_cnpj')),
    inscricaoMunicipal: toStr(get('tomador.inscricao_municipal')),
    municipio:          toStr(get('tomador.municipio')),
    uf:                 toStr(get('tomador.uf')),
    email:              toStr(get('tomador.email')),
    telefone:           toStr(get('tomador.telefone')),
    endereco:           toStr(get('tomador.endereco')),
    cep:                toStr(get('tomador.cep')),
  };
  const tomador = Object.values(tomadorRaw).some(v => v !== undefined)
    ? tomadorRaw
    : undefined;

  // ISS retido na fonte → indicacaoRetencao
  const issRetido = get('iss_retido');
  const indicacaoRetencao = issRetido === 'true'
    ? 'Retido pelo Tomador'
    : issRetido === 'false'
    ? 'Devido pelo Prestador'
    : undefined;

  // Simples Nacional a partir do regime tributário
  const regimeTrib = toStr(get('regime_tributario'));
  const simplesNacional = regimeTrib === 'SIMPLES_NACIONAL' || regimeTrib === 'MEI'
    ? true
    : undefined;

  const { taxa_concordancia, total_campos, divergencia_critica } = cruzado.estatisticas;
  const { confianca_global, revisao_obrigatoria, bloqueado, motivo_bloqueio, alertas } = consolidado;

  const partes = [
    `Motor v${VERSAO_INTEGRADOR} — Dupla extração`,
    `${total_campos} campos | concordância ${taxa_concordancia}%`,
    revisao_obrigatoria ? 'REVISÃO OBRIGATÓRIA' : 'Aprovado automaticamente',
    bloqueado && motivo_bloqueio ? `BLOQUEADO: ${motivo_bloqueio}` : null,
  ].filter(Boolean);
  const resumo = partes.join(' | ');

  return {
    tipo:                    'NFS-e',
    numeroNf:                toStr(get('numero_nota')),
    codigoVerificacao:       toStr(get('codigo_verificacao')),
    dataEmissao:             toStr(get('data_emissao')),
    dataFatoGerador:         toStr(get('data_fato_gerador')),
    municipioEmissor:        toStr(get('prestador.municipio')),
    descricao:               toStr(get('servico.descricao')),
    of:                      toStr(get('servico.of')),
    codigoServico:           toStr(get('servico.codigo_servico')),
    quantidade:              toFloat(get('servico.quantidade')),
    valorUnitario:           toFloat(get('servico.valor_unitario')),
    valorBruto:              toFloat(get('valor_bruto')),
    valorLiquido:            toFloat(get('valor_liquido')),
    baseCalculo:             toFloat(get('base_calculo')),
    aliquota:                toFloat(get('aliquota_iss')),
    valorIss:                toFloat(get('valor_iss')),
    ir:                      toFloat(get('ir')),
    pisPasep:                toFloat(get('pis_pasep')),
    cofins:                  toFloat(get('cofins')),
    inss:                    toFloat(get('inss')),
    csll:                    toFloat(get('csll')),
    outrasRetencoes:         toFloat(get('outras_retencoes')),
    valorAproximadoTributos: toFloat(get('valor_aproximado_tributos')),
    naturezaOperacao:        toStr(get('natureza_operacao')),
    situacaoTributariaIssqn: toStr(get('situacao_issqn')),
    localPrestacao:          toStr(get('local_prestacao')),
    situacaoNfse:            toStr(get('situacao_nfse')),
    regimeTributario:        regimeTrib,
    indicacaoRetencao,
    simplesNacional,
    prestador,
    tomador,
    camposBaixaConfianca:    camposBaixaConfianca.length > 0 ? camposBaixaConfianca : undefined,
    camposNaoEncontrados:    camposNaoEncontrados.length > 0 ? camposNaoEncontrados : undefined,
    inconsistencias:         alertas.length > 0 ? alertas : undefined,
    fontesExtracao:          ['fase-9-dupla-extracao'],
    resumo,
    _meta: {
      confianca_global,
      taxa_concordancia,
      divergencia_critica,
      revisao_obrigatoria,
      bloqueado,
      extractionMs: cruzado.extractionMs,
    },
  } as PdfExtractResult & { _meta: unknown };
}

// ─── VALIDAÇÃO PÓS-EXTRAÇÃO ───────────────────────────────────────────────────

/** 3.2 — Bloqueia nota cancelada antes de salvar no banco */
function verificarNotaCancelada(resultado: PdfExtractResult): void {
  const situacao = resultado.situacaoNfse;
  if (situacao && /cancelad/i.test(situacao)) {
    throw new NotaCanceladaError(situacao);
  }
}

/** 3.1 — Valida dígito verificador de CNPJ/CPF; adiciona alertas se inválido */
function validarDocumentosFiscais(resultado: PdfExtractResult): PdfExtractResult {
  const alertas: string[] = [];
  const camposBaixos = [...(resultado.camposBaixaConfianca ?? [])];

  const checar = (doc: string | null | undefined, label: string, campo: string) => {
    if (!doc) return;
    const { valido, tipo } = validarDocumento(doc);
    if (!valido) {
      alertas.push(`${tipo} do ${label} com dígito verificador inválido: ${doc} — provável erro de OCR`);
      if (!camposBaixos.includes(campo)) camposBaixos.push(campo);
    }
  };

  checar(resultado.prestador?.cpfCnpj, 'Prestador', 'prestador.cpf_cnpj');
  checar(resultado.tomador?.cpfCnpj,   'Tomador',   'tomador.cpf_cnpj');

  if (alertas.length === 0) return resultado;

  return {
    ...resultado,
    camposBaixaConfianca: camposBaixos,
    inconsistencias: [...(resultado.inconsistencias ?? []), ...alertas],
  };
}

// ─── PONTO DE ENTRADA PÚBLICO ─────────────────────────────────────────────────

export async function extractFromPdfBuffer(buffer: Buffer): Promise<PdfExtractResult> {
  const t0 = Date.now();

  try {
    logInfo('integrador', 'Iniciando extração — motor Fases 1-11');

    const cruzado   = await validateCrossCheck(buffer);
    let resultado   = mapearResultado(cruzado);

    // Validações pós-extração (bloqueiam antes de retornar ao route.ts)
    verificarNotaCancelada(resultado);
    resultado = validarDocumentosFiscais(resultado);

    logInfo('integrador', 'Extração concluída com sucesso', {
      total_campos:        cruzado.estatisticas.total_campos,
      taxa_concordancia:   cruzado.estatisticas.taxa_concordancia,
      confianca_global:    cruzado.resultado_final_consolidado.confianca_global,
      revisao_obrigatoria: cruzado.resultado_final_consolidado.revisao_obrigatoria,
      bloqueado:           cruzado.resultado_final_consolidado.bloqueado,
      duracaoMs:           Date.now() - t0,
    });

    logNegocio('EXTRACAO_PDF', 'nota_fiscal', {
      motor:               `integrador-v${VERSAO_INTEGRADOR}`,
      confianca_global:    cruzado.resultado_final_consolidado.confianca_global,
      taxa_concordancia:   cruzado.estatisticas.taxa_concordancia,
      campos_divergentes:  cruzado.estatisticas.divergencia_critica,
    });

    return resultado;

  } catch (err) {
    // NotaCanceladaError propaga sem fallback — é dado de negócio, não falha técnica
    if (err instanceof NotaCanceladaError) throw err;

    logError(
      'integrador',
      'Falha no motor Fases 1-11 — ativando fallback para motor legado',
      err as Error,
      { duracaoAteErroMs: Date.now() - t0 },
    );

    const { extractFromPdfBuffer: legado } = await import('../pdf-extractor');
    const resultadoLegado = await legado(buffer);

    // Aplica validações também no resultado do motor legado
    verificarNotaCancelada(resultadoLegado);
    const comValidacao = validarDocumentosFiscais(resultadoLegado);

    return {
      ...comValidacao,
      fontesExtracao: [...(comValidacao.fontesExtracao ?? []), 'fallback-legado'],
      resumo: [comValidacao.resumo, 'FALLBACK: motor legado (Fases 1-11 falharam)']
        .filter(Boolean)
        .join(' | '),
    };
  }
}
