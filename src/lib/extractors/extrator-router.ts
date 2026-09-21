/**
 * Router de Extração — ponto de entrada único e centralizado.
 *
 * Identifica o tipo do documento (detector por múltiplas evidências) e o encaminha
 * para o pipeline correto, mantendo UMA ÚNICA arquitetura de extração:
 *   - DANFE (NF-e mercadorias) → pipeline DANFE especializado
 *   - NFS-e DANFSe v2.0         → parser v2.0 (blocos IBS/CBS)
 *   - NFS-e DANFSe v1.0         → parser nacional v1.0
 *   - NFS-e / desconhecido      → pipeline existente (integrador), INALTERADO
 *
 * Preserva integralmente o comportamento de NFS-e: quando não é DANFE com
 * confiança suficiente, chama extractFromPdfBuffer exatamente como antes.
 * Novos tipos (CT-e, boleto, recibo…) entram só adicionando evidências no
 * detector + um pipeline próprio, sem tocar nos existentes.
 */
import pdfParse from 'pdf-parse';
import type { PdfExtractResult } from '@/types';
import { extractFromPdfBuffer, NotaCanceladaError, verificarNotaCancelada, validarDocumentosFiscais, alertarRetencoesSimples, validarFatoGerador } from './integrador';
import { detectarTipoDocumento, detectarLayoutNfse } from './detector-documento';
import { extrairDanfeDeTexto } from './extrator-danfe';
import { extrairDanfseNacional } from './extrator-danfse-nacional';
import { extrairDanfseV2 } from './extrator-danfse-v2';
import { extrairTextoComLacunas } from './pdf-texto';

export { NotaCanceladaError };

export interface ExtracaoRoteada extends PdfExtractResult {
  _roteamento?: {
    tipo:       string;
    scoreDanfe: number;
    scoreNfse:  number;
    evidencias: { danfe: string[]; nfse: string[] };
  };
}

export async function extractDocumentFromPdfBuffer(pdfBuffer: Buffer): Promise<ExtracaoRoteada> {
  // Parse único para a detecção. (Para NFS-e, o pipeline legado re-parseia por
  // conta própria — custo mínimo em troca de zero alteração no motor de serviços.)
  const parsed   = await pdfParse(pdfBuffer);
  const deteccao = detectarTipoDocumento(parsed.text);

  if (deteccao.rota === 'DANFE') {
    const res = extrairDanfeDeTexto(parsed.text);
    return { ...res, _roteamento: { tipo: deteccao.tipo, scoreDanfe: deteccao.scoreDanfe, scoreNfse: deteccao.scoreNfse, evidencias: deteccao.evidencias } };
  }

  // NFS-e / desconhecido → detectar layout interno
  const layoutNfse = detectarLayoutNfse(parsed.text);

  if (layoutNfse === 'DANFSE_V2') {
    // O v2.0 é o único layout que precisa da extração com recuperação de
    // espaços: o PDF não grava caractere de espaço, e sem isso nome, endereço e
    // descrição saem grudados ("JMINOXMANUTENCAOINDUSTRIALLTDA"). Reparse
    // localizado, só neste ramo — os demais layouts seguem com o texto padrão,
    // byte a byte igual ao de antes.
    const textoV2 = await extrairTextoComLacunas(pdfBuffer);
    let res = extrairDanfseV2(textoV2);
    verificarNotaCancelada(res);          // mesmas validações dos outros layouts
    res = validarDocumentosFiscais(res);
    res = alertarRetencoesSimples(res);
    res = validarFatoGerador(res);
    return { ...res, _roteamento: { tipo: 'DANFSE_V2', scoreDanfe: deteccao.scoreDanfe, scoreNfse: deteccao.scoreNfse, evidencias: deteccao.evidencias } };
  }

  if (layoutNfse === 'DANFSE_NACIONAL') {
    let res = extrairDanfseNacional(parsed.text);
    verificarNotaCancelada(res);          // lança NotaCanceladaError se cancelada
    res = validarDocumentosFiscais(res);
    res = alertarRetencoesSimples(res);
    res = validarFatoGerador(res);
    return { ...res, _roteamento: { tipo: 'DANFSE_NACIONAL', scoreDanfe: deteccao.scoreDanfe, scoreNfse: deteccao.scoreNfse, evidencias: deteccao.evidencias } };
  }

  // NFS-e municipal / desconhecido → pipeline existente, sem qualquer modificação.
  const res = await extractFromPdfBuffer(pdfBuffer);
  return { ...res, _roteamento: { tipo: deteccao.tipo, scoreDanfe: deteccao.scoreDanfe, scoreNfse: deteccao.scoreNfse, evidencias: deteccao.evidencias } };
}
