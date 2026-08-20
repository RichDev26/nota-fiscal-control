/**
 * Camada de negócio da assinatura: criação do trial, processamento idempotente
 * de pagamento confirmado, e status consumível pelo cliente/telas.
 */
import prisma from '@/lib/prisma';
import type { Assinatura } from '@prisma/client';
import type { StatusAssinatura } from '@/types';
import { temAcessoAtivo } from './acesso';
import { PLANO_PADRAO } from './config';
import { cancelarAssinaturaRecorrente } from '@/lib/payments/mercadopago';
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
      // P2028 = timeout da transação interativa (o vencedor do lock demorou).
      // Igualmente transitório: refazer é melhor que devolver 500 ao cliente.
      const code = typeof err === 'object' && err !== null ? (err as { code?: string }).code : undefined;
      const transitorio = code === 'P2034' || code === 'P2028';
      if (err instanceof ConflitoConcorrencia || transitorio) {
        if (tentativa < 2) await sleep(10 * (tentativa + 1)); // pequeno backoff: não bater de novo na mesma linha instantaneamente (só se houver próxima tentativa)
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

  // Método da última cobrança efetivamente aprovada — define se há o que cancelar.
  const ultimaAprovada = assinatura
    ? await prisma.cobranca.findFirst({
        where: { assinaturaId: assinatura.id, status: 'APROVADA' },
        orderBy: { processadaEm: 'desc' },
        select: { metodo: true },
      })
    : null;

  // Só há o que cancelar quando existe assinatura RECORRENTE no gateway. PIX é
  // avulso — nada a interromper. E só faz sentido enquanto o período é vigente.
  const podeCancelar =
    !!assinatura?.mpPreapprovalId &&
    !assinatura.canceladaEm &&
    !!assinatura.periodoFimEm &&
    assinatura.periodoFimEm > new Date();

  return {
    ativo,
    motivo: ativo ? null : (!assinatura?.periodoFimEm ? 'trial_expirado' : 'assinatura_vencida'),
    trialFimEm: assinatura?.trialFimEm ?? null,
    periodoFimEm: assinatura?.periodoFimEm ?? null,
    metodoUltimoPagamento: ultimaAprovada?.metodo ?? null,
    podeCancelar,
    canceladaEm: assinatura?.canceladaEm ?? null,
  };
}

export interface ResultadoCancelamento {
  cancelada: boolean;
  motivo?: 'sem_assinatura' | 'sem_assinatura_recorrente' | 'ja_cancelada' | 'sem_periodo_vigente' | 'falha_gateway';
  acessoAte?: Date;
}

/**
 * Cancela a assinatura recorrente.
 *
 * INTERROMPE AS COBRANÇAS FUTURAS DE VERDADE: chama o Mercado Pago
 * (PUT /preapproval/{id} status=cancelled) antes de marcar localmente. Se a
 * chamada ao gateway falhar, NÃO marcamos como cancelada — seria pior mentir
 * para o usuário e continuar cobrando o cartão dele.
 *
 * NÃO revoga acesso: o usuário mantém o período que já pagou (temAcessoAtivo
 * continua decidindo só pelas datas).
 *
 * Idempotente: cancelar duas vezes não muda nada e não é erro para o usuário.
 */
export async function cancelarAssinatura(
  usuarioId: string,
  agora: Date = new Date(),
  /** Injetável só para teste — em produção é sempre o cancelamento real no MP. */
  cancelarNoGateway: (id: string) => Promise<unknown> = cancelarAssinaturaRecorrente,
): Promise<ResultadoCancelamento> {
  const assinatura = await prisma.assinatura.findUnique({ where: { usuarioId } });
  if (!assinatura) return { cancelada: false, motivo: 'sem_assinatura' };
  if (assinatura.canceladaEm) return { cancelada: false, motivo: 'ja_cancelada', acessoAte: assinatura.periodoFimEm ?? undefined };
  if (!assinatura.periodoFimEm || assinatura.periodoFimEm <= agora) {
    return { cancelada: false, motivo: 'sem_periodo_vigente' };
  }

  if (!assinatura.mpPreapprovalId) return { cancelada: false, motivo: 'sem_assinatura_recorrente' };

  // ORDEM IMPORTA: desliga no gateway PRIMEIRO. Marcar local antes e falhar aqui
  // deixaria o usuário achando que cancelou enquanto o cartão segue sendo cobrado.
  try {
    await cancelarNoGateway(assinatura.mpPreapprovalId);
  } catch (err) {
    logError('assinatura.cancelar', `Falha ao cancelar no gateway (preapproval ${assinatura.mpPreapprovalId})`, err as Error,
      { assinaturaId: assinatura.id, preapprovalId: assinatura.mpPreapprovalId });
    return { cancelada: false, motivo: 'falha_gateway' };
  }

  // Guardado por canceladaEm: null — dois cliques simultâneos só marcam uma vez.
  const upd = await prisma.assinatura.updateMany({
    where: { id: assinatura.id, canceladaEm: null },
    data: { canceladaEm: agora, status: 'CANCELADA' },
  });
  if (upd.count === 0) return { cancelada: false, motivo: 'ja_cancelada', acessoAte: assinatura.periodoFimEm };

  return { cancelada: true, acessoAte: assinatura.periodoFimEm };
}


// ─── Faturas da assinatura recorrente ─────────────────────────────────────────

export interface FaturaRecorrente {
  faturaId: string;
  mpPreapprovalId: string;
  /** Status do PAGAMENTO da fatura no gateway ('approved' concede). */
  statusPagamento: string;
  valor: number;
  moeda: string;
  liveMode: boolean;
}

/**
 * Processa uma fatura gerada pela assinatura recorrente do Mercado Pago.
 *
 * O MP cria a fatura sozinho a cada ciclo — não passa pela nossa rota. Então
 * aqui materializamos a Cobranca correspondente (idempotente pelo unique em
 * mpPaymentId = id da fatura) e delegamos a DECISÃO ao mesmo núcleo de sempre:
 * processarPagamentoAprovado revalida status/valor/moeda/ambiente e concede sob
 * CAS. Nenhum caminho novo de concessão de acesso é criado.
 */
export async function processarFaturaRecorrente(
  fatura: FaturaRecorrente,
  agora: Date = new Date(),
): Promise<ResultadoProcessamentoPagamento> {
  const assinatura = await prisma.assinatura.findUnique({
    where: { mpPreapprovalId: fatura.mpPreapprovalId },
  });
  // Fatura de uma preapproval que não é nossa (ou que ainda não vinculamos).
  if (!assinatura) return { processado: false, motivo: 'cobranca_nao_encontrada' };

  // Valor ESPERADO desta competência: o que contratamos no gateway, nunca o que
  // a própria fatura diz. Gravar fatura.valor aqui tornaria a checagem de valor
  // do núcleo tautológica (compararia o número do gateway com ele mesmo) e uma
  // fatura de R$ 1,00 passaria.
  const valorEsperado = assinatura.valorRecorrente ?? PLANO_PADRAO.valor;

  // Materializa a cobrança desta competência. O unique em mpPaymentId garante
  // que reentregas do mesmo webhook não criem linhas duplicadas.
  try {
    await prisma.cobranca.create({
      data: {
        assinaturaId:    assinatura.id,
        metodo:          'CARTAO',
        planoId:         PLANO_PADRAO.id,
        valor:           valorEsperado,
        moeda:           'BRL',
        status:          'PROCESSANDO',
        mpPaymentId:     fatura.faturaId,
        mpPreapprovalId: fatura.mpPreapprovalId,
        idempotencyKey:  `fatura:${fatura.faturaId}`,
      },
    });
  } catch (e) {
    // P2002 = já existe (reentrega do webhook). Segue para o núcleo, que é
    // idempotente e vai responder 'ja_processada' se o CAS já tiver rodado.
    if ((e as { code?: string }).code !== 'P2002') throw e;
  }

  return processarPagamentoAprovado({
    mpPaymentId:  fatura.faturaId,
    status:       fatura.statusPagamento,
    statusDetail: null,
    valor:        fatura.valor,
    moeda:        fatura.moeda,
    liveMode:     fatura.liveMode,
  }, agora);
}

/**
 * Sincroniza o status local a partir do status da preapproval no gateway.
 * O MP cancela a assinatura sozinho após 3 faturas recusadas — precisamos
 * refletir isso. NUNCA mexe em periodoFimEm: o acesso já pago é preservado.
 */
export async function sincronizarStatusAssinatura(
  mpPreapprovalId: string,
  statusGateway: string,
  agora: Date = new Date(),
): Promise<{ sincronizado: boolean }> {
  const assinatura = await prisma.assinatura.findUnique({ where: { mpPreapprovalId } });
  if (!assinatura) return { sincronizado: false };

  if (statusGateway === 'cancelled' && !assinatura.canceladaEm) {
    await prisma.assinatura.updateMany({
      where: { id: assinatura.id, canceladaEm: null },
      data:  { canceladaEm: agora, status: 'CANCELADA' },
    });
    return { sincronizado: true };
  }
  return { sincronizado: false };
}
