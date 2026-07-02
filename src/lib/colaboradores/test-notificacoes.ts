/**
 * Self-check do Controle de Integração — status calculado e sweep de notificações.
 * Execução: npx tsx src/lib/colaboradores/test-notificacoes.ts
 */
import prisma from '@/lib/prisma';
import { statusPorData, calcularStatusDocumentos, statusGeralColaborador, diasRestantes } from './status';
import { processarNotificacoesPendentes } from './notificacoes';

let falhas = 0;
function check(nome: string, cond: boolean, detalhe = '') {
  console.log(`${cond ? '✅' : '❌'} ${nome}${detalhe ? ' — ' + detalhe : ''}`);
  if (!cond) falhas++;
}

(async () => {
  const hoje = new Date('2026-07-02T12:00:00Z');

  console.log('── STATUS POR DATA ──');
  check('45 dias restantes → em_dia', statusPorData('2026-08-16', hoje) === 'em_dia');
  check('30 dias restantes → proximo_vencimento (limite)', statusPorData('2026-08-01', hoje) === 'proximo_vencimento');
  check('1 dia restante → proximo_vencimento', statusPorData('2026-07-03', hoje) === 'proximo_vencimento');
  check('0 dias (vence hoje) → proximo_vencimento', statusPorData('2026-07-02', hoje) === 'proximo_vencimento');
  check('-1 dia (venceu ontem) → vencido', statusPorData('2026-07-01', hoje) === 'vencido');
  check('diasRestantes calcula corretamente', diasRestantes('2026-07-17', hoje) === 15);

  console.log('\n── STATUS GERAL DO COLABORADOR ──');
  const ambosEmDia = calcularStatusDocumentos([
    { tipo: 'INTEGRACAO', dataFim: '2027-01-01' }, { tipo: 'ASO', dataFim: '2027-01-01' },
  ], hoje);
  check('Ambos em dia → "Em dia"', statusGeralColaborador(ambosEmDia).label === 'Em dia');

  const integracaoVencida = calcularStatusDocumentos([
    { tipo: 'INTEGRACAO', dataFim: '2026-01-01' }, { tipo: 'ASO', dataFim: '2027-01-01' },
  ], hoje);
  check('Só integração vencida → "Integração vencida"', statusGeralColaborador(integracaoVencida).label === 'Integração vencida');

  const asoVencido = calcularStatusDocumentos([
    { tipo: 'INTEGRACAO', dataFim: '2027-01-01' }, { tipo: 'ASO', dataFim: '2026-01-01' },
  ], hoje);
  check('Só ASO vencido → "ASO vencido"', statusGeralColaborador(asoVencido).label === 'ASO vencido');

  const ambosVencidos = calcularStatusDocumentos([
    { tipo: 'INTEGRACAO', dataFim: '2026-01-01' }, { tipo: 'ASO', dataFim: '2026-01-01' },
  ], hoje);
  check('Ambos vencidos → "Integração e ASO vencidos"', statusGeralColaborador(ambosVencidos).label === 'Integração e ASO vencidos');

  // ── Sweep real (SMTP não configurado neste ambiente) ──────────────────────────
  console.log('\n── SWEEP DE NOTIFICAÇÕES (função real, SMTP não configurado) ──');
  const usuario = await prisma.usuario.findFirst({ where: { email: 'qa-fase14@teste.com' } })
    ?? await prisma.usuario.create({ data: { email: 'qa-fase14@teste.com', senhaHash: 'x', nome: 'Teste' } });

  const colaborador = await prisma.colaborador.create({
    data: {
      nome: 'Teste Sweep QA',
      usuarioId: usuario.id,
      documentos: {
        create: [
          { tipo: 'INTEGRACAO', dataInicio: new Date('2026-01-01'), dataFim: new Date('2026-06-29') }, // vencido há 3 dias
          { tipo: 'ASO',        dataInicio: new Date('2026-01-01'), dataFim: new Date('2027-01-01') }, // em dia
        ],
      },
    },
    include: { documentos: true },
  });

  const resultado = await processarNotificacoesPendentes(hoje);
  check('Sweep verificou ao menos os 2 documentos criados', resultado.documentosVerificados >= 2, String(resultado.documentosVerificados));
  check('Sweep NÃO marca como enviado sem SMTP configurado (resiliência)', resultado.notificacoesEnviadas === 0, String(resultado.notificacoesEnviadas));

  const notifsCriadas = await prisma.notificacaoDocumento.count({
    where: { documentoColaboradorId: { in: colaborador.documentos.map(d => d.id) } },
  });
  check('Nenhum registro de notificação foi criado (nada foi de fato enviado)', notifsCriadas === 0);

  // Rodar de novo não deve gerar erro nem duplicar nada (idempotência do sweep)
  const resultado2 = await processarNotificacoesPendentes(hoje);
  check('Segunda execução do sweep não falha (idempotente)', resultado2.falhas === 0);

  await prisma.colaborador.delete({ where: { id: colaborador.id } });

  console.log(`\n${falhas === 0 ? '🟢 TODOS OS CHECKS PASSARAM' : `🔴 ${falhas} CHECK(S) FALHARAM`}`);
  process.exit(falhas === 0 ? 0 : 1);
})();
