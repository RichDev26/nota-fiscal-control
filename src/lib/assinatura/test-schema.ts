// Verifica que os modelos Assinatura/Cobranca e Usuario.cpfCnpj existem e funcionam.
// Execução: npx tsx src/lib/assinatura/test-schema.ts
import prisma from '@/lib/prisma';

let falhas = 0;
const check = (n: string, ok: boolean, d = '') => { console.log(`${ok ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`); if (!ok) falhas++; };

(async () => {
  const email = `teste-schema-${Date.now()}@exemplo.com`;
  const usuario = await prisma.usuario.create({
    data: { email, senhaHash: 'x', nome: 'Teste Schema', cpfCnpj: '11144477735' },
  });
  check('Usuario criado com cpfCnpj', usuario.cpfCnpj === '11144477735');

  const trialFimEm = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const assinatura = await prisma.assinatura.create({
    data: { usuarioId: usuario.id, trialFimEm },
  });
  check('Assinatura criada com status TRIAL por padrão', assinatura.status === 'TRIAL');
  check('Assinatura vinculada 1:1 ao usuário', assinatura.usuarioId === usuario.id);

  const cobranca = await prisma.cobranca.create({
    data: { assinaturaId: assinatura.id, valor: 49.9, idempotencyKey: `idem-${Date.now()}` },
  });
  check('Cobranca criada com metodo PIX e status PENDENTE por padrão', cobranca.metodo === 'PIX' && cobranca.status === 'PENDENTE');

  // Limpeza
  await prisma.cobranca.delete({ where: { id: cobranca.id } });
  await prisma.assinatura.delete({ where: { id: assinatura.id } });
  await prisma.usuario.delete({ where: { id: usuario.id } });

  console.log(falhas === 0 ? '\n✅ Todos os testes passaram' : `\n❌ ${falhas} teste(s) falharam`);
  process.exit(falhas === 0 ? 0 : 1);
})();
