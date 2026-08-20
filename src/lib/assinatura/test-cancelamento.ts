// Execução: npx tsx src/lib/assinatura/test-cancelamento.ts
import prisma from '@/lib/prisma';
import { cancelarAssinatura, obterStatusParaCliente } from './servico';
import { temAcessoAtivo } from './acesso';
import { processarLembretesVencimento } from './lembretes';

let falhas = 0;
const check = (n: string, ok: boolean, d = '') => { console.log(`${ok ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`); if (!ok) falhas++; };
const dia = 24 * 60 * 60 * 1000;

/** Cria usuário + assinatura paga (período vigente) e uma cobrança APROVADA do método dado. */
async function cenarioPago(metodo: 'CARTAO' | 'PIX', sufixo: string, diasRestantes = 20) {
  const usuario = await prisma.usuario.create({
    data: { email: `cancel-${sufixo}-${Date.now()}@exemplo.com`, senhaHash: 'x', nome: 'Cancel Teste' },
  });
  const assinatura = await prisma.assinatura.create({
    data: {
      usuarioId: usuario.id,
      trialFimEm: new Date(Date.now() - 30 * dia),
      periodoFimEm: new Date(Date.now() + diasRestantes * dia),
      status: 'ATIVA',
    },
  });
  await prisma.cobranca.create({
    data: {
      assinaturaId: assinatura.id, metodo, valor: 149.9, moeda: 'BRL', status: 'APROVADA',
      idempotencyKey: `idem-${metodo}-${sufixo}-${Date.now()}`,
      mpPaymentId: `mp-${metodo}-${sufixo}-${Date.now()}`,
      processadaEm: new Date(),
    },
  });
  return { usuario, assinatura };
}

(async () => {
  const criados: string[] = [];
  try {
    // ── 1. Cartão: cancela, mantém acesso, é idempotente ──
    {
      const { usuario, assinatura } = await cenarioPago('CARTAO', 'ok');
      criados.push(usuario.id);

      const antes = await obterStatusParaCliente(usuario.id);
      check('cartão pago → podeCancelar = true', antes.podeCancelar === true);
      check('cartão pago → metodoUltimoPagamento = CARTAO', antes.metodoUltimoPagamento === 'CARTAO');

      const r = await cancelarAssinatura(usuario.id);
      check('cancelamento executa', r.cancelada === true);

      const dep = await prisma.assinatura.findUnique({ where: { id: assinatura.id } });
      check('canceladaEm gravado', dep!.canceladaEm !== null);
      check('status vira CANCELADA', dep!.status === 'CANCELADA');

      // O ponto central: cancelar NÃO tira o acesso já pago.
      check('ACESSO PRESERVADO após cancelar', temAcessoAtivo(dep) === true);
      check('periodoFimEm NÃO foi alterado', dep!.periodoFimEm!.getTime() === assinatura.periodoFimEm!.getTime());

      const st = await obterStatusParaCliente(usuario.id);
      check('status pós-cancelamento: ativo=true, podeCancelar=false', st.ativo === true && st.podeCancelar === false);

      // Idempotência: 2ª chamada não é erro nem altera nada.
      const r2 = await cancelarAssinatura(usuario.id);
      check('2ª chamada → ja_cancelada (idempotente)', r2.cancelada === false && r2.motivo === 'ja_cancelada');
      const dep2 = await prisma.assinatura.findUnique({ where: { id: assinatura.id } });
      check('canceladaEm NÃO foi sobrescrito', dep2!.canceladaEm!.getTime() === dep!.canceladaEm!.getTime());

      // 5 cancelamentos concorrentes → só um vence.
      const { usuario: u2 } = await cenarioPago('CARTAO', 'race');
      criados.push(u2.id);
      const rs = await Promise.all(Array.from({ length: 5 }, () => cancelarAssinatura(u2.id)));
      check('5 cancelamentos simultâneos → exatamente 1 efetivo', rs.filter(x => x.cancelada).length === 1,
        `efetivos=${rs.filter(x => x.cancelada).length}`);
    }

    // ── 2. PIX não pode cancelar pelo painel (cobrança avulsa, nada a interromper) ──
    {
      const { usuario } = await cenarioPago('PIX', 'pix');
      criados.push(usuario.id);
      const st = await obterStatusParaCliente(usuario.id);
      check('PIX → podeCancelar = false', st.podeCancelar === false);
      const r = await cancelarAssinatura(usuario.id);
      check('PIX → cancelamento recusado com motivo correto', r.cancelada === false && r.motivo === 'sem_pagamento_cartao');
    }

    // ── 3. Sem período vigente (nunca pagou / já venceu) não há o que cancelar ──
    {
      const usuario = await prisma.usuario.create({
        data: { email: `cancel-trial-${Date.now()}@exemplo.com`, senhaHash: 'x', nome: 'Trial' },
      });
      criados.push(usuario.id);
      await prisma.assinatura.create({
        data: { usuarioId: usuario.id, trialFimEm: new Date(Date.now() + 5 * dia) },
      });
      const r = await cancelarAssinatura(usuario.id);
      check('em trial (sem período pago) → recusado', r.cancelada === false && r.motivo === 'sem_periodo_vigente');
    }

    // ── 4. Usuário sem assinatura ──
    {
      const usuario = await prisma.usuario.create({
        data: { email: `cancel-sem-${Date.now()}@exemplo.com`, senhaHash: 'x', nome: 'Sem Assinatura' },
      });
      criados.push(usuario.id);
      const r = await cancelarAssinatura(usuario.id);
      check('sem assinatura → recusado', r.cancelada === false && r.motivo === 'sem_assinatura');
    }

    // ── 5. Cancelado deixa de receber lembrete de renovação ──
    {
      // Vence em 2 dias → dentro da janela de 3 dias do sweep.
      const { usuario } = await cenarioPago('CARTAO', 'lembrete', 2);
      criados.push(usuario.id);

      const antes = await processarLembretesVencimento();
      const contavaAntes = antes.verificadas >= 1;
      check('antes de cancelar, o sweep considera a assinatura', contavaAntes, `verificadas=${antes.verificadas}`);

      // Zera o lembrete para o 2º sweep poder recontar a mesma assinatura.
      await prisma.assinatura.updateMany({ where: { usuarioId: usuario.id }, data: { lembreteEnviadoEm: null } });
      await cancelarAssinatura(usuario.id);

      const depois = await processarLembretesVencimento();
      check('depois de cancelar, o sweep NÃO considera mais', depois.verificadas < antes.verificadas,
        `antes=${antes.verificadas} depois=${depois.verificadas}`);
    }
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
