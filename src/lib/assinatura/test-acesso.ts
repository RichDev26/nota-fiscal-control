// Execução: npx tsx src/lib/assinatura/test-acesso.ts
import { temAcessoAtivo, verificarAcessoAssinatura, AssinaturaInativaError } from './acesso';
import prisma from '@/lib/prisma';

let falhas = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? '✅' : '❌'} ${n}`); if (!ok) falhas++; };

(async () => {
  const agora = new Date('2026-07-17T12:00:00Z');
  const dia = 24 * 60 * 60 * 1000;

  // ── temAcessoAtivo: casos puros, sem banco ──
  check('sem assinatura -> sem acesso (fail-closed)', temAcessoAtivo(null, agora) === false);
  check('trial ainda válido -> acesso', temAcessoAtivo({ trialFimEm: new Date(agora.getTime() + dia), periodoFimEm: null }, agora) === true);
  check('trial expirado, sem pagamento -> sem acesso', temAcessoAtivo({ trialFimEm: new Date(agora.getTime() - dia), periodoFimEm: null }, agora) === false);
  check('trial expirado, período pago futuro -> acesso', temAcessoAtivo({ trialFimEm: new Date(agora.getTime() - dia), periodoFimEm: new Date(agora.getTime() + dia) }, agora) === true);
  check('trial expirado, período pago também expirado -> sem acesso', temAcessoAtivo({ trialFimEm: new Date(agora.getTime() - dia), periodoFimEm: new Date(agora.getTime() - dia) }, agora) === false);
  check('trial expira exatamente agora -> sem acesso (borda exclusiva)', temAcessoAtivo({ trialFimEm: agora, periodoFimEm: null }, agora) === false);

  // ── verificarAcessoAssinatura: integração real com o banco ──
  const email = `teste-acesso-${Date.now()}@exemplo.com`;
  const usuario = await prisma.usuario.create({ data: { email, senhaHash: 'x', nome: 'Teste Acesso' } });

  let lancouSemAssinatura = false;
  try { await verificarAcessoAssinatura(usuario.id); } catch (e) { lancouSemAssinatura = e instanceof AssinaturaInativaError; }
  check('usuário sem linha de Assinatura -> AssinaturaInativaError', lancouSemAssinatura);

  await prisma.assinatura.create({ data: { usuarioId: usuario.id, trialFimEm: new Date(Date.now() + dia) } });
  let passouComTrialValido = true;
  try { await verificarAcessoAssinatura(usuario.id); } catch { passouComTrialValido = false; }
  check('usuário com trial válido -> não lança', passouComTrialValido);

  await prisma.usuario.delete({ where: { id: usuario.id } }); // cascade apaga a Assinatura

  console.log(falhas === 0 ? '\n✅ Todos os testes passaram' : `\n❌ ${falhas} teste(s) falharam`);
  process.exit(falhas === 0 ? 0 : 1);
})();
