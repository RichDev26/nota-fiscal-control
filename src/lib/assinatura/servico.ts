/**
 * Camada de negócio da assinatura: criação do trial, processamento idempotente
 * de pagamento confirmado, e status consumível pelo cliente/telas.
 */
import prisma from '@/lib/prisma';
import type { Assinatura } from '@prisma/client';
import type { StatusAssinatura } from '@/types';
import { temAcessoAtivo } from './acesso';
import { logError } from '@/lib/extractors/logger';

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
    | 'ambiente_divergente'
    | 'conflito_concorrencia';
  novoPeriodoFimEm?: Date;
}

/** Tolerância de centavo para comparação de float (o gateway devolve number). */
const TOLERANCIA_VALOR = 0.01;

/** Erro interno de concorrência — dispara retry, nunca vaza para o cliente. */
class ConflitoConcorrencia extends Error {}

/** Contador observável de retries por conflito — usado pelos testes para provar
 *  que o caminho de retry (CAS miss / optimistic lock miss / P2034) foi de fato
 *  exercitado, e não só que o resultado final bateu por acaso. */
export let conflitosDeConcorrencia = 0;
export function _resetContadorConflitos(): void { conflitosDeConcorrencia = 0; }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

  for (let tentativa = 0; tentativa < 3; tentativa++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const cobranca = await tx.cobranca.findUnique({
          where: { mpPaymentId: pagamento.mpPaymentId },
          include: { assinatura: true },
        });
        if (!cobranca) return { processado: false, motivo: 'cobranca_nao_encontrada' as const };

        // ── Defesa 3: o valor pago não pode ser MENOR que o cobrado. Pagar a
        // mais é aceito (cliente já foi debitado, negar deixaria pago e sem
        // acesso); só a subcobrança é recusada. ──
        if (pagamento.valor < cobranca.valor - TOLERANCIA_VALOR) {
          return { processado: false, motivo: 'valor_divergente' as const };
        }

        // ── Defesa 3 (cont.): moeda deve bater com a DESTA cobrança, não com
        // uma constante fixa — a fonte da verdade é o que o backend criou. ──
        if (pagamento.moeda !== cobranca.moeda) {
          return { processado: false, motivo: 'moeda_divergente' as const };
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
      // ConflitoConcorrencia = optimistic lock perdido (nosso). P2034 = write
      // conflict/deadlock que o próprio Postgres detectou. Ambos são
      // transitórios: vale a pena refazer a transação do zero.
      const isP2034 = typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2034';
      if (err instanceof ConflitoConcorrencia || isP2034) {
        conflitosDeConcorrencia++;
        await sleep(10 * (tentativa + 1)); // pequeno backoff: não bater de novo na mesma linha instantaneamente
        continue;
      }
      throw err;
    }
  }

  // 3 tentativas perdidas seguidas: não sabemos se o pagamento foi concedido
  // por outra execução ou se todas colidiram sem ninguém vencer. Falha
  // fechada (não concede), mas isto é DIFERENTE de idempotência — é uma
  // condição anômala que precisa ficar visível em log/alerta, porque no fluxo
  // de cartão (resposta síncrona + webhook correndo juntos) o cliente pode já
  // ter sido cobrado sem que nada aqui tenha concedido acesso.
  logError(
    'assinatura.servico',
    'processarPagamentoAprovado: 3 tentativas de retry esgotadas por conflito de concorrência',
    undefined,
    { mpPaymentId: pagamento.mpPaymentId },
  );
  return { processado: false, motivo: 'conflito_concorrencia' };
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
