/**
 * Teste de envio real de e-mail.
 *
 *   npx tsx scripts/testar-email.ts destino@exemplo.com
 *
 * Faz, nesta ordem: mostra a config resolvida (com segredos mascarados),
 * aponta problemas de domínio no SMTP_FROM, testa conexão+autenticação sem
 * gastar envio, e só então manda um e-mail de verdade pelo MESMO caminho que
 * o app usa em produção (enviarEmail), para que o teste prove o caminho real.
 */
import { enviarEmail, verificarSmtp } from '../src/lib/email/mailer';

const destino = process.argv[2];
if (!destino || !destino.includes('@')) {
  console.error('Uso: npx tsx scripts/testar-email.ts destino@exemplo.com');
  process.exit(2);
}

/** Extrai o endereço de um From no formato `Nome <a@b.com>` ou `a@b.com`. */
function enderecoDe(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim();
}
const dominioDe = (email: string) => email.split('@')[1]?.toLowerCase() ?? '';
const mascarar = (v?: string) => (v ? v.slice(0, 2) + '***' + v.slice(-2) : '(vazio)');

(async () => {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  const porta = Number(SMTP_PORT) || 587;
  const fromEfetivo = SMTP_FROM || SMTP_USER || '';

  console.log('\n── Configuração ──────────────────────────────');
  console.log(`  SMTP_HOST  ${SMTP_HOST || '(vazio)'}`);
  console.log(`  SMTP_PORT  ${porta}  ${porta === 465 ? '(TLS implícito)' : porta === 587 ? '(STARTTLS)' : '(porta incomum)'}`);
  console.log(`  SMTP_USER  ${SMTP_USER || '(vazio)'}`);
  console.log(`  SMTP_PASS  ${mascarar(SMTP_PASS)}`);
  console.log(`  SMTP_FROM  ${SMTP_FROM || `(vazio → usa SMTP_USER: ${SMTP_USER || '—'})`}`);

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.error('\n❌ SMTP não configurado. Defina SMTP_HOST, SMTP_USER e SMTP_PASS.');
    console.error('   Em produção elas vivem no Railway; localmente, no .env.');
    process.exit(1);
  }

  // Avisos de domínio: causa nº 1 de e-mail rejeitado ou marcado como spam.
  const dominioFrom = dominioDe(enderecoDe(fromEfetivo));
  const dominioUser = dominioDe(SMTP_USER);
  console.log('\n── Checagem de domínio ───────────────────────');
  console.log(`  domínio do From: ${dominioFrom || '(indefinido)'}`);
  if (SMTP_FROM && !/<[^>]+@[^>]+>/.test(SMTP_FROM) && !SMTP_FROM.includes('@')) {
    console.log('  ⚠️  SMTP_FROM não contém endereço. Use: Nome <conta@dominio>');
  }
  if (dominioFrom && dominioUser && dominioFrom !== dominioUser) {
    console.log(`  ⚠️  From (${dominioFrom}) ≠ domínio da conta SMTP (${dominioUser}).`);
    console.log('     Só funciona se o provedor autorizar esse domínio (SPF/DKIM publicados');
    console.log('     e domínio verificado). Caso contrário: rejeição ou spam.');
  } else if (dominioFrom) {
    console.log('  ✅ From usa o mesmo domínio da conta autenticada.');
  }

  console.log('\n── Conexão e autenticação (sem enviar) ───────');
  const v = await verificarSmtp();
  if (!v.ok) {
    console.error(`  ❌ Falhou: ${v.motivo === 'sem_configuracao' ? 'sem configuração' : v.erro}`);
    const e = (('erro' in v && v.erro) || '').toLowerCase();
    if (e.includes('auth') || e.includes('535') || e.includes('credentials'))
      console.error('     → Usuário/senha recusados. Em Gmail/Outlook use SENHA DE APP, não a senha da conta.');
    else if (e.includes('enotfound') || e.includes('eai_again'))
      console.error(`     → O host "${SMTP_HOST}" não existe no DNS. Confira o SMTP_HOST no painel do provedor.`);
    else if (e.includes('timeout') || e.includes('econnrefused'))
      console.error(`     → Sem resposta em ${SMTP_HOST}:${porta}. Confira host/porta, ou firewall bloqueando saída.`);
    else if (e.includes('self signed') || e.includes('certificate'))
      console.error('     → Problema de certificado TLS no servidor SMTP.');
    else if (e.includes('wrong version number'))
      console.error('     → Porta e modo TLS incompatíveis: 465 é TLS direto, 587 é STARTTLS. Troque a porta.');
    process.exit(1);
  }
  console.log('  ✅ Conectou e autenticou.');

  console.log('\n── Envio real ────────────────────────────────');
  console.log(`  destinatário: ${destino}`);
  const carimbo = new Date().toISOString();
  try {
    const r = await enviarEmail({
      to: destino,
      subject: `Teste de envio — WorkPro Control (${carimbo})`,
      html: `<p>Se você está lendo isto, o envio de e-mail está funcionando.</p>
             <p>Remetente configurado: <strong>${fromEfetivo}</strong><br>
             Servidor: ${SMTP_HOST}:${porta}<br>
             Enviado em: ${carimbo}</p>`,
    });
    if (!r.enviado) {
      console.error('  ❌ enviarEmail() retornou enviado=false (SMTP não configurado).');
      process.exit(1);
    }
    console.log('  ✅ Servidor SMTP ACEITOU a mensagem.');
    console.log('\n⚠️  Aceito ≠ entregue. Confira agora a caixa do destinatário,');
    console.log('    INCLUSIVE a pasta de spam. Se caiu em spam, faltam SPF/DKIM/DMARC');
    console.log('    no DNS do domínio do From.');
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`  ❌ Recusado no envio: ${msg}`);
    const m = msg.toLowerCase();
    if (m.includes('550') || m.includes('553') || m.includes('not allowed') || m.includes('sender')) {
      console.error('     → O provedor recusou o REMETENTE. O domínio do SMTP_FROM não está');
      console.error('       verificado/autorizado nessa conta. Verifique o domínio no painel do provedor.');
    } else if (m.includes('554') || m.includes('spam')) {
      console.error('     → Recusado por reputação/antispam. Publique SPF, DKIM e DMARC.');
    }
    process.exit(1);
  }
})();
