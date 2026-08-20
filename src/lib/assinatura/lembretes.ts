/**
 * Sweep de lembretes de vencimento — mesmo padrão de
 * src/lib/colaboradores/notificacoes.ts. Roda periodicamente (ver
 * src/instrumentation.ts). lembreteEnviadoEm evita reenvio duplicado; é
 * resetado para null em processarPagamentoAprovado() a cada renovação, para
 * que o lembrete do PRÓXIMO ciclo também possa ser enviado.
 */
import prisma from '@/lib/prisma';
import { enviarEmail } from '@/lib/email/mailer';
import { templateAssinaturaVencendo } from '@/lib/email/templates/assinatura-vencendo';
import { logInfo, logError } from '@/lib/extractors/logger';

const JANELA_LEMBRETE_MS = 3 * 24 * 60 * 60 * 1000; // 3 dias

export interface ResultadoSweepLembretes {
  verificadas: number;
  enviados: number;
  falhas: number;
}

export async function processarLembretesVencimento(agora: Date = new Date()): Promise<ResultadoSweepLembretes> {
  const limite = new Date(agora.getTime() + JANELA_LEMBRETE_MS);

  const assinaturas = await prisma.assinatura.findMany({
    where: {
      periodoFimEm: { not: null, lte: limite, gt: agora },
      lembreteEnviadoEm: null,
      // Quem cancelou não deve receber lembrete de renovação.
      canceladaEm: null,
    },
    include: { usuario: { select: { email: true, nome: true } } },
  });

  let enviados = 0;
  let falhas = 0;

  for (const a of assinaturas) {
    if (!a.usuario?.email || !a.periodoFimEm) continue;
    try {
      const { subject, html } = templateAssinaturaVencendo({ nome: a.usuario.nome, dataVencimento: a.periodoFimEm });
      const resultado = await enviarEmail({ to: a.usuario.email, subject, html });
      if (!resultado.enviado) continue; // SMTP indisponível — tenta de novo no próximo sweep

      await prisma.assinatura.update({ where: { id: a.id }, data: { lembreteEnviadoEm: agora } });
      enviados++;
    } catch (err) {
      falhas++;
      logError('assinatura.lembretes', `Falha ao lembrar assinatura ${a.id}`, err as Error);
    }
  }

  logInfo('assinatura.lembretes', 'Sweep de lembretes de vencimento concluído', {
    verificadas: assinaturas.length, enviados, falhas,
  });

  return { verificadas: assinaturas.length, enviados, falhas };
}
