/**
 * Hook oficial do Next.js — register() roda UMA VEZ quando o servidor sobe.
 * É o ponto de entrada do processo em background do Controle de Integração.
 *
 * Por que não reaproveitar a fila JobFila (Fase 12)?
 *   - Ela nunca foi conectada em produção (nenhum Worker é iniciado hoje).
 *   - TipoJob é um union fechado e semanticamente amarrado à extração de PDFs
 *     (payload com documentoId/arquivoHash); forçar notificações de vencimento
 *     nela seria reuso artificial, não genuíno, e arriscaria a Fase 12.
 *
 * Por que um sweep periódico via HTTP interno, em vez de chamar o sweep direto?
 *   - instrumentation.ts é compilado num bundle restrito (compatível com Edge)
 *     que não resolve módulos nativos do Node (crypto, path...) usados pelo
 *     nodemailer — importar a cadeia de notificações aqui quebra o build.
 *   - Uma rota de API comum (/api/colaboradores/sweep) já roda com bundling
 *     completo de Node neste projeto (mesmo padrão de /api/pdf-extract com
 *     pdf-parse), então o trabalho pesado mora lá; este arquivo só dispara
 *     a chamada HTTP num timer.
 *
 * Por que um sweep periódico em vez de um novo sistema de fila?
 *   - O deploy roda `next start` — um processo Node persistente no Railway
 *     (não serverless) — então um setInterval no boot é confiável aqui.
 *   - Eventos são baseados em DIA (2 meses/1 mês/15/3/0 dias), não em minutos:
 *     checar a cada hora tem folga de sobra sem custo perceptível.
 *   - A garantia de não-duplicação vem da constraint única no banco
 *     (NotificacaoDocumento.documentoColaboradorId+marco), não da cadência do
 *     sweep — então esse desenho já é seguro mesmo se o app rodar em múltiplas
 *     instâncias no futuro (cada instância tenta enviar; a segunda esbarra na
 *     constraint única e trata como "já enviado").
 */
export const runtime = 'nodejs';

const INTERVALO_MS = Number(process.env.INTEGRACAO_SWEEP_INTERVALO_MS) || 60 * 60 * 1000; // 1h

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return; // evita rodar em edge/build

  const porta   = process.env.PORT || '3000';
  const baseUrl = `http://127.0.0.1:${porta}`;

  const tick = async () => {
    try {
      const r = await fetch(`${baseUrl}/api/colaboradores/sweep`, {
        method:  'POST',
        headers: process.env.SWEEP_SECRET ? { 'x-sweep-secret': process.env.SWEEP_SECRET } : {},
      });
      if (!r.ok) console.error(`[colaboradores.scheduler] sweep retornou status ${r.status}`);
    } catch (err) {
      console.error('[colaboradores.scheduler] falha ao disparar sweep de notificações', err);
    }
  };

  console.log(`[colaboradores.scheduler] iniciado (intervalo: ${INTERVALO_MS / 60000}min)`);
  // Pequeno atraso no primeiro tick — dá tempo do servidor HTTP terminar de subir
  // antes do primeiro fetch para si mesmo.
  setTimeout(tick, 5_000);
  setInterval(tick, INTERVALO_MS);
}
