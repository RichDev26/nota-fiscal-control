/**
 * Sweep de notificações do Controle de Integração — o núcleo da automação.
 *
 * Roda periodicamente (ver src/instrumentation.ts). Para cada documento de cada
 * colaborador, verifica quais marcos (2M/1M/15D/3D/0D) já foram atingidos e ainda
 * não geraram e-mail, envia e registra o envio.
 *
 * GARANTIAS:
 *   - Nunca duplica: checa o log de envios em memória + constraint única no banco
 *     como rede de segurança contra corrida entre execuções concorrentes.
 *   - Resiliente a indisponibilidade: usa "dias restantes <= marco" (não "== marco"),
 *     então marcos perdidos durante o período fora do ar são processados no
 *     próximo sweep, sem nunca pular uma notificação pendente.
 *   - Não marca como enviado se o e-mail não foi de fato disparado (ex: SMTP não
 *     configurado) — a notificação pendente é reprocessada automaticamente no
 *     próximo sweep, garantindo que nada seja perdido silenciosamente.
 */
import prisma from '@/lib/prisma';
import { MARCOS, labelTipoDocumento } from './tipos';
import { diasRestantes } from './status';
import { enviarEmail } from '@/lib/email/mailer';
import { templateVencimentoDocumento } from '@/lib/email/templates/vencimento-documento';
import { logInfo, logError } from '@/lib/extractors/logger';

export interface ResultadoSweep {
  documentosVerificados: number;
  notificacoesEnviadas: number;
  falhas: number;
}

export async function processarNotificacoesPendentes(hoje: Date = new Date()): Promise<ResultadoSweep> {
  const documentos = await prisma.documentoColaborador.findMany({
    include: {
      colaborador: { include: { usuario: { select: { email: true } } } },
      notificacoes: { select: { marco: true } },
    },
  });

  let enviadas = 0;
  let falhas = 0;

  for (const doc of documentos) {
    const destinatario = doc.colaborador.usuario?.email;
    if (!destinatario) continue; // colaborador sem usuário vinculado — nada a notificar

    const dias        = diasRestantes(doc.dataFim, hoje);
    const jaEnviados   = new Set(doc.notificacoes.map(n => n.marco));

    for (const m of MARCOS) {
      if (dias > m.dias) continue;           // marco ainda não chegou
      if (jaEnviados.has(m.marco)) continue; // já enviado — nunca duplicar

      try {
        const { subject, html } = templateVencimentoDocumento({
          colaboradorNome:    doc.colaborador.nome,
          tipoDocumentoLabel: labelTipoDocumento(doc.tipo),
          dataFim:            doc.dataFim,
          diasRestantes:      dias,
        });
        const resultado = await enviarEmail({ to: destinatario, subject, html });
        if (!resultado.enviado) continue; // SMTP indisponível — tenta de novo no próximo sweep

        await prisma.notificacaoDocumento.create({
          data: { documentoColaboradorId: doc.id, marco: m.marco },
        });
        enviadas++;
      } catch (err) {
        // P2002 = constraint única violada → outra execução já registrou este marco
        if ((err as { code?: string }).code === 'P2002') continue;
        falhas++;
        logError('colaboradores.notificacoes', `Falha ao notificar documento ${doc.id} (marco ${m.marco})`, err as Error);
      }
    }
  }

  logInfo('colaboradores.notificacoes', 'Sweep de notificações concluído', {
    documentosVerificados: documentos.length, notificacoesEnviadas: enviadas, falhas,
  });

  return { documentosVerificados: documentos.length, notificacoesEnviadas: enviadas, falhas };
}
