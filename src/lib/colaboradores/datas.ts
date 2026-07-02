/**
 * Soma meses a uma data ISO (yyyy-mm-dd) — usado pelos atalhos +6 meses/+1 ano/
 * +2 anos do wizard. Determinístico via Date.UTC (mesma filosofia de parseDateBR:
 * nunca depende do fuso horário do runtime). Clampa ao último dia do mês-alvo
 * quando o dia original não existir nele (ex: 31/01 + 1 mês → 28/02, não 03/03).
 */
export function adicionarMeses(dataISO: string, meses: number): string {
  if (!dataISO) return '';
  const [y, m, d] = dataISO.split('-').map(Number);
  if (!y || !m || !d) return '';

  const indiceMesAlvo = m - 1 + meses;
  const anoAlvo   = y + Math.floor(indiceMesAlvo / 12);
  const mesAlvo0  = ((indiceMesAlvo % 12) + 12) % 12;
  const ultimoDiaMesAlvo = new Date(Date.UTC(anoAlvo, mesAlvo0 + 1, 0)).getUTCDate();
  const diaFinal  = Math.min(d, ultimoDiaMesAlvo);

  const dt = new Date(Date.UTC(anoAlvo, mesAlvo0, diaFinal));
  return dt.toISOString().split('T')[0];
}
