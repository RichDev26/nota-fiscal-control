/**
 * Helpers compartilhados pelos layouts DANFSe (v1.0 e v2.0).
 *
 * Nasceram dentro de extrator-danfse-nacional.ts. Quando o layout v2.0 entrou,
 * foram movidos para cá SEM alteração de comportamento, para que exista uma
 * única implementação de cada primitiva em vez de duas cópias divergindo com o
 * tempo. O v1.0 passou a importar daqui; o v2.0 importa os mesmos.
 *
 * Nada aqui é específico de um layout: são primitivas de leitura de documento
 * no formato "label numa linha, valor na linha seguinte".
 */
import { parseNumeroBR } from '@/lib/validators';

/** Placeholder de campo ausente usado pelos DANFSe. */
export const AUSENTE = '-';

/**
 * Valor na linha imediatamente após o label. Retorna null para '-' (placeholder
 * de campo ausente) — nunca inventa valor nem busca em outra linha.
 */
export function nextVal(text: string, labelRe: RegExp): string | null {
  const re = new RegExp(labelRe.source + '[^\\n]*\\n([^\\n]+)', 'i');
  const m  = text.match(re);
  const v  = m?.[1]?.trim();
  return (!v || v === AUSENTE) ? null : v;
}

/** Primeiro valor monetário (R$ NNN,NN) na linha após o label. */
export function nextMoney(text: string, labelRe: RegExp): number | null {
  const line = nextVal(text, labelRe);
  if (!line) return null;
  const m = line.match(/R\$\s*([\d.]+,\d{2})/);
  return m ? parseNumeroBR('R$ ' + m[1]) : parseNumeroBR(line);
}

/** Fatia do texto entre dois padrões (primeira ocorrência de cada). */
export function section(text: string, from: RegExp, to: RegExp): string {
  const start = text.search(from);
  if (start === -1) return '';
  const sub = text.slice(start);
  const end = sub.search(to);
  return end === -1 ? sub : sub.slice(0, end);
}

/** "Cidade - UF" ou "Cidade - UF CEP" → { municipio, uf }. */
export function parseMuniUf(raw: string | null): { municipio?: string; uf?: string } {
  if (!raw) return {};
  const m = raw.match(/^(.+?)\s*[-–]\s*([A-Z]{2})\b/);
  return m ? { municipio: m[1].trim(), uf: m[2] } : { municipio: raw.trim() };
}

export const RE_CNPJ = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/;
export const RE_CPF  = /\d{3}\.\d{3}\.\d{3}-\d{2}/;
