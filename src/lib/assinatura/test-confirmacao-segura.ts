// Execução: npx tsx src/lib/assinatura/test-confirmacao-segura.ts
import prisma from '@/lib/prisma';
import { processarPagamentoAprovado } from './servico';
import type { PagamentoConfirmado } from './servico';

let falhas = 0;
const check = (n: string, ok: boolean, d = '') => { console.log(`${ok ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`); if (!ok) falhas++; };
const dia = 24 * 60 * 60 * 1000;

/** Snapshot válido (como viria do Mercado Pago) — os testes mutam campos específicos. */
function snapshot(over: Partial<PagamentoConfirmado> & { mpPaymentId: string }): PagamentoConfirmado {
  return {
    status: 'approved',
    statusDetail: 'accredited',
    valor: 149.9,
    moeda: 'BRL',
    liveMode: true,
    ...over,
  };
}

(async () => {
  const email = `teste-confirmacao-${Date.now()}@exemplo.com`;
  const usuario = await prisma.usuario.create({ data: { email, senhaHash: 'x', nome: 'Teste Confirmacao' } });
  const assinatura = await prisma.assinatura.create({
    data: { usuarioId: usuario.id, trialFimEm: new Date(Date.now() - 30 * dia) }, // trial já expirado
  });

  const novaCobranca = async (mpPaymentId: string, valor = 149.9) =>
    prisma.cobranca.create({
      data: { assinaturaId: assinatura.id, valor, idempotencyKey: `idem-${mpPaymentId}`, mpPaymentId },
    });

  // ── 1. Caminho feliz ──
  const c1 = await novaCobranca(`mp-ok-${Date.now()}`);
  const r1 = await processarPagamentoAprovado(snapshot({ mpPaymentId: c1.mpPaymentId! }));
  check('pagamento aprovado e válido → processado', r1.processado === true);

  const a1 = await prisma.assinatura.findUnique({ where: { id: assinatura.id } });
  check('periodoFimEm foi estendido ~30 dias no futuro', a1!.periodoFimEm !== null && a1!.periodoFimEm! > new Date());

  // ── 2. Idempotência: mesmo pagamento de novo ──
  const periodoApos1 = a1!.periodoFimEm!;
  const r2 = await processarPagamentoAprovado(snapshot({ mpPaymentId: c1.mpPaymentId! }));
  check('reprocessar o mesmo pagamento → recusado como já processado', r2.processado === false && r2.motivo === 'ja_processada');
  const a2 = await prisma.assinatura.findUnique({ where: { id: assinatura.id } });
  check('período NÃO foi estendido duas vezes', a2!.periodoFimEm!.getTime() === periodoApos1.getTime());

  // ── 3. V2 — valor divergente deve ser REJEITADO ──
  const c3 = await novaCobranca(`mp-valor-${Date.now()}`);
  const r3 = await processarPagamentoAprovado(snapshot({ mpPaymentId: c3.mpPaymentId!, valor: 1.0 }));
  check('valor pago menor que o cobrado → rejeitado', r3.processado === false && r3.motivo === 'valor_divergente');
  const c3After = await prisma.cobranca.findUnique({ where: { id: c3.id } });
  check('cobrança com valor divergente NÃO fica APROVADA', c3After!.status !== 'APROVADA');

  // ── 4. V2 — moeda divergente ──
  const c4 = await novaCobranca(`mp-moeda-${Date.now()}`);
  const r4 = await processarPagamentoAprovado(snapshot({ mpPaymentId: c4.mpPaymentId!, moeda: 'USD' }));
  check('moeda diferente de BRL → rejeitado', r4.processado === false && r4.motivo === 'moeda_divergente');

  // ── 5. Status não-aprovado nunca concede ──
  for (const st of ['pending', 'in_process', 'rejected', 'cancelled', 'authorized', 'refunded', 'charged_back']) {
    const c = await novaCobranca(`mp-${st}-${Date.now()}`);
    const r = await processarPagamentoAprovado(snapshot({ mpPaymentId: c.mpPaymentId!, status: st }));
    check(`status "${st}" → NÃO concede acesso`, r.processado === false && r.motivo === 'status_nao_aprovado');
  }

  // ── 6. Pagamento desconhecido (id que não é nosso) ──
  const r6 = await processarPagamentoAprovado(snapshot({ mpPaymentId: 'mp-inexistente-999999' }));
  check('mpPaymentId desconhecido → recusado', r6.processado === false && r6.motivo === 'cobranca_nao_encontrada');

  // ── 7. V1 — CONCORRÊNCIA: mesma cobrança confirmada 5x em paralelo ──
  const c7 = await novaCobranca(`mp-race-${Date.now()}`);
  const snap7 = snapshot({ mpPaymentId: c7.mpPaymentId! });
  const antesRace = (await prisma.assinatura.findUnique({ where: { id: assinatura.id } }))!.periodoFimEm!;
  const resultados = await Promise.all(Array.from({ length: 5 }, () => processarPagamentoAprovado(snap7)));
  const aprovados = resultados.filter(r => r.processado).length;
  check('5 confirmações simultâneas do MESMO pagamento → exatamente 1 processada', aprovados === 1, `processadas=${aprovados}`);

  const depoisRace = (await prisma.assinatura.findUnique({ where: { id: assinatura.id } }))!.periodoFimEm!;
  const diffDias = Math.round((depoisRace.getTime() - antesRace.getTime()) / dia);
  check('período estendido EXATAMENTE 30 dias (não 150)', diffDias === 30, `estendeu ${diffDias} dias`);

  // ── 8. V1 — CONCORRÊNCIA: duas cobranças DIFERENTES em paralelo (não pode perder extensão) ──
  const cA = await novaCobranca(`mp-par-a-${Date.now()}`);
  const cB = await novaCobranca(`mp-par-b-${Date.now()}`);
  const antesPar = (await prisma.assinatura.findUnique({ where: { id: assinatura.id } }))!.periodoFimEm!;
  const [rA, rB] = await Promise.all([
    processarPagamentoAprovado(snapshot({ mpPaymentId: cA.mpPaymentId! })),
    processarPagamentoAprovado(snapshot({ mpPaymentId: cB.mpPaymentId! })),
  ]);
  check('duas cobranças distintas → ambas processadas', rA.processado === true && rB.processado === true);
  const depoisPar = (await prisma.assinatura.findUnique({ where: { id: assinatura.id } }))!.periodoFimEm!;
  const diffPar = Math.round((depoisPar.getTime() - antesPar.getTime()) / dia);
  check('dois pagamentos → 60 dias somados (sem lost update)', diffPar === 60, `estendeu ${diffPar} dias`);

  // ── Limpeza ──
  await prisma.cobranca.deleteMany({ where: { assinaturaId: assinatura.id } });
  await prisma.assinatura.delete({ where: { id: assinatura.id } });
  await prisma.usuario.delete({ where: { id: usuario.id } });

  console.log(falhas === 0 ? '\n✅ Todos os testes passaram' : `\n❌ ${falhas} teste(s) falharam`);
  process.exit(falhas === 0 ? 0 : 1);
})();
