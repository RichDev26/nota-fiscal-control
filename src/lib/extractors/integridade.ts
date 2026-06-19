/**
 * Fase 11 — Integridade e Proteção da Trilha de Auditoria
 *
 * Garante que eventos auditáveis não possam ser adulterados silenciosamente.
 *
 * MECANISMOS:
 *   - Hash djb2 por evento (calculado no momento do registro, imutável)
 *   - Verificação de hash individual e em lote
 *   - Detecção de lacunas temporais suspeitas
 *   - Relatório de integridade da trilha completa
 *   - "Lacre" de objetos antes da persistência
 *
 * Para produção com requisitos maiores, trocar djb2 por sha256 (Node crypto).
 */

// ─── HASH DE INTEGRIDADE ─────────────────────────────────────────────────────

/**
 * Hash djb2 determinístico — suficiente para detectar adulteração acidental.
 * Chaves do objeto são ordenadas alfabeticamente para garantir determinismo.
 */
export function calcularHash(obj: unknown): string {
  const str = JSON.stringify(obj, (_, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort());
    }
    return v;
  });
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Verifica se o hash de um evento bate com seu conteúdo */
export function verificarIntegridade(
  evento: { hash: string; [key: string]: unknown },
): boolean {
  const { hash, ...semHash } = evento;
  return calcularHash(semHash) === hash;
}

/** Lacra um objeto adicionando hash de integridade */
export function lacrar<T extends object>(obj: T): T & { hash: string } {
  return { ...obj, hash: calcularHash(obj) };
}

// ─── VERIFICAÇÃO EM LOTE ─────────────────────────────────────────────────────

export interface ProblemaIntegridade {
  evento_id:  string;
  motivo:     string;
  hash_atual: string;
  hash_calc:  string;
}

/**
 * Verifica uma lista de eventos em busca de hashes inválidos.
 * Retorna lista de IDs com problemas detectados.
 */
export function verificarIntegridadeEventos(
  eventos: Array<Record<string, unknown> & { evento_id: string; hash: string }>,
): ProblemaIntegridade[] {
  const problemas: ProblemaIntegridade[] = [];

  for (const evento of eventos) {
    const { hash, ...semHash } = evento;
    const calculado = calcularHash(semHash);
    if (calculado !== hash) {
      problemas.push({
        evento_id:  evento.evento_id,
        motivo:     'Hash diverge — evento pode ter sido modificado após registro',
        hash_atual: hash,
        hash_calc:  calculado,
      });
    }
  }

  return problemas;
}

// ─── LACUNAS TEMPORAIS ────────────────────────────────────────────────────────

export interface LacunaTemporal {
  entre_eventos: [string, string];
  gap_minutos:   number;
  severidade:    'SUSPEITA' | 'INCOMUM';
}

/**
 * Detecta lacunas anômalas na sequência de eventos de alta severidade.
 * Uma lacuna > limiarMinutos entre eventos críticos pode indicar supressão.
 */
export function detectarLacunasTemporais(
  eventos: Array<Record<string, unknown> & { evento_id: string; timestamp: string; severidade: string }>,
  limiarMinutos: number = 60,
): LacunaTemporal[] {
  const lacunas: LacunaTemporal[] = [];
  const relevantes = eventos.filter(e => e.severidade === 'alta' || e.severidade === 'critica');

  for (let i = 1; i < relevantes.length; i++) {
    const t0    = new Date(relevantes[i - 1].timestamp).getTime();
    const t1    = new Date(relevantes[i].timestamp).getTime();
    const gap   = (t1 - t0) / 1000 / 60;
    if (gap > limiarMinutos) {
      lacunas.push({
        entre_eventos: [relevantes[i - 1].evento_id, relevantes[i].evento_id],
        gap_minutos:   Math.round(gap),
        severidade:    gap > 480 ? 'SUSPEITA' : 'INCOMUM',
      });
    }
  }

  return lacunas;
}

// ─── RELATÓRIO DE INTEGRIDADE ────────────────────────────────────────────────

export interface RelatorioIntegridade {
  total_eventos:       number;
  eventos_validos:     number;
  eventos_corrompidos: number;
  lacunas_detectadas:  number;
  problemas:           ProblemaIntegridade[];
  lacunas:             LacunaTemporal[];
  aprovado:            boolean;
  gerado_em:           string;
}

export function relatorioIntegridade(
  eventos: Array<Record<string, unknown> & { evento_id: string; hash: string; timestamp: string; severidade: string }>,
): RelatorioIntegridade {
  const problemas = verificarIntegridadeEventos(eventos);
  const lacunas   = detectarLacunasTemporais(eventos);

  return {
    total_eventos:       eventos.length,
    eventos_validos:     eventos.length - problemas.length,
    eventos_corrompidos: problemas.length,
    lacunas_detectadas:  lacunas.length,
    problemas,
    lacunas,
    aprovado:            problemas.length === 0,
    gerado_em:           new Date().toISOString(),
  };
}
