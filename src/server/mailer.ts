import nodemailer from 'nodemailer';
import { execute, getResolvedSettingsMap } from './db.ts';

const SMTP_SEND_TIMEOUT_MS = 18000;

export interface MovementEmailPayload {
  logId: number;
  fullName: string;
  documentId: string;
  roleDepartment: string;
  movementType: 'Entrada' | 'Salida';
  localDate: string;
  localTime: string;
}

function buildTransporter(settings: Record<string, string>) {
  const host = (settings.smtp_host || '').trim();
  const port = Number(settings.smtp_port || '587');
  const secure = settings.smtp_secure === 'true';
  const user = (settings.smtp_user || '').trim();
  const pass = settings.smtp_pass || '';

  if (!host) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port: Number.isFinite(port) && port > 0 ? port : 587,
    secure,
    auth: user ? { user, pass } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function dispatchMovementEmailAsync(payload: MovementEmailPayload): void {
  setImmediate(async () => {
    let transporter: ReturnType<typeof buildTransporter> = null;
    try {
      const settings = await getResolvedSettingsMap();
      const enabled = settings.email_alerts_enabled === 'true';
      const adminEmail = (settings.admin_email || '').trim();

      if (!enabled || !adminEmail || !settings.smtp_host?.trim()) {
        await execute(
          'UPDATE attendance_logs SET email_status = $1, email_error = NULL WHERE id = $2',
          ['skipped', payload.logId]
        );
        return;
      }

      transporter = buildTransporter(settings);
      if (!transporter) {
        await execute(
          'UPDATE attendance_logs SET email_status = $1, email_error = $2 WHERE id = $3',
          ['failed', 'Servidor SMTP no configurado.', payload.logId]
        );
        return;
      }

      const orgName = settings.organization_name || 'ControlQR';
      const fromAddress =
        (settings.smtp_from || '').trim() ||
        (settings.smtp_user || '').trim() ||
        `no-reply@controlqr.local`;

      const actionColor = payload.movementType === 'Entrada' ? '#16A34A' : '#0284C7';
      const subject = `[${orgName}] ${payload.movementType}: ${payload.fullName} (${payload.localTime})`;

      const textBody = [
        `Registro de ${payload.movementType}`,
        `Organización: ${orgName}`,
        `Persona: ${payload.fullName}`,
        `Documento / ID: ${payload.documentId}`,
        `Cargo / Departamento: ${payload.roleDepartment}`,
        `Tipo de movimiento: ${payload.movementType}`,
        `Fecha: ${payload.localDate}`,
        `Hora exacta: ${payload.localTime}`,
      ].join('\n');

      const htmlBody = `
        <div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; background: #ffffff;">
          <div style="background: #0f172a; color: #ffffff; padding: 18px 24px;">
            <div style="font-size: 13px; color: #94a3b8; margin-bottom: 4px;">${orgName}</div>
            <div style="font-size: 18px; font-weight: 700;">Alerta de Control de Asistencia</div>
          </div>
          <div style="padding: 24px;">
            <div style="display: inline-block; padding: 6px 12px; border-radius: 6px; background: ${actionColor}; color: #ffffff; font-weight: 700; font-size: 14px; margin-bottom: 16px;">
              ${payload.movementType.toUpperCase()} REGISTRADA
            </div>
            <table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #1e293b;">
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9; color: #64748b; width: 42%;">Personal</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9; font-weight: 600;">${payload.fullName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9; color: #64748b;">Documento / ID</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9; font-family: monospace;">${payload.documentId}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9; color: #64748b;">Cargo / Depto.</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9;">${payload.roleDepartment}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9; color: #64748b;">Tipo de movimiento</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9; font-weight: 600;">${payload.movementType}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9; color: #64748b;">Fecha</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9; font-family: monospace;">${payload.localDate}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b;">Hora exacta</td>
                <td style="padding: 8px 0; font-family: monospace; font-weight: 600;">${payload.localTime}</td>
              </tr>
            </table>
          </div>
        </div>
      `;

      await withTimeout(
        transporter.sendMail({
          from: fromAddress,
          to: adminEmail,
          subject,
          text: textBody,
          html: htmlBody,
        }),
        SMTP_SEND_TIMEOUT_MS,
        'Tiempo de espera agotado al conectar con el servidor SMTP.'
      );

      await execute(
        'UPDATE attendance_logs SET email_status = $1, email_error = NULL WHERE id = $2',
        ['sent', payload.logId]
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error desconocido al enviar correo';
      try {
        await execute(
          'UPDATE attendance_logs SET email_status = $1, email_error = $2 WHERE id = $3',
          ['failed', errorMessage.slice(0, 300), payload.logId]
        );
      } catch {
        // Never allow background DB logging failures to crash the server
      }
    } finally {
      transporter?.close();
    }
  });
}

export async function sendTestEmail(overrideSettings?: Record<string, string>): Promise<void> {
  const resolved = await getResolvedSettingsMap();
  const settings = { ...resolved, ...(overrideSettings || {}) };
  const adminEmail = (settings.admin_email || '').trim();

  if (!adminEmail) {
    throw new Error('Debe indicar el correo electrónico del administrador.');
  }
  if (!settings.smtp_host?.trim()) {
    throw new Error('Debe configurar el servidor SMTP (Host).');
  }

  const transporter = buildTransporter(settings);
  if (!transporter) {
    throw new Error('Configuración SMTP incompleta.');
  }

  const orgName = settings.organization_name || 'ControlQR';
  const fromAddress =
    (settings.smtp_from || '').trim() ||
    (settings.smtp_user || '').trim() ||
    `no-reply@controlqr.local`;

  try {
    await withTimeout(
      transporter.verify(),
      SMTP_SEND_TIMEOUT_MS,
      'Tiempo de espera agotado al verificar el servidor SMTP.'
    );
    await withTimeout(
      transporter.sendMail({
        from: fromAddress,
        to: adminEmail,
        subject: `[${orgName}] Prueba de notificaciones SMTP exitosa`,
        text: `Esta es una notificación de prueba enviada desde ${orgName}. Las alertas automáticas de entrada y salida están operativas.`,
        html: `<p>Esta es una notificación de prueba enviada desde <strong>${orgName}</strong>.</p><p>Las alertas automáticas de entrada y salida por código QR están operativas.</p>`,
      }),
      SMTP_SEND_TIMEOUT_MS,
      'Tiempo de espera agotado al enviar el correo de prueba.'
    );
  } finally {
    transporter.close();
  }
}
