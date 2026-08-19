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

/**
 * Snapshot do pagamento COMO RETORNADO PELO MERCADO PAGO. Só o backend produz
 * este objeto (resposta de payment.create ou payment.get). Nenhum campo aqui
 * pode ter origem no cliente — é essa a fronteira de confiança do sistema.
 */
export interface PagamentoConfirmado {
  mpPaymentId: string;
  status: string;
  statusDetail: string | null;
  valor: number;
  moeda: string;
  liveMode: boolean;
}

export interface ResultadoProcessamentoPagamento {
  processado: boolean;
  motivo?:
    | 'cobranca_nao_encontrada'
    | 'ja_processada'
    | 'status_nao_aprovado'
    | 'valor_divergente'
    | 'moeda_divergente'
    | 'ambiente_divergente';
  novoPeriodoFimEm?: Date;
}

/** Tolerância de centavo para comparação de float (o gateway devolve number). */
const TOLERANCIA_VALOR = 0.01;
const MOEDA_ESPERADA = 'BRL';

/** Erro interno de concorrência — dispara retry, nunca vaza para o cliente. */
class ConflitoConcorrencia extends Error {}

/**
 * ÚNICO ponto do sistema que concede acesso pago. Idempotente e seguro sob
 * concorrência (resposta síncrona do cartão + webhook chegam juntos por
 * construção).
 *
 * Defesas, nesta ordem:
 *   1. Status deve ser exatamente 'approved' — qualquer outro estado (inclusive
 *      'authorized', que é pré-autorização sem captura) não concede nada.
 *   2. Ambiente: em produção só pagamento live_mode conta.
 *   3. Valor e moeda devem bater com a cobrança que NÓS criamos.
 *   4. Compare-and-swap atômico no status da Cobrança: só uma execução vence.
 *   5. Update condicional na Assinatura usando periodoFimEm como versão
 *      (optimistic locking) — impede lost update entre cobranças distintas.
 */
export async function processarPagamentoAprovado(
  pagamento: PagamentoConfirmado,
  agora: Date = new Date(),
): Promise<ResultadoProcessamentoPagamento> {
  // ── Defesa 1: só 'approved' concede. Tudo mais é recusa explícita. ──
  if (pagamento.status !== 'approved') {
    return { processado: false, motivo: 'status_nao_aprovado' };
  }

  // ── Defesa 2: pagamento de teste nunca concede acesso em produção. ──
  if (process.env.NODE_ENV === 'production' && pagamento.liveMode !== true) {
    return { processado: false, motivo: 'ambiente_divergente' };
  }

  // ── Defesa 3: moeda ──
  if (pagamento.moeda !== MOEDA_ESPERADA) {
    return { processado: false, motivo: 'moeda_divergente' };
  }

  for (let tentativa = 0; tentativa < 3; tentativa++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const cobranca = await tx.cobranca.findUnique({
          where: { mpPaymentId: pagamento.mpPaymentId },
          include: { assinatura: true },
        });
        if (!cobranca) return { processado: false, motivo: 'cobranca_nao_encontrada' as const };

        // ── Defesa 3 (cont.): o valor pago deve bater com o que cobramos. ──
        if (Math.abs(pagamento.valor - cobranca.valor) > TOLERANCIA_VALOR) {
          return { processado: false, motivo: 'valor_divergente' as const };
        }

        // ── Defesa 4: compare-and-swap atômico. Só quem sai daqui com
        // count === 1 tem o direito de conceder acesso. Concorrentes veem 0. ──
        const cas = await tx.cobranca.updateMany({
          where: { id: cobranca.id, status: { in: ['PENDENTE', 'PROCESSANDO'] } },
          data: {
            status: 'APROVADA',
            statusDetalhe: pagamento.statusDetail,
            processadaEm: agora,
          },
        });
        if (cas.count === 0) return { processado: false, motivo: 'ja_processada' as const };

        // ── Defesa 5: estende o período com optimistic locking. periodoFimEm
        // funciona como coluna de versão: se outra transação alterou entre a
        // leitura e a escrita, count === 0 e refazemos tudo. ──
        const periodoAtual = cobranca.assinatura.periodoFimEm;
        const base = periodoAtual && periodoAtual > agora ? periodoAtual : agora;
        const novoPeriodoFimEm = new Date(base.getTime() + DURACAO_PERIODO_MS);

        const upd = await tx.assinatura.updateMany({
          where: { id: cobranca.assinaturaId, periodoFimEm: periodoAtual },
          data: {
            periodoFimEm: novoPeriodoFimEm,
            status: 'ATIVA',
            // Novo ciclo pode gerar novo lembrete de vencimento.
            lembreteEnviadoEm: null,
          },
        });
        if (upd.count === 0) throw new ConflitoConcorrencia();

        return { processado: true as const, novoPeriodoFimEm };
      });
    } catch (err) {
      if (err instanceof ConflitoConcorrencia) continue; // refaz a transação
      throw err;
    }
  }

  // 3 tentativas perdidas seguidas: não concede. Falha fechada. O webhook do
  // Mercado Pago reentrega depois e a cobrança é processada então.
  return { processado: false, motivo: 'ja_processada' };
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
