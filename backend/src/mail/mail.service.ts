import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter | null;

  constructor(private readonly config: ConfigService) {
    const host = config.get<string>('SMTP_HOST');
    if (!host) {
      this.logger.warn('SMTP_HOST no configurado — el envío de correos está desactivado');
      this.transporter = null;
      return;
    }
    this.transporter = nodemailer.createTransport({
      host,
      port: Number(config.get<string>('SMTP_PORT') ?? '587'),
      secure: config.get<string>('SMTP_SECURE') === 'true',
      auth: {
        user: config.get<string>('SMTP_USER'),
        pass: config.get<string>('SMTP_PASSWORD'),
      },
    });
  }

  async sendPasswordReset(to: string, name: string, resetLink: string): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(`[MAIL DESACTIVADO] Se habría enviado un email de recuperación a ${to}`);
      return;
    }
    const from = `"${this.config.get<string>('MAIL_FROM_NAME') ?? 'LOGICONTROL PRO'}" <${this.config.get<string>('MAIL_FROM') ?? 'noreply@logicontrol.pro'}>`;
    await this.transporter.sendMail({
      from,
      to,
      subject: 'Restablecer contraseña — LOGICONTROL PRO',
      html: this.buildResetEmail(name, resetLink),
    });
  }

  private buildResetEmail(name: string, resetLink: string): string {
    return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>Restablecer contraseña</title></head>
<body style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:20px;color:#1e293b;background:#f8fafc">
  <div style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">
    <div style="background:#1d4ed8;padding:24px 32px">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700">LOGICONTROL PRO</h1>
    </div>
    <div style="padding:32px">
      <p style="margin:0 0 16px">Hola <strong>${name}</strong>,</p>
      <p style="margin:0 0 16px;color:#475569">Recibimos una solicitud para restablecer la contraseña de tu cuenta.</p>
      <p style="margin:0 0 28px;color:#475569">Hacé clic en el botón para crear una nueva contraseña. El enlace expira en <strong>30 minutos</strong>.</p>
      <div style="text-align:center;margin-bottom:28px">
        <a href="${resetLink}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">
          Restablecer contraseña
        </a>
      </div>
      <p style="margin:0 0 8px;font-size:13px;color:#64748b">Si el botón no funciona, copiá este enlace:</p>
      <p style="margin:0 0 24px;font-size:12px;color:#94a3b8;word-break:break-all">${resetLink}</p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 20px">
      <p style="margin:0;font-size:12px;color:#94a3b8">Si no solicitaste restablecer tu contraseña, ignorá este correo. Tu cuenta no fue modificada.</p>
    </div>
  </div>
</body>
</html>`;
  }
}
