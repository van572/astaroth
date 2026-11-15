import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import {
  DEFAULT_PIN_HASH,
  encryptSecret,
  execute,
  getResolvedSettingsMap,
  getSetting,
  hashPin,
  initDatabase,
  isPostgres,
  queryAll,
  queryOne,
  setSetting,
} from './src/server/db.ts';
import { dispatchMovementEmailAsync, sendTestEmail } from './src/server/mailer.ts';

const PORT = Number(process.env.PORT) || 3000;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const activeSessions = new Map<string, number>();

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [token, expiresAt] of activeSessions.entries()) {
    if (expiresAt <= now) {
      activeSessions.delete(token);
    }
  }
}

function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return null;
  }
  return header.slice(7).trim();
}

function isTokenValid(token: string | null): boolean {
  if (!token) return false;
  cleanupExpiredSessions();
  const expiresAt = activeSessions.get(token);
  if (!expiresAt || expiresAt <= Date.now()) {
    activeSessions.delete(token);
    return false;
  }
  return true;
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = getBearerToken(req);
  if (!isTokenValid(token)) {
    res.status(401).json({ error: 'Acceso no autorizado. Ingrese el PIN de administrador.' });
    return;
  }
  next();
}

function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

function getServerLocalDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getServerLocalTime(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

interface PersonnelRow {
  id: number;
  qr_token: string;
  full_name: string;
  document_id: string;
  role_department: string;
  photo_data: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface AttendanceLogRow {
  id: number;
  personnel_id: number;
  movement_type: 'Entrada' | 'Salida';
  scanned_at: string;
  local_date: string;
  local_time: string;
  email_status: string;
  email_error: string | null;
}

async function startServer() {
  await initDatabase();

  const app = express();
  app.use(express.json({ limit: '6mb' }));

  // Render health check endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, db: isPostgres ? 'postgres' : 'sqlite' });
  });

  // Auth endpoints
  app.get(
    '/api/auth/status',
    asyncRoute(async (req, res) => {
      const token = getBearerToken(req);
      const authenticated = isTokenValid(token);
      const storedPinHash = await getSetting('admin_pin_hash');
      const isDefaultPin = storedPinHash === DEFAULT_PIN_HASH;
      const organizationName = (await getSetting('organization_name')) || 'ControlQR Corporativo';
      res.json({ authenticated, isDefaultPin, organizationName });
    })
  );

  app.post(
    '/api/auth/verify',
    asyncRoute(async (req, res) => {
      const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
      if (!pin) {
        res.status(400).json({ error: 'Debe ingresar el PIN o contraseña de administrador.' });
        return;
      }

      const storedHash = await getSetting('admin_pin_hash');
      if (hashPin(pin) !== storedHash) {
        res.status(401).json({ error: 'PIN o contraseña incorrecta.' });
        return;
      }

      const token = crypto.randomBytes(32).toString('hex');
      activeSessions.set(token, Date.now() + SESSION_TTL_MS);
      res.json({ token, expiresInMs: SESSION_TTL_MS });
    })
  );

  app.post('/api/auth/logout', (req, res) => {
    const token = getBearerToken(req);
    if (token) {
      activeSessions.delete(token);
    }
    res.json({ ok: true });
  });

  // Public Scanner Terminal Config (non-sensitive)
  app.get(
    '/api/scanner/config',
    asyncRoute(async (_req, res) => {
      const cooldownSeconds = Number((await getSetting('cooldown_seconds')) || '15');
      const organizationName = (await getSetting('organization_name')) || 'ControlQR Corporativo';
      res.json({
        cooldownSeconds: Number.isFinite(cooldownSeconds) ? cooldownSeconds : 15,
        organizationName,
      });
    })
  );

  // Public Scanner Endpoint
  app.post(
    '/api/scan',
    asyncRoute(async (req, res) => {
      const qrToken = typeof req.body?.qrToken === 'string' ? req.body.qrToken.trim() : '';
      const clientLocalDate =
        typeof req.body?.localDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.localDate)
          ? req.body.localDate
          : getServerLocalDate();
      const clientLocalTime =
        typeof req.body?.localTime === 'string' && /^\d{2}:\d{2}:\d{2}$/.test(req.body.localTime)
          ? req.body.localTime
          : getServerLocalTime();

      if (!qrToken) {
        res.status(400).json({
          status: 'invalid',
          message: 'Código QR vacío o ilegible.',
        });
        return;
      }

      const person = await queryOne<PersonnelRow>(
        'SELECT * FROM personnel WHERE qr_token = $1',
        [qrToken]
      );

      if (!person) {
        res.status(404).json({
          status: 'invalid',
          message: 'Código QR no reconocido en la base de datos.',
        });
        return;
      }

      const publicPerson = {
        id: person.id,
        full_name: person.full_name,
        document_id: person.document_id,
        role_department: person.role_department,
        photo_data: person.photo_data,
        is_active: person.is_active,
      };

      if (person.is_active === 0) {
        res.status(403).json({
          status: 'inactive',
          message: 'Carnet desactivado. Acceso denegado.',
          person: publicPerson,
        });
        return;
      }

      const cooldownSetting = Number((await getSetting('cooldown_seconds')) || '15');
      const cooldownSeconds =
        Number.isFinite(cooldownSetting) && cooldownSetting >= 5 ? cooldownSetting : 15;

      // Anti-rebote check across recent scan
      const lastScan = await queryOne<AttendanceLogRow>(
        'SELECT * FROM attendance_logs WHERE personnel_id = $1 ORDER BY id DESC LIMIT 1',
        [person.id]
      );

      if (lastScan) {
        const elapsedMs = Date.now() - new Date(lastScan.scanned_at).getTime();
        const cooldownMs = cooldownSeconds * 1000;
        if (elapsedMs >= 0 && elapsedMs < cooldownMs) {
          const remainingSeconds = Math.ceil((cooldownMs - elapsedMs) / 1000);
          res.status(429).json({
            status: 'cooldown',
            remainingSeconds,
            cooldownSeconds,
            lastMovement: lastScan.movement_type,
            message: `Lectura duplicada bloqueada. Espere ${remainingSeconds}s antes de volver a escanear.`,
            person: publicPerson,
          });
          return;
        }
      }

      // Smart Entry / Exit logic for the current day
      const lastToday = await queryOne<AttendanceLogRow>(
        'SELECT * FROM attendance_logs WHERE personnel_id = $1 AND local_date = $2 ORDER BY id DESC LIMIT 1',
        [person.id, clientLocalDate]
      );

      const movementType: 'Entrada' | 'Salida' =
        !lastToday || lastToday.movement_type === 'Salida' ? 'Entrada' : 'Salida';

      const scannedAt = new Date().toISOString();
      const settings = await getResolvedSettingsMap();
      const alertsActive =
        settings.email_alerts_enabled === 'true' &&
        Boolean(settings.admin_email?.trim()) &&
        Boolean(settings.smtp_host?.trim());

      const insertResult = await execute(
        `INSERT INTO attendance_logs (personnel_id, movement_type, scanned_at, local_date, local_time, email_status)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          person.id,
          movementType,
          scannedAt,
          clientLocalDate,
          clientLocalTime,
          alertsActive ? 'pending' : 'skipped',
        ]
      );

      const logId = insertResult.lastInsertId;

      // Respond immediately so the scanner terminal never freezes
      res.json({
        status: 'success',
        movementType,
        scannedAt,
        localDate: clientLocalDate,
        localTime: clientLocalTime,
        cooldownSeconds,
        message: `${movementType} registrada correctamente.`,
        person: publicPerson,
      });

      // Fire-and-forget asynchronous email dispatch
      if (alertsActive) {
        dispatchMovementEmailAsync({
          logId,
          fullName: person.full_name,
          documentId: person.document_id,
          roleDepartment: person.role_department,
          movementType,
          localDate: clientLocalDate,
          localTime: clientLocalTime,
        });
      }
    })
  );

  // Protected Personnel Endpoints
  app.get(
    '/api/personnel',
    requireAdmin,
    asyncRoute(async (req, res) => {
      const todayDate =
        typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
          ? req.query.date
          : getServerLocalDate();

      const rows = await queryAll(
        `SELECT p.*,
          (SELECT l.movement_type FROM attendance_logs l WHERE l.personnel_id = p.id AND l.local_date = $1 ORDER BY l.id DESC LIMIT 1) AS last_movement_today,
          (SELECT l.local_time FROM attendance_logs l WHERE l.personnel_id = p.id AND l.local_date = $2 ORDER BY l.id DESC LIMIT 1) AS last_scanned_today,
          (SELECT COUNT(*) FROM attendance_logs l WHERE l.personnel_id = p.id) AS total_logs
         FROM personnel p
         ORDER BY p.created_at DESC`,
        [todayDate, todayDate]
      );

      res.json(rows);
    })
  );

  app.post(
    '/api/personnel',
    requireAdmin,
    asyncRoute(async (req, res) => {
      const fullName = typeof req.body?.full_name === 'string' ? req.body.full_name.trim() : '';
      const documentId =
        typeof req.body?.document_id === 'string' ? req.body.document_id.trim() : '';
      const roleDepartment =
        typeof req.body?.role_department === 'string' ? req.body.role_department.trim() : '';
      const photoData =
        typeof req.body?.photo_data === 'string' && req.body.photo_data.startsWith('data:image/')
          ? req.body.photo_data
          : null;

      if (!fullName || !documentId || !roleDepartment) {
        res.status(400).json({
          error: 'Nombre completo, documento de identidad y cargo/departamento son obligatorios.',
        });
        return;
      }

      const existing = await queryOne<{ id: number }>(
        'SELECT id FROM personnel WHERE LOWER(document_id) = LOWER($1)',
        [documentId]
      );
      if (existing) {
        res.status(409).json({
          error: `Ya existe una persona registrada con el documento "${documentId}".`,
        });
        return;
      }

      const now = new Date().toISOString();
      const qrToken = `CQR-${crypto.randomUUID()}`;

      const info = await execute(
        `INSERT INTO personnel (qr_token, full_name, document_id, role_department, photo_data, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 1, $6, $7) RETURNING id`,
        [qrToken, fullName, documentId, roleDepartment, photoData, now, now]
      );

      const created = await queryOne<PersonnelRow>(
        'SELECT * FROM personnel WHERE id = $1',
        [info.lastInsertId]
      );
      res.status(201).json(created);
    })
  );

  app.put(
    '/api/personnel/:id',
    requireAdmin,
    asyncRoute(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'ID de personal inválido.' });
        return;
      }

      const existing = await queryOne<PersonnelRow>(
        'SELECT * FROM personnel WHERE id = $1',
        [id]
      );
      if (!existing) {
        res.status(404).json({ error: 'Registro no encontrado.' });
        return;
      }

      const fullName = typeof req.body?.full_name === 'string' ? req.body.full_name.trim() : '';
      const documentId =
        typeof req.body?.document_id === 'string' ? req.body.document_id.trim() : '';
      const roleDepartment =
        typeof req.body?.role_department === 'string' ? req.body.role_department.trim() : '';

      let photoData = existing.photo_data;
      if (req.body?.photo_data === null) {
        photoData = null;
      } else if (
        typeof req.body?.photo_data === 'string' &&
        req.body.photo_data.startsWith('data:image/')
      ) {
        photoData = req.body.photo_data;
      }

      if (!fullName || !documentId || !roleDepartment) {
        res.status(400).json({
          error: 'Nombre completo, documento de identidad y cargo/departamento son obligatorios.',
        });
        return;
      }

      const duplicate = await queryOne<{ id: number }>(
        'SELECT id FROM personnel WHERE LOWER(document_id) = LOWER($1) AND id != $2',
        [documentId, id]
      );
      if (duplicate) {
        res.status(409).json({
          error: `El documento "${documentId}" ya está asignado a otra persona.`,
        });
        return;
      }

      const now = new Date().toISOString();
      await execute(
        `UPDATE personnel
         SET full_name = $1, document_id = $2, role_department = $3, photo_data = $4, updated_at = $5
         WHERE id = $6`,
        [fullName, documentId, roleDepartment, photoData, now, id]
      );

      const updated = await queryOne<PersonnelRow>('SELECT * FROM personnel WHERE id = $1', [id]);
      res.json(updated);
    })
  );

  app.patch(
    '/api/personnel/:id/status',
    requireAdmin,
    asyncRoute(async (req, res) => {
      const id = Number(req.params.id);
      const isActive = req.body?.is_active ? 1 : 0;

      const existing = await queryOne<{ id: number }>(
        'SELECT id FROM personnel WHERE id = $1',
        [id]
      );
      if (!existing) {
        res.status(404).json({ error: 'Registro no encontrado.' });
        return;
      }

      const now = new Date().toISOString();
      await execute('UPDATE personnel SET is_active = $1, updated_at = $2 WHERE id = $3', [
        isActive,
        now,
        id,
      ]);
      const updated = await queryOne<PersonnelRow>('SELECT * FROM personnel WHERE id = $1', [id]);
      res.json(updated);
    })
  );

  // Protected Logs Endpoint
  app.get(
    '/api/logs',
    requireAdmin,
    asyncRoute(async (req, res) => {
      const dateFilter =
        typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
          ? req.query.date
          : '';

      const baseQuery = `
        SELECT l.*, p.full_name, p.document_id, p.role_department, p.photo_data, p.is_active
        FROM attendance_logs l
        INNER JOIN personnel p ON p.id = l.personnel_id
      `;

      const rows = dateFilter
        ? await queryAll(`${baseQuery} WHERE l.local_date = $1 ORDER BY l.id DESC LIMIT 500`, [
            dateFilter,
          ])
        : await queryAll(`${baseQuery} ORDER BY l.id DESC LIMIT 200`);

      res.json(rows);
    })
  );

  // Protected Daily Consolidated Attendance Report Endpoint
  app.get(
    '/api/attendance-report',
    requireAdmin,
    asyncRoute(async (req, res) => {
      const dateFilter =
        typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
          ? req.query.date
          : getServerLocalDate();

      const includeAbsent = req.query.includeAbsent === 'true';

      const allPersonnel = await queryAll<PersonnelRow>(
        'SELECT * FROM personnel ORDER BY full_name ASC'
      );

      const dayLogs = await queryAll<AttendanceLogRow>(
        'SELECT * FROM attendance_logs WHERE local_date = $1 ORDER BY personnel_id ASC, id ASC',
        [dateFilter]
      );

      const logsByPerson = new Map<number, AttendanceLogRow[]>();
      for (const log of dayLogs) {
        const list = logsByPerson.get(log.personnel_id) || [];
        list.push(log);
        logsByPerson.set(log.personnel_id, list);
      }

      const reportRows: Array<{
        document_id: string;
        full_name: string;
        role_department: string;
        date: string;
        entry_time: string;
        exit_time: string;
        status: string;
        personnel_id: number;
        is_active: number;
      }> = [];

      for (const person of allPersonnel) {
        const personLogs = logsByPerson.get(person.id) || [];

        if (personLogs.length === 0) {
          if (includeAbsent && person.is_active === 1) {
            reportRows.push({
              document_id: person.document_id,
              full_name: person.full_name,
              role_department: person.role_department,
              date: dateFilter,
              entry_time: '—',
              exit_time: '—',
              status: 'Sin registro',
              personnel_id: person.id,
              is_active: person.is_active,
            });
          }
          continue;
        }

        let currentEntry: AttendanceLogRow | null = null;
        for (const log of personLogs) {
          if (log.movement_type === 'Entrada') {
            if (currentEntry) {
              reportRows.push({
                document_id: person.document_id,
                full_name: person.full_name,
                role_department: person.role_department,
                date: dateFilter,
                entry_time: currentEntry.local_time,
                exit_time: '—',
                status: 'En jornada',
                personnel_id: person.id,
                is_active: person.is_active,
              });
            }
            currentEntry = log;
          } else {
            if (currentEntry) {
              reportRows.push({
                document_id: person.document_id,
                full_name: person.full_name,
                role_department: person.role_department,
                date: dateFilter,
                entry_time: currentEntry.local_time,
                exit_time: log.local_time,
                status: 'Completado',
                personnel_id: person.id,
                is_active: person.is_active,
              });
              currentEntry = null;
            } else {
              reportRows.push({
                document_id: person.document_id,
                full_name: person.full_name,
                role_department: person.role_department,
                date: dateFilter,
                entry_time: '—',
                exit_time: log.local_time,
                status: 'Salida registrada',
                personnel_id: person.id,
                is_active: person.is_active,
              });
            }
          }
        }

        if (currentEntry) {
          reportRows.push({
            document_id: person.document_id,
            full_name: person.full_name,
            role_department: person.role_department,
            date: dateFilter,
            entry_time: currentEntry.local_time,
            exit_time: '—',
            status: 'En jornada',
            personnel_id: person.id,
            is_active: person.is_active,
          });
        }
      }

      res.json(reportRows);
    })
  );

  // Protected Settings Endpoints
  app.get(
    '/api/settings',
    requireAdmin,
    asyncRoute(async (_req, res) => {
      const s = await getResolvedSettingsMap();
      res.json({
        organization_name: s.organization_name || 'ControlQR Corporativo',
        cooldown_seconds: Number(s.cooldown_seconds || '15'),
        admin_email: s.admin_email || '',
        email_alerts_enabled: s.email_alerts_enabled === 'true',
        smtp_host: s.smtp_host || '',
        smtp_port: Number(s.smtp_port || '587'),
        smtp_secure: s.smtp_secure === 'true',
        smtp_user: s.smtp_user || '',
        smtp_pass_configured: Boolean(s.smtp_pass),
        smtp_from: s.smtp_from || '',
        is_default_pin: s.admin_pin_hash === DEFAULT_PIN_HASH,
      });
    })
  );

  app.put(
    '/api/settings',
    requireAdmin,
    asyncRoute(async (req, res) => {
      const body = req.body || {};

      if (typeof body.organization_name === 'string' && body.organization_name.trim()) {
        await setSetting('organization_name', body.organization_name.trim().slice(0, 80));
      }

      if (body.cooldown_seconds !== undefined) {
        const cd = Math.min(60, Math.max(5, Number(body.cooldown_seconds) || 15));
        await setSetting('cooldown_seconds', String(cd));
      }

      if (typeof body.admin_email === 'string') {
        await setSetting('admin_email', body.admin_email.trim());
      }

      if (typeof body.email_alerts_enabled === 'boolean') {
        await setSetting('email_alerts_enabled', String(body.email_alerts_enabled));
      }

      if (typeof body.smtp_host === 'string') {
        await setSetting('smtp_host', body.smtp_host.trim());
      }

      if (body.smtp_port !== undefined) {
        const port = Number(body.smtp_port) || 587;
        await setSetting('smtp_port', String(port));
      }

      if (typeof body.smtp_secure === 'boolean') {
        await setSetting('smtp_secure', String(body.smtp_secure));
      }

      if (typeof body.smtp_user === 'string') {
        await setSetting('smtp_user', body.smtp_user.trim());
      }

      if (typeof body.smtp_pass === 'string' && body.smtp_pass.length > 0) {
        await setSetting('smtp_pass', encryptSecret(body.smtp_pass));
      }

      if (typeof body.smtp_from === 'string') {
        await setSetting('smtp_from', body.smtp_from.trim());
      }

      if (typeof body.new_pin === 'string' && body.new_pin.trim().length > 0) {
        const newPin = body.new_pin.trim();
        if (newPin.length < 4) {
          res.status(400).json({ error: 'El nuevo PIN debe tener al menos 4 caracteres.' });
          return;
        }
        await setSetting('admin_pin_hash', hashPin(newPin));
      }

      const s = await getResolvedSettingsMap();
      res.json({
        organization_name: s.organization_name || 'ControlQR Corporativo',
        cooldown_seconds: Number(s.cooldown_seconds || '15'),
        admin_email: s.admin_email || '',
        email_alerts_enabled: s.email_alerts_enabled === 'true',
        smtp_host: s.smtp_host || '',
        smtp_port: Number(s.smtp_port || '587'),
        smtp_secure: s.smtp_secure === 'true',
        smtp_user: s.smtp_user || '',
        smtp_pass_configured: Boolean(s.smtp_pass),
        smtp_from: s.smtp_from || '',
        is_default_pin: s.admin_pin_hash === DEFAULT_PIN_HASH,
      });
    })
  );

  app.post(
    '/api/settings/test-email',
    requireAdmin,
    asyncRoute(async (req, res) => {
      try {
        const overrides: Record<string, string> = {};
        if (typeof req.body?.admin_email === 'string') overrides.admin_email = req.body.admin_email;
        if (typeof req.body?.smtp_host === 'string') overrides.smtp_host = req.body.smtp_host;
        if (req.body?.smtp_port !== undefined) overrides.smtp_port = String(req.body.smtp_port);
        if (typeof req.body?.smtp_secure === 'boolean') overrides.smtp_secure = String(req.body.smtp_secure);
        if (typeof req.body?.smtp_user === 'string') overrides.smtp_user = req.body.smtp_user;
        if (typeof req.body?.smtp_pass === 'string' && req.body.smtp_pass.length > 0) {
          overrides.smtp_pass = req.body.smtp_pass;
        }
        if (typeof req.body?.smtp_from === 'string') overrides.smtp_from = req.body.smtp_from;
        if (typeof req.body?.organization_name === 'string') {
          overrides.organization_name = req.body.organization_name;
        }

        await sendTestEmail(overrides);
        res.json({ ok: true, message: 'Correo de prueba enviado correctamente.' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Error al enviar el correo de prueba.';
        res.status(400).json({ error: message });
      }
    })
  );

  // Express JSON error handler
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : 'Error interno del servidor.';
    if (!res.headersSent) {
      res.status(500).json({ error: message });
    }
  });

  // Vite dev middleware or static production build
  const distDir = path.resolve(process.cwd(), 'dist');
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(distDir);

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `ControlQR server listening on http://localhost:${PORT} (${isPostgres ? 'PostgreSQL' : 'SQLite'})`
    );
  });
}

startServer();
