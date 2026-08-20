// Execução: npx tsx src/lib/assinatura/test-recorrencia.ts
//
// Cobre o caminho NOVO de concessão de acesso: as faturas que o Mercado Pago
// gera sozinho a cada ciclo da assinatura recorrente. Nenhum teste toca o
// gateway — processarFaturaRecorrente recebe o snapshot já buscado.
import prisma from '@/lib/prisma';
import { processarFaturaRecorrente, sincronizarStatusAssinatura } from './servico';
import type { FaturaRecorrente } from './servico';
import { temAcessoAtivo } from './acesso';

let falhas = 0;
const check = (n: string, ok: boolean, d = '') => { console.log(`${ok ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`); if (!ok) falhas++; };
const dia = 24 * 60 * 60 * 1000;

const fatura = (over: Partial<FaturaRecorrente> & { faturaId: string; mpPreapprovalId: string }): FaturaRecorrente => ({
  statusPagamento: 'approved',
  valor: 149.9,
  moeda: 'BRL',
  liveMode: true,
  ...over,
});

(async () => {
  const criados: string[] = [];
  try {
    // Assinante bloqueado (trial vencido) com assinatura recorrente no gateway.
    const usuario = await prisma.usuario.create({
      data: { email: `recor-${Date.now()}@exemplo.com`, senhaHash: 'x', nome: 'Recorrencia' },
    });
    criados.push(usuario.id);
    const preId = `pre-${Date.now()}`;
    const assinatura = await prisma.assinatura.create({
      data: {
        usuarioId: usuario.id,
        trialFimEm: new Date(Date.now() - 30 * dia),
        mpPreapprovalId: preId,
        status: 'ATIVA',
      },
    });

    check('antes de qualquer fatura → sem acesso', temAcessoAtivo(assinatura) === false);

    // ── 1. Fatura paga concede acesso ──
    const r1 = await processarFaturaRecorrente(fatura({ faturaId: `fat-1-${Date.now()}`, mpPreapprovalId: preId }));
    check('fatura aprovada → concede acesso', r1.processado === true);

    const a1 = await prisma.assinatura.findUnique({ where: { id: assinatura.id } });
    check('acesso ativo após a 1ª fatura', temAcessoAtivo(a1) === true);

    // A cobrança foi materializada pelo próprio fluxo (o MP a criou, não nós).
    const cob1 = await prisma.cobranca.findFirst({ where: { assinaturaId: assinatura.id } });
    check('cobrança da fatura foi criada e está APROVADA', cob1?.status === 'APROVADA');
    check('cobrança vinculada à preapproval', cob1?.mpPreapprovalId === preId);

    // ── 2. Reentrega da MESMA fatura é idempotente ──
    const periodoApos1 = a1!.periodoFimEm!;
    const r2 = await processarFaturaRecorrente(fatura({ faturaId: cob1!.mpPaymentId!, mpPreapprovalId: preId }));
    check('reentrega da mesma fatura → não processa de novo', r2.processado === false && r2.motivo === 'ja_processada');
    const a2 = await prisma.assinatura.findUnique({ where: { id: assinatura.id } });
    check('período NÃO estendido duas vezes pela mesma fatura', a2!.periodoFimEm!.getTime() === periodoApos1.getTime());
    check('reentrega não duplicou a linha de cobrança',
      (await prisma.cobranca.count({ where: { assinaturaId: assinatura.id } })) === 1);

    // ── 3. Fatura do ciclo SEGUINTE estende de novo (é a renovação funcionando) ──
    const r3 = await processarFaturaRecorrente(fatura({ faturaId: `fat-2-${Date.now()}`, mpPreapprovalId: preId }));
    check('fatura do próximo ciclo → concede de novo', r3.processado === true);
    const a3 = await prisma.assinatura.findUnique({ where: { id: assinatura.id } });
    const diff = Math.round((a3!.periodoFimEm!.getTime() - periodoApos1.getTime()) / dia);
    check('2 faturas → +30 dias sobre o período anterior (renovação acumula)', diff === 30, `estendeu ${diff} dias`);

    // ── 4. Fatura recusada nunca concede ──
    for (const st of ['rejected', 'pending', 'cancelled', 'in_process']) {
      const antes = (await prisma.assinatura.findUnique({ where: { id: assinatura.id } }))!.periodoFimEm!;
      const r = await processarFaturaRecorrente(fatura({ faturaId: `fat-${st}-${Date.now()}`, mpPreapprovalId: preId, statusPagamento: st }));
      const dep = (await prisma.assinatura.findUnique({ where: { id: assinatura.id } }))!.periodoFimEm!;
      check(`fatura com pagamento "${st}" → NÃO concede`, r.processado === false && dep.getTime() === antes.getTime());
    }

    // ── 5. Valor divergente é recusado (defesa do núcleo continua valendo) ──
    const antesValor = (await prisma.assinatura.findUnique({ where: { id: assinatura.id } }))!.periodoFimEm!;
    const rv = await processarFaturaRecorrente(fatura({ faturaId: `fat-barato-${Date.now()}`, mpPreapprovalId: preId, valor: 1 }));
    check('fatura com valor menor que o plano → recusada', rv.processado === false && rv.motivo === 'valor_divergente');
    const depValor = (await prisma.assinatura.findUnique({ where: { id: assinatura.id } }))!.periodoFimEm!;
    check('valor divergente → período inalterado', depValor.getTime() === antesValor.getTime());

    // ── 6. Fatura de uma preapproval que não é nossa ──
    const rx = await processarFaturaRecorrente(fatura({ faturaId: `fat-x-${Date.now()}`, mpPreapprovalId: 'pre-de-outro-vendedor' }));
    check('fatura de preapproval desconhecida → recusada', rx.processado === false && rx.motivo === 'cobranca_nao_encontrada');

    // ── 7. MP cancela sozinho após 3 faturas recusadas → refletir local ──
    const rs = await sincronizarStatusAssinatura(preId, 'cancelled');
    check('status cancelled no gateway → sincroniza local', rs.sincronizado === true);
    const aCancel = await prisma.assinatura.findUnique({ where: { id: assinatura.id } });
    check('sincronização marcou canceladaEm', aCancel!.canceladaEm !== null);
    check('sincronização NÃO revogou o acesso já pago', temAcessoAtivo(aCancel) === true);

    // Idempotente: 2ª sincronização não sobrescreve a data.
    const rs2 = await sincronizarStatusAssinatura(preId, 'cancelled');
    check('2ª sincronização → no-op', rs2.sincronizado === false);
  } finally {
    for (const id of criados) {
      await prisma.cobranca.deleteMany({ where: { assinatura: { usuarioId: id } } });
      await prisma.assinatura.deleteMany({ where: { usuarioId: id } });
      await prisma.usuario.deleteMany({ where: { id } });
    }
  }

  console.log(falhas === 0 ? '\n✅ Todos os testes passaram' : `\n❌ ${falhas} teste(s) falharam`);
  process.exit(falhas === 0 ? 0 : 1);
})();
