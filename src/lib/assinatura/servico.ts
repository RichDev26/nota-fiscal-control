/**
 * Camada de negócio da assinatura: criação do trial, processamento idempotente
 * de pagamento confirmado, e status consumível pelo cliente/telas.
 */
import prisma from '@/lib/prisma';
import type { Assinatura } from '@prisma/client';
import type { StatusAssinatura } from '@/types';
import { temAcessoAtivo } from './acesso';

const DURACAO_TRIAL_MS  = 7 * 24 * 60 * 60 * 1000;
const DURACAO_PERIODO_MS = 30 * 24 * 60 * 60 * 1000;

/** Cria a Assinatura em TRIAL. `inicioTrial` permite reaproveitar esta função no
 *  backfill de usuários existentes (inicioTrial = usuario.criadoEm), já que o
 *  trial deles conta a partir da criação da conta, não do momento do backfill. */
export async function criarAssinaturaTrial(usuarioId: string, inicioTrial: Date = new Date()): Promise<Assinatura> {
  const trialFimEm = new Date(inicioTrial.getTime() + DURACAO_TRIAL_MS);
  return prisma.assinatura.create({ data: { usuarioId, trialFimEm } });
}

export interface ResultadoProcessamentoPagamento {
  processado: boolean;
  motivo?: 'cobranca_nao_encontrada' | 'ja_processada';
  novoPeriodoFimEm?: Date;
}

/**
 * Idempotente: chamado pelo webhook toda vez que o Mercado Pago confirma um
 * pagamento. Releitura do status dentro da transação protege contra entregas
 * duplicadas/simultâneas do webhook (o MP reenvia notificações).
 */
export async function processarPagamentoAprovado(
  mpPaymentId: string,
  agora: Date = new Date(),
): Promise<ResultadoProcessamentoPagamento> {
  return prisma.$transaction(async (tx) => {
    const cobranca = await tx.cobranca.findUnique({
      where: { mpPaymentId },
      include: { assinatura: true },
    });
    if (!cobranca) return { processado: false, motivo: 'cobranca_nao_encontrada' as const };
    if (cobranca.status === 'APROVADA') return { processado: false, motivo: 'ja_processada' as const };

    const baseAtual = cobranca.assinatura.periodoFimEm && cobranca.assinatura.periodoFimEm > agora
      ? cobranca.assinatura.periodoFimEm
      : agora;
    const novoPeriodoFimEm = new Date(baseAtual.getTime() + DURACAO_PERIODO_MS);

    await tx.cobranca.update({ where: { id: cobranca.id }, data: { status: 'APROVADA' } });
    await tx.assinatura.update({
      where: { id: cobranca.assinaturaId },
      // lembreteEnviadoEm volta a null: a renovação abre um novo ciclo, que também
      // deve poder gerar um lembrete de vencimento 3 dias antes do PRÓXIMO fim.
      data: { periodoFimEm: novoPeriodoFimEm, status: 'ATIVA', lembreteEnviadoEm: null },
    });

    return { processado: true as const, novoPeriodoFimEm };
  });
}

export async function obterStatusParaCliente(usuarioId: string): Promise<StatusAssinatura> {
  const assinatura = await prisma.assinatura.findUnique({ where: { usuarioId } });
  const ativo = temAcessoAtivo(assinatura);
  return {
    ativo,
    motivo: ativo ? null : (!assinatura?.periodoFimEm ? 'trial_expirado' : 'assinatura_vencida'),
    trialFimEm: assinatura?.trialFimEm ?? null,
    periodoFimEm: assinatura?.periodoFimEm ?? null,
  };
}
