// Execução: npx tsx src/lib/assinatura/test-confirmacao-segura.ts
import prisma from '@/lib/prisma';
import { processarPagamentoAprovado } from './servico';
import type { PagamentoConfirmado } from './servico';

/**
 * O QUE ESTE ARQUIVO REALMENTE PROVA (leia antes de confiar nos testes 9 e 10)
 * ───────────────────────────────────────────────────────────────────────────
 * Os testes 9 e 10 abaixo ("N confirmações simultâneas" / "dois pagamentos em
 * paralelo") disparam várias chamadas via Promise.all. Em SQLite TODA escrita
 * é serializada pelo próprio motor (um arquivo, um writer por vez) — não
 * existe aqui a interleaving real que Postgres permite (duas transações
 * avançando ao mesmo tempo, cada uma lendo o snapshot da outra a meio
 * caminho), que é exatamente o que o compare-and-swap e o optimistic lock
 * foram desenhados para resolver. Ou seja: os testes 9 e 10 provam o
 * RESULTADO (exatamente 1 processado, 30/60 dias somados corretamente) mas
 * NÃO provam que foi o CAS ou o optimistic lock que garantiram isso — o
 * mesmo resultado apareceria mesmo se `servico.ts` não tivesse nenhum dos
 * dois mecanismos, porque o SQLite já serializa por fora.
 *
 * O que de fato prova que os dois mecanismos fazem o que dizem fazer é a
 * seção "8. PRIMITIVAS" abaixo: testes determinísticos, sem depender de
 * nenhuma race, verificando diretamente contra o banco que:
 *   - updateMany com status IN (PENDENTE, PROCESSANDO) casa exatamente 1
 *     linha quando o status é PENDENTE, e 0 linhas quando já está APROVADA
 *     (a garantia do CAS);
 *   - updateMany com periodoFimEm = <valor específico> casa 0 linhas quando
 *     esse valor já mudou — incluindo explicitamente o caso NULL (primeiro
 *     pagamento / usuário em trial) — e 1 linha quando o valor bate (a
 *     garantia do optimistic lock).
 *
 * Validar a interleaving de verdade — duas transações Postgres competindo de
 * fato pela mesma linha, no meio de uma delas — exige rodar este arquivo (ou
 * um equivalente) contra Postgres real, o que este ambiente de dev não tem
 * (Docker indisponível aqui). Os testes 9 e 10 continuam no arquivo porque
 * cobrem o contrato observável (idempotência, soma correta sob concorrência
 * de processo), só não devem ser lidos como prova de segurança sob
 * concorrência real de banco. Observar o caminho de retry (CAS miss /
 * optimistic lock miss / P2034) de fato disparando exige rodar este arquivo
 * (ou equivalente) contra Postgres real.
 */

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
  const usuariosCriados: string[] = [];
  try {
    const email = `teste-confirmacao-${Date.now()}@exemplo.com`;
    const usuario = await prisma.usuario.create({ data: { email, senhaHash: 'x', nome: 'Teste Confirmacao' } });
    usuariosCriados.push(usuario.id);
    const assinatura = await prisma.assinatura.create({
      data: { usuarioId: usuario.id, trialFimEm: new Date(Date.now() - 30 * dia) }, // trial já expirado
    });

    const novaCobranca = async (mpPaymentId: string, valor = 149.9, moeda = 'BRL') =>
      prisma.cobranca.create({
        data: { assinaturaId: assinatura.id, valor, moeda, idempotencyKey: `idem-${mpPaymentId}`, mpPaymentId },
      });

    // ── 1. Caminho feliz ──
    const c1 = await novaCobranca(`mp-ok-${Date.now()}`);
    const r1 = await processarPagamentoAprovado(snapshot({ mpPaymentId: c1.mpPaymentId! }));
    check('pagamento aprovado e válido → processado', r1.processado === true);

    const a1 = await prisma.assinatura.findUnique({ where: { id: assinatura.id } });
    const diffDias1 = Math.round((a1!.periodoFimEm!.getTime() - Date.now()) / dia);
    check('periodoFimEm foi estendido ~30 dias no futuro', Math.abs(diffDias1 - 30) <= 1, `diff=${diffDias1} dias`);

    // ── 2. Idempotência: mesmo pagamento de novo ──
    const periodoApos1 = a1!.periodoFimEm!;
    const r2 = await processarPagamentoAprovado(snapshot({ mpPaymentId: c1.mpPaymentId! }));
    check('reprocessar o mesmo pagamento → recusado como já processado', r2.processado === false && r2.motivo === 'ja_processada');
    const a2 = await prisma.assinatura.findUnique({ where: { id: assinatura.id } });
    check('período NÃO foi estendido duas vezes', a2!.periodoFimEm!.getTime() === periodoApos1.getTime());

    // ── 3. Valor: subpagamento rejeitado, sobrepagamento aceito ──
    const c3 = await novaCobranca(`mp-valor-${Date.now()}`);
    const r3 = await processarPagamentoAprovado(snapshot({ mpPaymentId: c3.mpPaymentId!, valor: 1.0 }));
    check('valor pago MENOR que o cobrado → rejeitado', r3.processado === false && r3.motivo === 'valor_divergente');
    const c3After = await prisma.cobranca.findUnique({ where: { id: c3.id } });
    check('cobrança com valor divergente NÃO fica APROVADA', c3After!.status !== 'APROVADA');

    const c3b = await novaCobranca(`mp-over-${Date.now()}`);
    const r3b = await processarPagamentoAprovado(snapshot({ mpPaymentId: c3b.mpPaymentId!, valor: c3b.valor + 5 }));
    check('valor pago MAIOR que o cobrado → aceito (cliente já foi debitado, negar deixaria sem acesso)', r3b.processado === true);

    // ── 4. Moeda: comparada contra a cobrança específica, não uma constante fixa ──
    const c4 = await novaCobranca(`mp-moeda-${Date.now()}`); // moeda da cobrança = BRL (default)
    const r4 = await processarPagamentoAprovado(snapshot({ mpPaymentId: c4.mpPaymentId!, moeda: 'USD' }));
    check('moeda do pagamento ≠ moeda da cobrança → rejeitado', r4.processado === false && r4.motivo === 'moeda_divergente');
    const c4After = await prisma.cobranca.findUnique({ where: { id: c4.id } });
    check('cobrança com moeda divergente NÃO fica APROVADA', c4After!.status !== 'APROVADA');

    const c4b = await novaCobranca(`mp-moeda-usd-${Date.now()}`, 149.9, 'USD'); // cobrança CRIADA em USD
    const r4b = await processarPagamentoAprovado(snapshot({ mpPaymentId: c4b.mpPaymentId!, moeda: 'USD' }));
    check('pagamento em USD casando com cobrança criada em USD → aceito (prova: compara contra a cobrança, não contra BRL fixo)', r4b.processado === true);

    // ── 5. Status não-aprovado nunca concede ──
    for (const st of ['pending', 'in_process', 'rejected', 'cancelled', 'authorized', 'refunded', 'charged_back']) {
      const c = await novaCobranca(`mp-${st}-${Date.now()}`);
      const r = await processarPagamentoAprovado(snapshot({ mpPaymentId: c.mpPaymentId!, status: st }));
      check(`status "${st}" → NÃO concede acesso`, r.processado === false && r.motivo === 'status_nao_aprovado');
      const cAfter = await prisma.cobranca.findUnique({ where: { id: c.id } });
      check(`status "${st}" → cobrança NÃO fica APROVADA`, cAfter!.status !== 'APROVADA');
    }

    // ── 6. Pagamento desconhecido (id que não é nosso) ──
    const r6 = await processarPagamentoAprovado(snapshot({ mpPaymentId: 'mp-inexistente-999999' }));
    check('mpPaymentId desconhecido → recusado', r6.processado === false && r6.motivo === 'cobranca_nao_encontrada');

    // ── 7. Guard de ambiente: só live_mode conta em produção ──
    // process.env não é mutável no tipo do Node (NodeJS.ProcessEnv o declara
    // readonly), mas em runtime é um objeto comum — `tsx` não faz inlining de
    // NODE_ENV, então mutar de verdade é a única forma de testar as duas
    // direções do guard.
    const env = process.env as Record<string, string | undefined>;
    const nodeEnvOriginal = env.NODE_ENV;
    try {
      const cProd = await novaCobranca(`mp-prod-${Date.now()}`);
      env.NODE_ENV = 'production';
      const rProd = await processarPagamentoAprovado(snapshot({ mpPaymentId: cProd.mpPaymentId!, liveMode: false }));
      check('produção + liveMode:false → negado (ambiente_divergente)', rProd.processado === false && rProd.motivo === 'ambiente_divergente');
      const cProdAfter = await prisma.cobranca.findUnique({ where: { id: cProd.id } });
      check('produção + liveMode:false → cobrança NÃO fica APROVADA', cProdAfter!.status !== 'APROVADA');

      const cDev = await novaCobranca(`mp-dev-${Date.now()}`);
      env.NODE_ENV = 'development'; // qualquer valor ≠ 'production'
      const rDev = await processarPagamentoAprovado(snapshot({ mpPaymentId: cDev.mpPaymentId!, liveMode: false }));
      check('fora de produção + liveMode:false → ainda concede (a condição não está invertida)', rDev.processado === true);
    } finally {
      if (nodeEnvOriginal === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
      else (process.env as Record<string, string | undefined>).NODE_ENV = nodeEnvOriginal;
    }

    // ── 8. PRIMITIVAS — prova determinística do CAS e do optimistic lock ──
    // Ver comentário no topo do arquivo: isto é o que realmente sustenta os
    // testes 9 e 10, que em SQLite não conseguem provar a interleaving.
    const usuario2 = await prisma.usuario.create({
      data: { email: `teste-primitivas-${Date.now()}@exemplo.com`, senhaHash: 'x', nome: 'Teste Primitivas' },
    });
    usuariosCriados.push(usuario2.id);
    const assinatura2 = await prisma.assinatura.create({
      data: { usuarioId: usuario2.id, trialFimEm: new Date(Date.now() - 30 * dia) },
    });

    // -- CAS: status IN (PENDENTE, PROCESSANDO) --
    const cCas = await prisma.cobranca.create({
      data: { assinaturaId: assinatura2.id, valor: 10, idempotencyKey: `idem-cas-${Date.now()}`, mpPaymentId: `mp-cas-${Date.now()}` },
    });
    const cas1 = await prisma.cobranca.updateMany({
      where: { id: cCas.id, status: { in: ['PENDENTE', 'PROCESSANDO'] } },
      data: { status: 'APROVADA' },
    });
    check('CAS: updateMany casa exatamente 1 linha quando status é PENDENTE', cas1.count === 1);
    const cas2 = await prisma.cobranca.updateMany({
      where: { id: cCas.id, status: { in: ['PENDENTE', 'PROCESSANDO'] } },
      data: { status: 'APROVADA' },
    });
    check('CAS: updateMany casa 0 linhas quando status já é APROVADA (a garantia que a segurança depende)', cas2.count === 0);

    // -- Optimistic lock: periodoFimEm como coluna de versão, incluindo o caso NULL --
    check('optimistic lock: assinatura nova nasce com periodoFimEm = null', assinatura2.periodoFimEm === null);
    const lockNull1 = await prisma.assinatura.updateMany({
      where: { id: assinatura2.id, periodoFimEm: null },
      data: { periodoFimEm: new Date(Date.now() + dia) },
    });
    check('optimistic lock: updateMany com periodoFimEm: null casa 1 linha (Prisma traduz para IS NULL)', lockNull1.count === 1);
    const lockNull2 = await prisma.assinatura.updateMany({
      where: { id: assinatura2.id, periodoFimEm: null },
      data: { periodoFimEm: new Date(Date.now() + 2 * dia) },
    });
    check('optimistic lock: reexecutar com periodoFimEm: null casa 0 linhas (valor já não é mais null)', lockNull2.count === 0);

    const valorAtual = (await prisma.assinatura.findUnique({ where: { id: assinatura2.id } }))!.periodoFimEm!;
    const valorObsoleto = new Date(valorAtual.getTime() - 999_999);
    const lockStale = await prisma.assinatura.updateMany({
      where: { id: assinatura2.id, periodoFimEm: valorObsoleto },
      data: { periodoFimEm: new Date(valorAtual.getTime() + dia) },
    });
    check('optimistic lock: valor obsoleto (stale) casa 0 linhas', lockStale.count === 0);
    const lockCorreto = await prisma.assinatura.updateMany({
      where: { id: assinatura2.id, periodoFimEm: valorAtual },
      data: { periodoFimEm: new Date(valorAtual.getTime() + dia) },
    });
    check('optimistic lock: valor atual (correto) casa 1 linha', lockCorreto.count === 1);

    // ── 9. Concorrência de PROCESSO: mesma cobrança confirmada 5x em paralelo ──
    // (ver aviso no topo — em SQLite isto prova o resultado, não a interleaving)
    const c9 = await novaCobranca(`mp-race-${Date.now()}`);
    const snap9 = snapshot({ mpPaymentId: c9.mpPaymentId! });
    const antesRace = (await prisma.assinatura.findUnique({ where: { id: assinatura.id } }))!.periodoFimEm!;
    const resultados = await Promise.all(Array.from({ length: 5 }, () => processarPagamentoAprovado(snap9)));
    const aprovados = resultados.filter(r => r.processado).length;
    check('5 confirmações simultâneas do MESMO pagamento → exatamente 1 processada', aprovados === 1, `processadas=${aprovados}`);

    const depoisRace = (await prisma.assinatura.findUnique({ where: { id: assinatura.id } }))!.periodoFimEm!;
    const diffDias = Math.round((depoisRace.getTime() - antesRace.getTime()) / dia);
    check('período estendido EXATAMENTE 30 dias (não 150)', diffDias === 30, `estendeu ${diffDias} dias`);

    // ── 10. Concorrência de PROCESSO: duas cobranças DIFERENTES em paralelo ──
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
  } finally {
    // Cascade (onDelete: Cascade) cuida de Assinatura + Cobranca de cada usuário criado.
    // Sem catch: se a limpeza falhar de verdade, isso deve estourar e aparecer,
    // não ser engolido — engolir aqui é o mesmo tipo de bug que este finally existe pra evitar.
    for (const usuarioId of usuariosCriados) {
      await prisma.usuario.delete({ where: { id: usuarioId } });
    }
  }

  console.log(falhas === 0 ? '\n✅ Todos os testes passaram' : `\n❌ ${falhas} teste(s) falharam`);
  process.exit(falhas === 0 ? 0 : 1);
})();
