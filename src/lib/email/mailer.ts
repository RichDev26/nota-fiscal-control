/**
 * Envio de e-mail via SMTP (nodemailer). Não existia nenhum serviço de e-mail
 * no projeto — este é o único componente genuinamente novo desta camada.
 *
 * Configuração via variáveis de ambiente (ver .env.example): SMTP_HOST, SMTP_PORT,
 * SMTP_USER, SMTP_PASS, SMTP_FROM. Se não configurado, enviarEmail() loga e
 * retorna sem lançar erro — não derruba o sweep de notificações em dev/sem SMTP.
 */
import nodemailer from 'nodemailer';
import { logInfo, logError, logWarn } from '@/lib/extractors/logger';

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;
let avisouSemConfig = false;

function getTransporter() {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
}

/**
 * Testa a conexão e a autenticação SMTP sem enviar nada. Existe porque a causa
 * mais comum de e-mail que "não chega" é credencial/porta errada, e isso dá
 * para descobrir sem gastar um envio. Reaproveita exatamente o mesmo
 * transporter do envio real — testar um caminho diferente do de produção não
 * provaria nada.
 */
export async function verificarSmtp(): Promise<
  { ok: true } | { ok: false; motivo: 'sem_configuracao' | 'falha'; erro?: string }
> {
  const t = getTransporter();
  if (!t) return { ok: false, motivo: 'sem_configuracao' };
  try {
    await t.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, motivo: 'falha', erro: (err as Error).message };
  }
}

export interface EnviarEmailInput {
  to: string;
  subject: string;
  html: string;
}

export async function enviarEmail(input: EnviarEmailInput): Promise<{ enviado: boolean }> {
  const t = getTransporter();
  if (!t) {
    if (!avisouSemConfig) {
      logWarn('mailer', 'SMTP não configurado (SMTP_HOST/SMTP_USER/SMTP_PASS) — e-mails não serão enviados.');
      avisouSemConfig = true;
    }
    return { enviado: false };
  }

  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: input.to,
      subject: input.subject,
      html: input.html,
    });
    logInfo('mailer', `E-mail enviado para ${input.to}`, { subject: input.subject });
    return { enviado: true };
  } catch (err) {
    logError('mailer', `Falha ao enviar e-mail para ${input.to}`, err as Error);
    throw err; // propaga: o chamador decide se marca a notificação como enviada
  }
}
