import { formatarData } from '@/lib/validators';
import { VALOR_ASSINATURA_FORMATADO } from '@/lib/assinatura/config';

export interface DadosAssinaturaVencendo {
  nome: string;
  dataVencimento: Date;
}

/** Mesmo padrão de layout de src/lib/email/templates/vencimento-documento.ts. */
export function templateAssinaturaVencendo(d: DadosAssinaturaVencendo): { subject: string; html: string } {
  const subject = 'Sua assinatura do WorkPro Control vence em breve';

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

          <tr>
            <td style="background:#1e3a8a;padding:20px 24px;">
              <span style="color:#ffffff;font-size:15px;font-weight:700;">WorkPro Control</span>
              <br>
              <span style="color:#bfdbfe;font-size:12px;">Assinatura</span>
            </td>
          </tr>

          <tr>
            <td style="padding:28px 24px;">
              <p style="margin:0 0 12px 0;color:#111827;font-size:18px;font-weight:700;">Olá, ${d.nome.split(' ')[0]}!</p>
              <p style="margin:0 0 20px 0;color:#374151;font-size:14px;line-height:1.6;">
                Sua assinatura vence em <strong>${formatarData(d.dataVencimento)}</strong>. Para continuar usando o
                WorkPro Control sem interrupção, renove seu plano (${VALOR_ASSINATURA_FORMATADO}/mês via PIX) antes dessa data.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:0 24px 24px 24px;">
              <div style="height:1px;background:#f3f4f6;margin-bottom:16px;"></div>
              <p style="margin:0;color:#9ca3af;font-size:11px;line-height:1.5;">
                Notificação automática do WorkPro Control. Se já renovou, ignore este e-mail.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html };
}
