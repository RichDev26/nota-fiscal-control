// Execução: npx tsx src/lib/assinatura/test-servico.ts
import prisma from '@/lib/prisma';
import { criarAssinaturaTrial, processarPagamentoAprovado, obterStatusParaCliente } from './servico';

let falhas = 0;
const check = (n: string, ok: boolean, d = '') => { console.log(`${ok ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`); if (!ok) falhas++; };
const dia = 24 * 60 * 60 * 1000;

(async () => {
  const email = `teste-servico-${Date.now()}@exemplo.com`;
  const usuario = await prisma.usuario.create({ data: { email, senhaHash: 'x', nome: 'Teste Servico' } });

  // ── Trial: início customizado (simula backfill de usuário antigo) ──
  const criadoHa10Dias = new Date(Date.now() - 10 * dia);
  const assinatura = await criarAssinaturaTrial(usuario.id, criadoHa10Dias);
  check('trialFimEm = inicioTrial + 7 dias', Math.abs(assinatura.trialFimEm.getTime() - (criadoHa10Dias.getTime() + 7 * dia)) < 1000);

  const status1 = await obterStatusParaCliente(usuario.id);
  check('usuário com trial de conta "antiga" (10 dias) -> bloqueado', status1.ativo === false);
  check('motivo = trial_expirado (nunca pagou)', status1.motivo === 'trial_expirado');

  // ── Pagamento aprovado: cria uma Cobranca PENDENTE e processa ──
  const cobranca = await prisma.cobranca.create({
    data: { assinaturaId: assinatura.id, valor: 49.9, idempotencyKey: `idem-${Date.now()}`, mpPaymentId: `mp-${Date.now()}` },
  });

  const r1 = await processarPagamentoAprovado(cobranca.mpPaymentId!);
  check('primeira confirmação processa e estende o período', r1.processado === true);

  const status2 = await obterStatusParaCliente(usuario.id);
  check('depois do pagamento -> acesso ativo', status2.ativo === true);

  // ── Idempotência: reprocessar o MESMO mpPaymentId não deve estender de novo ──
  const periodoFimApos1 = (await prisma.assinatura.findUnique({ where: { id: assinatura.id } }))!.periodoFimEm!;
  const r2 = await processarPagamentoAprovado(cobranca.mpPaymentId!);
  check('reprocessar mesmo pagamento -> não processado de novo (idempotente)', r2.processado === false && r2.motivo === 'ja_processada');
  const periodoFimApos2 = (await prisma.assinatura.findUnique({ where: { id: assinatura.id } }))!.periodoFimEm!;
  check('período NÃO foi estendido duas vezes', periodoFimApos1.getTime() === periodoFimApos2.getTime());

  // ── mpPaymentId desconhecido -> não processado, sem erro ──
  const r3 = await processarPagamentoAprovado('mp-inexistente-999');
  check('mpPaymentId desconhecido -> não processado, motivo correto', r3.processado === false && r3.motivo === 'cobranca_nao_encontrada');

  // Limpeza
  await prisma.usuario.delete({ where: { id: usuario.id } }); // cascade: Assinatura + Cobranca

  console.log(falhas === 0 ? '\n✅ Todos os testes passaram' : `\n❌ ${falhas} teste(s) falharam`);
  process.exit(falhas === 0 ? 0 : 1);
})();
