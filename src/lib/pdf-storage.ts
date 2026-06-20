/**
 * Armazenamento de PDFs no sistema de arquivos.
 *
 * Em produção (Railway) configure PDF_STORAGE_PATH apontando para um Volume montado
 * (ex: /data/pdfs) — assim os arquivos sobrevivem entre deploys.
 * Em desenvolvimento usa <cwd>/tmp/pdfs (criado automaticamente).
 *
 * Fluxo:
 *   1. Extração: savePdf(buffer, tempId)  →  /pdfs/temp-{uuid}.pdf
 *   2. Salvar nota: movePdf(tempId, notaId)  →  /pdfs/{notaId}.pdf
 *   3. Servir:  getPdf(notaId)
 */

import fs   from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const STORAGE_DIR: string = (() => {
  if (process.env.PDF_STORAGE_PATH) return process.env.PDF_STORAGE_PATH;
  if (process.env.NODE_ENV === 'production') return '/data/pdfs';
  return path.join(process.cwd(), 'tmp', 'pdfs');
})();

function ensureDir(): void {
  if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

function filePath(id: string): string {
  return path.join(STORAGE_DIR, `${id}.pdf`);
}

export function generateTempId(): string {
  return `temp-${randomUUID()}`;
}

export function savePdf(buffer: Buffer, id: string): void {
  ensureDir();
  fs.writeFileSync(filePath(id), buffer);
}

export function getPdf(id: string): Buffer | null {
  const p = filePath(id);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p);
}

export function movePdf(fromId: string, toId: string): boolean {
  const from = filePath(fromId);
  const to   = filePath(toId);
  if (!fs.existsSync(from)) return false;
  ensureDir();
  fs.renameSync(from, to);
  return true;
}

export function deletePdf(id: string): void {
  const p = filePath(id);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
