import dns from 'node:dns';
import net from 'node:net';
import nodemailer from 'nodemailer';
import { execute, getResolvedSettingsMap } from './db.ts';

const SMTP_SEND_TIMEOUT_MS = 18000;
const HTTP_API_TIMEOUT_MS = 15000;

export interface MovementEmailPayload {
  logId: number;
  fullName: string;
  documentId: string;
  roleDepartment: string;
  movementType: 'Entrada' | 'Salida';
  localDate: string;
  localTime: string;
}

export type EmailProvider = 'smtp' | 'brevo' | 'resend';

export function getEmailProvider(settings: Record<string, string>): EmailProvider {
  if (settings.email_provider === 'brevo') return 'brevo';
  if (settings.email_provider === 'resend') return 'resend';
  return 'smtp';
}

async function resolveIpv4Host(hostname: string): Promise<string> {
  if (!hostname || net.isIP(hostname) !== 0) {
    return hostname;
  }
  try {
    const resolved = await dns.promises.lookup(hostname, { family: 4 });
    return resolved.address || hostname;
  } catch {
    return hostname;
  }
}

async function buildTransporter(settings: Record<string, string>) {
  const rawHost = (settings.smtp_host || '').trim();
  const rawPort = Number(settings.smtp_port || '587');
  const port = Number.isFinite(rawPort) && rawPort > 0 ? rawPort : 587;
  // Auto-align TLS mode with standard ports to prevent handshake timeouts
  const secure =
    port === 465
      ? true
      : port === 2587 || port === 587 || port === 2525 || port === 25
      ? false
      : settings.smtp_secure === 'true';
  const user = (settings.smtp_user || '').trim();
  const pass = settings.smtp_pass || '';

  if (!rawHost) {
    return null;
  }

  const connectHost = await resolveIpv4Host(rawHost);

  return nodemailer.createTransport({
    host: connectHost,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
    tls: {
      servername: rawHost,
      minVersion: 'TLSv1.2',
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

function formatSmtpError(err: unknown, host: string, port: number): Error {
  const msg = err instanceof Error ? err.message : 'Error desconocido al conectar por SMTP.';
  const isTimeout = /timeout|etimedout|tiempo de espera/i.test(msg);
  if (isTimeout && (port === 25 || port === 465 || port === 587)) {
    return new Error(
      `Connection timeout hacia ${host}:${port}. Render Free y algunos hostings bloquean los puertos SMTP 25, 465 y 587. Cambia el Método de envío a "API HTTPS · Brevo" o "API HTTPS · Resend", o usa un SMTP en puerto 2525.`
    );
  }
  return err instanceof Error ? err : new Error(msg);
}

function parseFromHeader(fromAddress: string, fallbackName: string): { name: string; email: string } {
  const trimmed = fromAddress.trim();
  const match = trimmed.match(/^(.*?)\s*<([^<>@\s]+@[^<>@\s]+)>$/);
  if (match) {
    return {
      name: match[1].replace(/^["']|["']$/g, '').trim() || fallbackName,
      email: match[2].trim(),
    };
  }
  return { name: fallbackName, email: trimmed };
}

async function sendViaResend(params: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_API_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: params.from,
        to: [params.to],
        subject: params.subject,
        text: params.text,
        html: params.html,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { message?: string; error?: string };
        detail = body.message || body.error || detail;
      } catch {
        // ignore json parse failure
      }
      throw new Error(`Resend API error: ${detail}`);
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Tiempo de espera agotado al conectar con Resend API.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function sendViaBrevo(params: {
  apiKey: string;
  from: string;
  orgName: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  const sender = parseFromHeader(params.from, params.orgName);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_API_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': params.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        sender,
        to: [{ email: params.to }],
        subject: params.subject,
        textContent: params.text,
        htmlContent: params.html,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { message?: string; code?: string };
        detail = body.message || body.code || detail;
      } catch {
        // ignore json parse failure
      }
      throw new Error(`Brevo API error: ${detail}`);
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Tiempo de espera agotado al conectar con Brevo API.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
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

export interface NotificationRulesConfig {
  departmentScope: 'all' | 'selected';
  allowedDepartments: string[];
  eventMode: 'all' | 'incidents_only' | 'custom';
  notifyOnEntry: boolean;
  notifyOnExit: boolean;
  notifyOnLateEntry: boolean;
  notifyOnEarlyExit: boolean;
  workStartTime: string;
  lateGraceMinutes: number;
  workEndTime: string;
  earlyGraceMinutes: number;
}

export const DEFAULT_NOTIFICATION_RULES: NotificationRulesConfig = {
  departmentScope: 'all',
  allowedDepartments: [],
  eventMode: 'all',
  notifyOnEntry: true,
  notifyOnExit: true,
  notifyOnLateEntry: true,
  notifyOnEarlyExit: true,
  workStartTime: '09:00',
  lateGraceMinutes: 10,
  workEndTime: '17:00',
  earlyGraceMinutes: 10,
};

function normalizeTimeHHMM(val: unknown, fallback: string): string {
  if (typeof val !== 'string') return fallback;
  const trimmed = val.trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(trimmed) ? trimmed : fallback;
}

export function parseNotificationRules(raw: unknown): NotificationRulesConfig {
  let obj: Record<string, unknown> = {};
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        obj = parsed as Record<string, unknown>;
      }
    } catch {
      obj = {};
    }
  } else if (raw && typeof raw === 'object') {
    obj = raw as Record<string, unknown>;
  }

  const departmentScope = obj.departmentScope === 'selected' ? 'selected' : 'all';
  const allowedDepartments = Array.isArray(obj.allowedDepartments)
    ? Array.from(
        new Set(
          obj.allowedDepartments
            .filter((d): d is string => typeof d === 'string')
            .map((d) => d.trim())
            .filter(Boolean)
        )
      )
    : [];

  const eventMode =
    obj.eventMode === 'incidents_only' || obj.eventMode === 'custom'
      ? obj.eventMode
      : 'all';

  const lateGrace = Number(obj.lateGraceMinutes);
  const earlyGrace = Number(obj.earlyGraceMinutes);

  return {
    departmentScope,
    allowedDepartments,
    eventMode,
    notifyOnEntry: obj.notifyOnEntry !== false,
    notifyOnExit: obj.notifyOnExit !== false,
    notifyOnLateEntry: obj.notifyOnLateEntry !== false,
    notifyOnEarlyExit: obj.notifyOnEarlyExit !== false,
    workStartTime: normalizeTimeHHMM(obj.workStartTime, DEFAULT_NOTIFICATION_RULES.workStartTime),
    lateGraceMinutes:
      Number.isFinite(lateGrace) && lateGrace >= 0 && lateGrace <= 180 ? Math.round(lateGrace) : 10,
    workEndTime: normalizeTimeHHMM(obj.workEndTime, DEFAULT_NOTIFICATION_RULES.workEndTime),
    earlyGraceMinutes:
      Number.isFinite(earlyGrace) && earlyGrace >= 0 && earlyGrace <= 180 ? Math.round(earlyGrace) : 10,
  };
}

function timeStringToSeconds(timeStr: string): number {
  const parts = timeStr.split(':').map((n) => Number(n));
  const hh = Number.isFinite(parts[0]) ? parts[0] : 0;
  const mm = Number.isFinite(parts[1]) ? parts[1] : 0;
  const ss = Number.isFinite(parts[2]) ? parts[2] : 0;
  return hh * 3600 + mm * 60 + ss;
}

export interface NotificationEvaluation {
  shouldNotify: boolean;
  skipReason: string | null;
  incidentType: 'Retardo' | 'Salida temprana' | null;
  incidentDetail: string | null;
}

export function evaluateMovementNotification(
  settings: Record<string, string>,
  payload: {
    roleDepartment: string;
    movementType: 'Entrada' | 'Salida';
    localTime: string;
  }
): NotificationEvaluation {
  const rules = parseNotificationRules(settings.notification_rules);
  const scanSeconds = timeStringToSeconds(payload.localTime);
  const startSeconds = timeStringToSeconds(`${rules.workStartTime}:00`);
  const endSeconds = timeStringToSeconds(`${rules.workEndTime}:00`);

  const lateCutoffSeconds = startSeconds + rules.lateGraceMinutes * 60 + 59;
  const earlyCutoffSeconds = Math.max(0, endSeconds - rules.earlyGraceMinutes * 60);

  let incidentType: 'Retardo' | 'Salida temprana' | null = null;
  let incidentDetail: string | null = null;

  if (payload.movementType === 'Entrada' && scanSeconds > lateCutoffSeconds) {
    const lateMins = Math.max(1, Math.floor((scanSeconds - startSeconds) / 60));
    incidentType = 'Retardo';
    incidentDetail = `Retardo de ${lateMins} min (límite ${rules.workStartTime}, tolerancia ${rules.lateGraceMinutes} min)`;
  } else if (payload.movementType === 'Salida' && scanSeconds < earlyCutoffSeconds) {
    const earlyMins = Math.max(1, Math.ceil((endSeconds - scanSeconds) / 60));
    incidentType = 'Salida temprana';
    incidentDetail = `Salida ${earlyMins} min antes de jornada (${rules.workEndTime}, margen ${rules.earlyGraceMinutes} min)`;
  }

  const enabled = settings.email_alerts_enabled === 'true';
  const adminEmail = (settings.admin_email || '').trim();
  const provider = getEmailProvider(settings);
  const hasTransportCreds =
    provider === 'smtp'
      ? Boolean(settings.smtp_host?.trim())
      : Boolean(settings.email_api_key?.trim());

  if (!enabled || !adminEmail || !hasTransportCreds) {
    return {
      shouldNotify: false,
      skipReason: null,
      incidentType,
      incidentDetail,
    };
  }

  // 1. Department filter
  if (rules.departmentScope === 'selected') {
    const deptNorm = payload.roleDepartment.trim().toLowerCase();
    const allowedSet = new Set(rules.allowedDepartments.map((d) => d.trim().toLowerCase()));
    if (!allowedSet.has(deptNorm)) {
      return {
        shouldNotify: false,
        skipReason: `Omitido por regla de depto. (${payload.roleDepartment})`,
        incidentType,
        incidentDetail,
      };
    }
  }

  // 2. Movement / Incident filter
  if (rules.eventMode === 'incidents_only') {
    const matchedIncident =
      (incidentType === 'Retardo' && rules.notifyOnLateEntry) ||
      (incidentType === 'Salida temprana' && rules.notifyOnEarlyExit);
    if (!matchedIncident) {
      return {
        shouldNotify: false,
        skipReason: 'Omitido: solo incidencias activado',
        incidentType,
        incidentDetail,
      };
    }
  } else if (rules.eventMode === 'custom') {
    let matchedCustom = false;
    if (payload.movementType === 'Entrada') {
      matchedCustom = incidentType === 'Retardo' ? rules.notifyOnLateEntry : rules.notifyOnEntry;
    } else {
      matchedCustom =
        incidentType === 'Salida temprana' ? rules.notifyOnEarlyExit : rules.notifyOnExit;
    }
    if (!matchedCustom) {
      return {
        shouldNotify: false,
        skipReason: `Omitido por regla personalizada (${incidentType || payload.movementType})`,
        incidentType,
        incidentDetail,
      };
    }
  }

  return {
    shouldNotify: true,
    skipReason: null,
    incidentType,
    incidentDetail,
  };
}

export function dispatchMovementEmailAsync(payload: MovementEmailPayload): void {
  setImmediate(async () => {
    let transporter: Awaited<ReturnType<typeof buildTransporter>> = null;
    try {
      const settings = await getResolvedSettingsMap();
      const adminEmail = (settings.admin_email || '').trim();
      const provider = getEmailProvider(settings);
      const evaluation = evaluateMovementNotification(settings, {
        roleDepartment: payload.roleDepartment,
        movementType: payload.movementType,
        localTime: payload.localTime,
      });

      if (!evaluation.shouldNotify) {
        await execute(
          'UPDATE attendance_logs SET email_status = $1, email_error = $2 WHERE id = $3',
          ['skipped', evaluation.skipReason, payload.logId]
        );
        return;
      }

      if (provider === 'smtp') {
        transporter = await buildTransporter(settings);
        if (!transporter) {
          await execute(
            'UPDATE attendance_logs SET email_status = $1, email_error = $2 WHERE id = $3',
            ['failed', 'Servidor SMTP no configurado.', payload.logId]
          );
          return;
        }
      } else if (!settings.email_api_key?.trim()) {
        await execute(
          'UPDATE attendance_logs SET email_status = $1, email_error = $2 WHERE id = $3',
          ['failed', `API Key de ${provider} no configurada.`, payload.logId]
        );
        return;
      }

      const orgName = settings.organization_name || 'ControlQR';
      const fromAddress =
        (settings.smtp_from || '').trim() ||
        (settings.smtp_user || '').trim() ||
        `no-reply@controlqr.local`;

      const actionColor = evaluation.incidentType
        ? '#D97706'
        : payload.movementType === 'Entrada'
        ? '#16A34A'
        : '#0284C7';

      const subjectPrefix = evaluation.incidentType
        ? `${evaluation.incidentType.toUpperCase()} · ${payload.movementType}`
        : payload.movementType;
      const subject = `[${orgName}] ${subjectPrefix}: ${payload.fullName} (${payload.localTime})`;

      const textLines = [
        `Registro de ${payload.movementType}`,
        `Organización: ${orgName}`,
        `Persona: ${payload.fullName}`,
        `Documento / ID: ${payload.documentId}`,
        `Cargo / Departamento: ${payload.roleDepartment}`,
        `Tipo de movimiento: ${payload.movementType}`,
        `Fecha: ${payload.localDate}`,
        `Hora exacta: ${payload.localTime}`,
      ];
      if (evaluation.incidentDetail) {
        textLines.push(`Incidencia detectada: ${evaluation.incidentDetail}`);
      }
      const textBody = textLines.join('\n');

      const incidentRowHtml = evaluation.incidentDetail
        ? `<tr>
            <td style="padding: 8px 0; border-top: 1px solid #f1f5f9; color: #b45309; font-weight: 600;">Incidencia</td>
            <td style="padding: 8px 0; border-top: 1px solid #f1f5f9; color: #b45309; font-weight: 600;">${evaluation.incidentDetail}</td>
          </tr>`
        : '';

      const htmlBody = `
        <div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; background: #ffffff;">
          <div style="background: #0f172a; color: #ffffff; padding: 18px 24px;">
            <div style="font-size: 13px; color: #94a3b8; margin-bottom: 4px;">${orgName}</div>
            <div style="font-size: 18px; font-weight: 700;">Alerta de Control de Asistencia</div>
          </div>
          <div style="padding: 24px;">
            <div style="display: inline-block; padding: 6px 12px; border-radius: 6px; background: ${actionColor}; color: #ffffff; font-weight: 700; font-size: 14px; margin-bottom: 16px;">
              ${evaluation.incidentType ? `${evaluation.incidentType.toUpperCase()} · ` : ''}${payload.movementType.toUpperCase()} REGISTRADA
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
              ${incidentRowHtml}
            </table>
          </div>
        </div>
      `;

      if (provider === 'brevo') {
        const brevoFrom =
          (settings.smtp_from || '').trim() ||
          (settings.smtp_user || '').trim() ||
          adminEmail;
        await sendViaBrevo({
          apiKey: settings.email_api_key.trim(),
          from: brevoFrom,
          orgName,
          to: adminEmail,
          subject,
          text: textBody,
          html: htmlBody,
        });
      } else if (provider === 'resend') {
        const resendFrom =
          (settings.smtp_from || '').trim() || `${orgName} <onboarding@resend.dev>`;
        await sendViaResend({
          apiKey: settings.email_api_key.trim(),
          from: resendFrom,
          to: adminEmail,
          subject,
          text: textBody,
          html: htmlBody,
        });
      } else if (transporter) {
        const host = (settings.smtp_host || '').trim();
        const port = Number(settings.smtp_port || '587') || 587;
        try {
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
        } catch (smtpErr) {
          throw formatSmtpError(smtpErr, host, port);
        }
      }

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
  const provider = getEmailProvider(settings);

  if (!adminEmail) {
    throw new Error('Debe indicar el correo electrónico del administrador.');
  }

  const orgName = settings.organization_name || 'ControlQR';
  const subject = `[${orgName}] Prueba de notificaciones exitosa`;
  const text = `Esta es una notificación de prueba enviada desde ${orgName}. Las alertas automáticas de entrada y salida están operativas.`;
  const html = `<p>Esta es una notificación de prueba enviada desde <strong>${orgName}</strong>.</p><p>Las alertas automáticas de entrada y salida por código QR están operativas.</p>`;

  if (provider === 'brevo') {
    const apiKey = (settings.email_api_key || '').trim();
    if (!apiKey) {
      throw new Error('Debe ingresar la API Key de Brevo.');
    }
    const brevoFrom =
      (settings.smtp_from || '').trim() ||
      (settings.smtp_user || '').trim() ||
      adminEmail;
    await sendViaBrevo({
      apiKey,
      from: brevoFrom,
      orgName,
      to: adminEmail,
      subject,
      text,
      html,
    });
    return;
  }

  if (provider === 'resend') {
    const apiKey = (settings.email_api_key || '').trim();
    if (!apiKey) {
      throw new Error('Debe ingresar la API Key de Resend.');
    }
    const resendFrom =
      (settings.smtp_from || '').trim() || `${orgName} <onboarding@resend.dev>`;
    await sendViaResend({
      apiKey,
      from: resendFrom,
      to: adminEmail,
      subject,
      text,
      html,
    });
    return;
  }

  if (!settings.smtp_host?.trim()) {
    throw new Error('Debe configurar el servidor SMTP (Host).');
  }

  const transporter = await buildTransporter(settings);
  if (!transporter) {
    throw new Error('Configuración SMTP incompleta.');
  }

  const host = (settings.smtp_host || '').trim();
  const port = Number(settings.smtp_port || '587') || 587;
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
        subject,
        text,
        html,
      }),
      SMTP_SEND_TIMEOUT_MS,
      'Tiempo de espera agotado al enviar el correo de prueba.'
    );
  } catch (err) {
    throw formatSmtpError(err, host, port);
  } finally {
    transporter.close();
  }
}
