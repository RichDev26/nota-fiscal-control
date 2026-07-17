/**
 * Backfill único: cria Assinatura para todo Usuario que ainda não tem uma.
 * trialFimEm = usuario.criadoEm + 7 dias — contas com mais de 7 dias de vida
 * ficam bloqueadas imediatamente (temAcessoAtivo calcula isso sozinho).
 *
 * Execução: npx tsx scripts/backfill-assinaturas.ts
 */
import prisma from '../src/lib/prisma';
import { criarAssinaturaTrial } from '../src/lib/assinatura/servico';
import { temAcessoAtivo } from '../src/lib/assinatura/acesso';

(async () => {
  const usuariosSemAssinatura = await prisma.usuario.findMany({
    where: { assinatura: { is: null } },
    select: { id: true, email: true, criadoEm: true },
  });

  console.log(`Encontrados ${usuariosSemAssinatura.length} usuário(s) sem Assinatura.`);

  let bloqueados = 0;
  let dentroTrial = 0;

  for (const u of usuariosSemAssinatura) {
    const assinatura = await criarAssinaturaTrial(u.id, u.criadoEm);
    const ativo = temAcessoAtivo(assinatura);
    if (ativo) dentroTrial++; else bloqueados++;
    console.log(`  ${ativo ? '🟢' : '🔴'} ${u.email} — criado em ${u.criadoEm.toISOString()} — ${ativo ? 'ainda dentro do trial' : 'bloqueado (mais de 7 dias)'}`);
  }

  console.log(`\nConcluído: ${dentroTrial} ainda dentro do trial, ${bloqueados} bloqueados imediatamente.`);
  process.exit(0);
})();
