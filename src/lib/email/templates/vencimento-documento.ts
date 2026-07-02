import { formatarData } from '@/lib/validators';

export interface DadosVencimentoDocumento {
  colaboradorNome: string;
  tipoDocumentoLabel: string; // "Integração" | "ASO"
  dataFim: string | Date;
  diasRestantes: number; // negativo = já venceu
}

/**
 * Template de e-mail para vencimento de documento (Integração/ASO). Layout em
 * tabelas com CSS inline — compatível com os principais clientes de e-mail
 * (Gmail, Outlook) e responsivo em celular (max-width + padding fluido).
 */
export function templateVencimentoDocumento(d: DadosVencimentoDocumento): { subject: string; html: string } {
  const venceu = d.diasRestantes < 0;
  const corDestaque = venceu ? '#dc2626' : d.diasRestantes <= 3 ? '#dc2626' : d.diasRestantes <= 15 ? '#f59e0b' : '#2563eb';
  const bgDestaque   = venceu ? '#fef2f2' : d.diasRestantes <= 3 ? '#fef2f2' : d.diasRestantes <= 15 ? '#fffbeb' : '#eff6ff';

  const tempoTexto = venceu
    ? `Venceu há ${Math.abs(d.diasRestantes)} dia${Math.abs(d.diasRestantes) !== 1 ? 's' : ''}`
    : d.diasRestantes === 0
      ? 'Vence hoje'
      : `Faltam ${d.diasRestantes} dia${d.diasRestantes !== 1 ? 's' : ''}`;

  const subject = venceu
    ? `[Vencido] ${d.tipoDocumentoLabel} de ${d.colaboradorNome}`
    : `[Vencimento próximo] ${d.tipoDocumentoLabel} de ${d.colaboradorNome} — ${tempoTexto.toLowerCase()}`;

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

          <!-- Cabeçalho -->
          <tr>
            <td style="background:#1e3a8a;padding:20px 24px;">
              <span style="color:#ffffff;font-size:15px;font-weight:700;">WorkPro Control</span>
              <br>
              <span style="color:#bfdbfe;font-size:12px;">Controle de Integração</span>
            </td>
          </tr>

          <!-- Corpo -->
          <tr>
            <td style="padding:28px 24px 8px 24px;">
              <p style="margin:0 0 4px 0;color:#6b7280;font-size:13px;">Colaborador</p>
              <p style="margin:0 0 20px 0;color:#111827;font-size:20px;font-weight:700;">${d.colaboradorNome}</p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bgDestaque};border-radius:12px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0 0 2px 0;color:${corDestaque};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.03em;">${d.tipoDocumentoLabel}</p>
                    <p style="margin:0 0 6px 0;color:#111827;font-size:16px;font-weight:700;">${tempoTexto}</p>
                    <p style="margin:0;color:#374151;font-size:13px;">Vencimento: <strong>${formatarData(d.dataFim)}</strong></p>
                  </td>
                </tr>
              </table>

              <p style="margin:20px 0 0 0;color:#374151;font-size:14px;line-height:1.6;">
                ${venceu
                  ? `O documento de <strong>${d.tipoDocumentoLabel}</strong> deste colaborador está <strong>vencido</strong>. Providencie a renovação o quanto antes para regularizar a situação.`
                  : `O documento de <strong>${d.tipoDocumentoLabel}</strong> deste colaborador está próximo do vencimento. Providencie a renovação com antecedência para evitar pendências.`}
              </p>
            </td>
          </tr>

          <!-- Rodapé -->
          <tr>
            <td style="padding:20px 24px 24px 24px;">
              <div style="height:1px;background:#f3f4f6;margin-bottom:16px;"></div>
              <p style="margin:0;color:#9ca3af;font-size:11px;line-height:1.5;">
                Notificação automática do módulo Controle de Integração — WorkPro Control.
                Nenhuma ação é necessária caso a renovação já tenha sido providenciada.
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
