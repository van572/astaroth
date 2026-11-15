import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import {
  DEFAULT_PIN_HASH,
  db,
  encryptSecret,
  getResolvedSettingsMap,
  getSetting,
  hashPin,
  initDatabase,
  setSetting,
} from './src/server/db.ts';
import {
  dispatchMovementEmailAsync,
  evaluateMovementNotification,
  parseNotificationRules,
  sendTestEmail,
} from './src/server/mailer.ts';

initDatabase();

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
  const app = express();
  app.use(express.json({ limit: '6mb' }));

  app.get('/api/health', (_req, res) => {
    try {
      const row = db.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
      const dbActive = row?.ok === 1;
      res.status(dbActive ? 200 : 503).json({ ok: dbActive, dbActive });
    } catch {
      res.status(503).json({ ok: false, dbActive: false });
    }
  });

  async function verifySupabaseApi(
    supabaseUrl: string,
    supabaseKey: string,
    timeoutMs = 5000
  ): Promise<{ ok: boolean; status?: number; error?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // /auth/v1/settings accepts all valid Supabase key formats: sb_publishable_*, sb_secret_*, anon, service_role
      const authRes = await fetch(`${supabaseUrl}/auth/v1/settings`, {
        method: 'GET',
        headers: { apikey: supabaseKey },
        signal: controller.signal,
      });

      if (authRes.ok) {
        return { ok: true, status: authRes.status };
      }

      if (authRes.status === 401 || authRes.status === 403) {
        return {
          ok: false,
          status: authRes.status,
          error: `Supabase respondió HTTP ${authRes.status}: clave API inválida o sin permisos.`,
        };
      }

      // Fallback for custom/self-hosted deployments where /auth/v1/settings is disabled
      const restRes = await fetch(`${supabaseUrl}/rest/v1/`, {
        method: 'GET',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
        signal: controller.signal,
      });

      if (restRes.ok || restRes.status === 404) {
        return { ok: true, status: restRes.status };
      }

      if (restRes.status === 401 || restRes.status === 403) {
        return {
          ok: false,
          status: restRes.status,
          error: `Supabase respondió HTTP ${restRes.status}: clave API inválida o sin permisos.`,
        };
      }

      return {
        ok: false,
        status: restRes.status,
        error: `Supabase respondió con estado HTTP ${restRes.status}.`,
      };
    } catch (err) {
      const msg =
        err instanceof Error && err.name === 'AbortError'
          ? 'Tiempo de espera agotado al conectar con Supabase.'
          : err instanceof Error
          ? err.message
          : 'No se pudo conectar con el servidor de Supabase.';
      return { ok: false, error: msg };
    } finally {
      clearTimeout(timer);
    }
  }

  async function verifyPostgresTcp(
    databaseUrl: string,
    timeoutMs = 4000
  ): Promise<{ ok: boolean; host?: string; port?: number; error?: string }> {
    try {
      const parsed = new URL(databaseUrl);
      if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
        return { ok: false, error: 'La cadena PostgreSQL debe iniciar con postgresql:// o postgres://.' };
      }
      const host = parsed.hostname;
      const port = Number(parsed.port) || 5432;
      const tcpOk = await new Promise<boolean>((resolve) => {
        const socket = net.createConnection({ host, port });
        const timer = setTimeout(() => {
          socket.destroy();
          resolve(false);
        }, timeoutMs);
        socket.once('connect', () => {
          clearTimeout(timer);
          socket.destroy();
          resolve(true);
        });
        socket.once('error', () => {
          clearTimeout(timer);
          socket.destroy();
          resolve(false);
        });
      });

      if (!tcpOk) {
        return { ok: false, host, port, error: `No se pudo abrir conexión TCP hacia ${host}:${port}.` };
      }
      return { ok: true, host, port };
    } catch {
      return { ok: false, error: 'El formato de DATABASE_URL no es válido.' };
    }
  }

  app.get('/api/db/status', async (_req, res) => {
    let sqliteActive = false;
    try {
      const row = db.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
      sqliteActive = row?.ok === 1;
    } catch {
      sqliteActive = false;
    }

    const s = getResolvedSettingsMap();
    const provider: 'sqlite' | 'supabase' =
      s.db_provider === 'supabase' ? 'supabase' : 'sqlite';

    if (provider === 'sqlite') {
      res.json({
        dbActive: sqliteActive,
        provider: 'sqlite',
        label: sqliteActive ? 'Base de datos activa · SQLite' : 'Base de datos inactiva',
      });
      return;
    }

    const supabaseUrl = (s.supabase_url || '').trim().replace(/\/+$/, '');
    const supabaseKey = (s.supabase_key || '').trim();
    const databaseUrl = (s.database_url || '').trim();

    if (supabaseUrl && supabaseKey) {
      const apiCheck = await verifySupabaseApi(supabaseUrl, supabaseKey, 4500);
      if (apiCheck.ok) {
        res.json({
          dbActive: sqliteActive,
          provider: 'supabase',
          label: sqliteActive ? 'Base de datos activa · Supabase' : 'Motor local SQLite inactivo',
        });
        return;
      }
      // If REST check failed and databaseUrl exists, surface clear diagnostic
      if (!databaseUrl) {
        res.json({
          dbActive: false,
          provider: 'supabase',
          label: apiCheck.status === 401 || apiCheck.status === 403
            ? 'Clave API de Supabase inválida'
            : 'Supabase sin respuesta',
        });
        return;
      }
    }

    if (databaseUrl) {
      const pgCheck = await verifyPostgresTcp(databaseUrl, 3500);
      res.json({
        dbActive: sqliteActive && pgCheck.ok,
        provider: 'supabase',
        label:
          sqliteActive && pgCheck.ok
            ? 'Base de datos activa · PostgreSQL'
            : pgCheck.error || 'PostgreSQL externo inaccesible',
      });
      return;
    }

    res.json({
      dbActive: false,
      provider: 'supabase',
      label: 'Supabase sin credenciales configuradas',
    });
  });

  // Auth endpoints
  app.get('/api/auth/status', (req, res) => {
    const token = getBearerToken(req);
    const authenticated = isTokenValid(token);
    const isDefaultPin = getSetting('admin_pin_hash') === DEFAULT_PIN_HASH;
    const organizationName = getSetting('organization_name') || 'ControlQR Corporativo';
    res.json({ authenticated, isDefaultPin, organizationName });
  });

  app.post('/api/auth/verify', (req, res) => {
    const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
    if (!pin) {
      res.status(400).json({ error: 'Debe ingresar el PIN o contraseña de administrador.' });
      return;
    }

    const storedHash = getSetting('admin_pin_hash');
    if (hashPin(pin) !== storedHash) {
      res.status(401).json({ error: 'PIN o contraseña incorrecta.' });
      return;
    }

    const token = crypto.randomBytes(32).toString('hex');
    activeSessions.set(token, Date.now() + SESSION_TTL_MS);
    res.json({ token, expiresInMs: SESSION_TTL_MS });
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = getBearerToken(req);
    if (token) {
      activeSessions.delete(token);
    }
    res.json({ ok: true });
  });

  // Public Scanner Terminal Config (non-sensitive)
  app.get('/api/scanner/config', (_req, res) => {
    const cooldownSeconds = Number(getSetting('cooldown_seconds') || '15');
    const organizationName = getSetting('organization_name') || 'ControlQR Corporativo';
    res.json({
      cooldownSeconds: Number.isFinite(cooldownSeconds) ? cooldownSeconds : 15,
      organizationName,
    });
  });

  // Public Offline Scanner Directory Snapshot (non-sensitive terminal cache)
  app.get('/api/scanner/bootstrap', (req, res) => {
    const todayDate =
      typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
        ? req.query.date
        : getServerLocalDate();
    const cooldownSetting = Number(getSetting('cooldown_seconds') || '15');
    const cooldownSeconds =
      Number.isFinite(cooldownSetting) && cooldownSetting >= 5 ? cooldownSetting : 15;
    const organizationName = getSetting('organization_name') || 'ControlQR Corporativo';

    const personnel = db
      .prepare(
        `SELECT p.id, p.qr_token, p.full_name, p.document_id, p.role_department, p.photo_data, p.is_active,
          (SELECT l.movement_type FROM attendance_logs l WHERE l.personnel_id = p.id AND l.local_date = ? ORDER BY l.scanned_at DESC, l.id DESC LIMIT 1) AS last_movement_today,
          (SELECT l.scanned_at FROM attendance_logs l WHERE l.personnel_id = p.id ORDER BY l.scanned_at DESC, l.id DESC LIMIT 1) AS last_scanned_at
         FROM personnel p
         ORDER BY p.id ASC`
      )
      .all(todayDate);

    res.json({
      cooldownSeconds,
      organizationName,
      serverDate: todayDate,
      syncedAt: new Date().toISOString(),
      personnel,
    });
  });

  // Public Scanner Endpoint
  app.post('/api/scan', (req, res) => {
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

    const person = db
      .prepare('SELECT * FROM personnel WHERE qr_token = ?')
      .get(qrToken) as PersonnelRow | undefined;

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

    const cooldownSetting = Number(getSetting('cooldown_seconds') || '15');
    const cooldownSeconds =
      Number.isFinite(cooldownSetting) && cooldownSetting >= 5 ? cooldownSetting : 15;

    // Anti-rebote check across recent scan
    const lastScan = db
      .prepare('SELECT * FROM attendance_logs WHERE personnel_id = ? ORDER BY id DESC LIMIT 1')
      .get(person.id) as AttendanceLogRow | undefined;

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
    const lastToday = db
      .prepare(
        'SELECT * FROM attendance_logs WHERE personnel_id = ? AND local_date = ? ORDER BY id DESC LIMIT 1'
      )
      .get(person.id, clientLocalDate) as AttendanceLogRow | undefined;

    const movementType: 'Entrada' | 'Salida' =
      !lastToday || lastToday.movement_type === 'Salida' ? 'Entrada' : 'Salida';

    const scannedAt = new Date().toISOString();
    const settings = getResolvedSettingsMap();
    const evaluation = evaluateMovementNotification(settings, {
      roleDepartment: person.role_department,
      movementType,
      localTime: clientLocalTime,
    });

    const insertResult = db
      .prepare(
        `INSERT INTO attendance_logs (personnel_id, movement_type, scanned_at, local_date, local_time, email_status, email_error)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        person.id,
        movementType,
        scannedAt,
        clientLocalDate,
        clientLocalTime,
        evaluation.shouldNotify ? 'pending' : 'skipped',
        evaluation.shouldNotify ? null : evaluation.skipReason
      );

    const logId = Number(insertResult.lastInsertRowid);

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
    if (evaluation.shouldNotify) {
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
  });

  // Public Offline Sync Batch Endpoint (idempotent by clientScanId)
  app.post('/api/scan/sync-batch', (req, res) => {
    const rawScans = Array.isArray(req.body?.scans) ? req.body.scans : null;
    if (!rawScans || rawScans.length === 0) {
      res.status(400).json({ error: 'No se recibieron lecturas pendientes para sincronizar.' });
      return;
    }

    if (rawScans.length > 500) {
      res.status(400).json({ error: 'Máximo 500 lecturas por lote de sincronización.' });
      return;
    }

    interface IncomingOfflineScan {
      clientScanId: string;
      qrToken: string;
      scannedAt: string;
      localDate: string;
      localTime: string;
    }

    const validItems: IncomingOfflineScan[] = [];
    const results: Array<{
      clientScanId: string;
      status: 'synced' | 'duplicate' | 'rejected';
      movementType?: 'Entrada' | 'Salida';
      reason?: string;
    }> = [];

    for (const item of rawScans) {
      const clientScanId =
        typeof item?.clientScanId === 'string' ? item.clientScanId.trim() : '';
      const qrToken = typeof item?.qrToken === 'string' ? item.qrToken.trim() : '';
      const scannedAtRaw = typeof item?.scannedAt === 'string' ? item.scannedAt.trim() : '';
      const parsedMs = Date.parse(scannedAtRaw);
      const scannedAt = Number.isFinite(parsedMs)
        ? new Date(parsedMs).toISOString()
        : new Date().toISOString();
      const localDate =
        typeof item?.localDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.localDate)
          ? item.localDate
          : getServerLocalDate();
      const localTime =
        typeof item?.localTime === 'string' && /^\d{2}:\d{2}:\d{2}$/.test(item.localTime)
          ? item.localTime
          : getServerLocalTime();

      if (!clientScanId || !qrToken) {
        if (clientScanId) {
          results.push({
            clientScanId,
            status: 'rejected',
            reason: 'Lectura sin identificador o código QR válido.',
          });
        }
        continue;
      }

      validItems.push({ clientScanId, qrToken, scannedAt, localDate, localTime });
    }

    // Sort chronologically so historical offline Entrada/Salida pairs remain ordered
    validItems.sort((a, b) => Date.parse(a.scannedAt) - Date.parse(b.scannedAt));

    const settings = getResolvedSettingsMap();

    const checkExistingStmt = db.prepare(
      'SELECT id, movement_type FROM attendance_logs WHERE client_scan_id = ?'
    );
    const findPersonStmt = db.prepare('SELECT * FROM personnel WHERE qr_token = ?');
    const findLastBeforeStmt = db.prepare(
      `SELECT movement_type FROM attendance_logs
       WHERE personnel_id = ? AND local_date = ? AND scanned_at <= ?
       ORDER BY scanned_at DESC, id DESC LIMIT 1`
    );
    const insertLogStmt = db.prepare(
      `INSERT INTO attendance_logs (personnel_id, movement_type, scanned_at, local_date, local_time, email_status, email_error, client_scan_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const pendingEmails: Array<{
      logId: number;
      fullName: string;
      documentId: string;
      roleDepartment: string;
      movementType: 'Entrada' | 'Salida';
      localDate: string;
      localTime: string;
    }> = [];

    const tx = db.transaction(() => {
      for (const item of validItems) {
        const already = checkExistingStmt.get(item.clientScanId) as
          | { id: number; movement_type: 'Entrada' | 'Salida' }
          | undefined;
        if (already) {
          results.push({
            clientScanId: item.clientScanId,
            status: 'duplicate',
            movementType: already.movement_type,
          });
          continue;
        }

        const person = findPersonStmt.get(item.qrToken) as PersonnelRow | undefined;
        if (!person) {
          results.push({
            clientScanId: item.clientScanId,
            status: 'rejected',
            reason: 'Código QR no reconocido en la base de datos.',
          });
          continue;
        }

        if (person.is_active === 0) {
          results.push({
            clientScanId: item.clientScanId,
            status: 'rejected',
            reason: 'Carnet desactivado.',
          });
          continue;
        }

        const prevLog = findLastBeforeStmt.get(
          person.id,
          item.localDate,
          item.scannedAt
        ) as { movement_type: 'Entrada' | 'Salida' } | undefined;

        const movementType: 'Entrada' | 'Salida' =
          !prevLog || prevLog.movement_type === 'Salida' ? 'Entrada' : 'Salida';

        const evaluation = evaluateMovementNotification(settings, {
          roleDepartment: person.role_department,
          movementType,
          localTime: item.localTime,
        });

        const info = insertLogStmt.run(
          person.id,
          movementType,
          item.scannedAt,
          item.localDate,
          item.localTime,
          evaluation.shouldNotify ? 'pending' : 'skipped',
          evaluation.shouldNotify ? null : evaluation.skipReason,
          item.clientScanId
        );

        const logId = Number(info.lastInsertRowid);
        results.push({
          clientScanId: item.clientScanId,
          status: 'synced',
          movementType,
        });

        if (evaluation.shouldNotify) {
          pendingEmails.push({
            logId,
            fullName: person.full_name,
            documentId: person.document_id,
            roleDepartment: person.role_department,
            movementType,
            localDate: item.localDate,
            localTime: item.localTime,
          });
        }
      }
    });

    tx();

    res.json({
      syncedCount: results.filter((r) => r.status === 'synced').length,
      duplicateCount: results.filter((r) => r.status === 'duplicate').length,
      rejectedCount: results.filter((r) => r.status === 'rejected').length,
      results,
    });

    for (const emailPayload of pendingEmails) {
      dispatchMovementEmailAsync(emailPayload);
    }
  });

  // Protected Personnel Endpoints
  app.get('/api/personnel', requireAdmin, (req, res) => {
    const todayDate =
      typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
        ? req.query.date
        : getServerLocalDate();

    const rows = db
      .prepare(
        `SELECT p.*,
          (SELECT l.movement_type FROM attendance_logs l WHERE l.personnel_id = p.id AND l.local_date = ? ORDER BY l.id DESC LIMIT 1) AS last_movement_today,
          (SELECT l.local_time FROM attendance_logs l WHERE l.personnel_id = p.id AND l.local_date = ? ORDER BY l.id DESC LIMIT 1) AS last_scanned_today,
          (SELECT COUNT(*) FROM attendance_logs l WHERE l.personnel_id = p.id) AS total_logs
         FROM personnel p
         ORDER BY p.created_at DESC`
      )
      .all(todayDate, todayDate);

    res.json(rows);
  });

  app.post('/api/personnel', requireAdmin, (req, res) => {
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

    const existing = db
      .prepare('SELECT id FROM personnel WHERE LOWER(document_id) = LOWER(?)')
      .get(documentId);
    if (existing) {
      res.status(409).json({
        error: `Ya existe una persona registrada con el documento "${documentId}".`,
      });
      return;
    }

    const now = new Date().toISOString();
    const qrToken = `CQR-${crypto.randomUUID()}`;

    const info = db
      .prepare(
        `INSERT INTO personnel (qr_token, full_name, document_id, role_department, photo_data, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .run(qrToken, fullName, documentId, roleDepartment, photoData, now, now);

    const created = db
      .prepare('SELECT * FROM personnel WHERE id = ?')
      .get(Number(info.lastInsertRowid));
    res.status(201).json(created);
  });

  app.post('/api/personnel/bulk', requireAdmin, (req, res) => {
    const rawRows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!rawRows || rawRows.length === 0) {
      res.status(400).json({ error: 'El archivo CSV no contiene registros para importar.' });
      return;
    }

    if (rawRows.length > 1000) {
      res.status(400).json({ error: 'Máximo 1000 registros por carga CSV.' });
      return;
    }

    const existingDocsRows = db
      .prepare('SELECT LOWER(document_id) AS doc FROM personnel')
      .all() as Array<{ doc: string }>;
    const existingDocs = new Set(existingDocsRows.map((r) => r.doc));
    const batchDocs = new Set<string>();

    const errors: Array<{
      rowNumber: number;
      document_id: string;
      full_name: string;
      reason: string;
    }> = [];

    const validToInsert: Array<{
      qrToken: string;
      fullName: string;
      documentId: string;
      roleDepartment: string;
    }> = [];

    for (let i = 0; i < rawRows.length; i++) {
      const item = rawRows[i] || {};
      const rowNumber = Number.isFinite(Number(item.rowNumber)) ? Number(item.rowNumber) : i + 1;
      const fullName = typeof item.full_name === 'string' ? item.full_name.trim() : '';
      const documentId = typeof item.document_id === 'string' ? item.document_id.trim() : '';
      const roleDepartment =
        typeof item.role_department === 'string' ? item.role_department.trim() : '';

      if (!fullName) {
        errors.push({
          rowNumber,
          document_id: documentId,
          full_name: fullName,
          reason: 'Falta el nombre completo (campo obligatorio).',
        });
        continue;
      }

      if (!documentId) {
        errors.push({
          rowNumber,
          document_id: documentId,
          full_name: fullName,
          reason: 'Falta el documento de identidad / código único (campo obligatorio).',
        });
        continue;
      }

      if (!roleDepartment) {
        errors.push({
          rowNumber,
          document_id: documentId,
          full_name: fullName,
          reason: 'Falta el cargo / departamento (campo obligatorio).',
        });
        continue;
      }

      const normalizedDoc = documentId.toLowerCase();
      if (existingDocs.has(normalizedDoc)) {
        errors.push({
          rowNumber,
          document_id: documentId,
          full_name: fullName,
          reason: `El documento "${documentId}" ya está registrado en el sistema.`,
        });
        continue;
      }

      if (batchDocs.has(normalizedDoc)) {
        errors.push({
          rowNumber,
          document_id: documentId,
          full_name: fullName,
          reason: `El documento "${documentId}" está duplicado dentro del archivo CSV.`,
        });
        continue;
      }

      batchDocs.add(normalizedDoc);
      validToInsert.push({
        qrToken: `CQR-${crypto.randomUUID()}`,
        fullName,
        documentId,
        roleDepartment,
      });
    }

    const now = new Date().toISOString();
    const insertStmt = db.prepare(
      `INSERT INTO personnel (qr_token, full_name, document_id, role_department, photo_data, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 1, ?, ?)`
    );
    const selectStmt = db.prepare('SELECT * FROM personnel WHERE id = ?');

    const created: PersonnelRow[] = [];
    const insertTx = db.transaction(() => {
      for (const row of validToInsert) {
        const info = insertStmt.run(
          row.qrToken,
          row.fullName,
          row.documentId,
          row.roleDepartment,
          now,
          now
        );
        const inserted = selectStmt.get(Number(info.lastInsertRowid)) as PersonnelRow | undefined;
        if (inserted) created.push(inserted);
      }
    });

    insertTx();
    res.status(201).json({ created, errors });
  });

  app.put('/api/personnel/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'ID de personal inválido.' });
      return;
    }

    const existing = db.prepare('SELECT * FROM personnel WHERE id = ?').get(id) as
      | PersonnelRow
      | undefined;
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

    const duplicate = db
      .prepare('SELECT id FROM personnel WHERE LOWER(document_id) = LOWER(?) AND id != ?')
      .get(documentId, id);
    if (duplicate) {
      res.status(409).json({
        error: `El documento "${documentId}" ya está asignado a otra persona.`,
      });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE personnel
       SET full_name = ?, document_id = ?, role_department = ?, photo_data = ?, updated_at = ?
       WHERE id = ?`
    ).run(fullName, documentId, roleDepartment, photoData, now, id);

    const updated = db.prepare('SELECT * FROM personnel WHERE id = ?').get(id);
    res.json(updated);
  });

  app.patch('/api/personnel/:id/status', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const isActive = req.body?.is_active ? 1 : 0;

    const existing = db.prepare('SELECT id FROM personnel WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Registro no encontrado.' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE personnel SET is_active = ?, updated_at = ? WHERE id = ?').run(
      isActive,
      now,
      id
    );
    const updated = db.prepare('SELECT * FROM personnel WHERE id = ?').get(id);
    res.json(updated);
  });

  // Protected Logs Endpoint
  app.get('/api/logs', requireAdmin, (req, res) => {
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
      ? db
          .prepare(`${baseQuery} WHERE l.local_date = ? ORDER BY l.id DESC LIMIT 500`)
          .all(dateFilter)
      : db.prepare(`${baseQuery} ORDER BY l.id DESC LIMIT 200`).all();

    res.json(rows);
  });

  // Protected Daily Consolidated Attendance Report Endpoint
  app.get('/api/attendance-report', requireAdmin, (req, res) => {
    const dateFilter =
      typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
        ? req.query.date
        : getServerLocalDate();

    const includeAbsent = req.query.includeAbsent === 'true';

    const allPersonnel = db
      .prepare('SELECT * FROM personnel ORDER BY full_name ASC')
      .all() as PersonnelRow[];

    const dayLogs = db
      .prepare(
        'SELECT * FROM attendance_logs WHERE local_date = ? ORDER BY personnel_id ASC, id ASC'
      )
      .all(dateFilter) as AttendanceLogRow[];

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

      // Pair Entrada -> Salida sessions sequentially for the day
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
  });

  // Protected Visual Analytics Endpoint
  app.get('/api/analytics', requireAdmin, (req, res) => {
    const targetDate =
      typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
        ? req.query.date
        : getServerLocalDate();

    const [y, m, d] = targetDate.split('-').map(Number);
    const shortMonths = [
      'ene',
      'feb',
      'mar',
      'abr',
      'may',
      'jun',
      'jul',
      'ago',
      'sep',
      'oct',
      'nov',
      'dic',
    ];

    const windowDates: string[] = [];
    for (let offset = 6; offset >= 0; offset--) {
      const dt = new Date(Date.UTC(y, m - 1, d - offset));
      const yy = dt.getUTCFullYear();
      const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(dt.getUTCDate()).padStart(2, '0');
      windowDates.push(`${yy}-${mm}-${dd}`);
    }

    const startDate = windowDates[0];
    const windowLogs = db
      .prepare(
        `SELECT l.local_date, l.local_time, l.movement_type, l.personnel_id
         FROM attendance_logs l
         WHERE l.local_date >= ? AND l.local_date <= ?
         ORDER BY l.id ASC`
      )
      .all(startDate, targetDate) as Array<{
      local_date: string;
      local_time: string;
      movement_type: 'Entrada' | 'Salida';
      personnel_id: number;
    }>;

    // 1. Daily Trends (7 days)
    const dailyMap = new Map<
      string,
      { entries: number; exits: number; people: Set<number> }
    >();
    for (const dateStr of windowDates) {
      dailyMap.set(dateStr, { entries: 0, exits: 0, people: new Set<number>() });
    }
    for (const log of windowLogs) {
      const bucket = dailyMap.get(log.local_date);
      if (!bucket) continue;
      if (log.movement_type === 'Entrada') bucket.entries++;
      else bucket.exits++;
      bucket.people.add(log.personnel_id);
    }

    const dailyTrends = windowDates.map((dateStr) => {
      const parts = dateStr.split('-').map(Number);
      const bucket = dailyMap.get(dateStr)!;
      return {
        date: dateStr,
        label: `${String(parts[2]).padStart(2, '0')} ${shortMonths[parts[1] - 1]}`,
        entries: bucket.entries,
        exits: bucket.exits,
        uniquePeople: bucket.people.size,
      };
    });

    // 2. Hourly Entry & Exit Peaks for targetDate
    const hourlyBuckets = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      label: `${String(hour).padStart(2, '0')}:00`,
      entries: 0,
      exits: 0,
    }));

    const todayLogs = windowLogs.filter((l) => l.local_date === targetDate);
    const todayEntriesPeople = new Set<number>();
    const lastMovementByPerson = new Map<number, 'Entrada' | 'Salida'>();
    const completedPeople = new Set<number>();

    for (const log of todayLogs) {
      const hourNum = Number(log.local_time.slice(0, 2));
      if (Number.isInteger(hourNum) && hourNum >= 0 && hourNum <= 23) {
        if (log.movement_type === 'Entrada') hourlyBuckets[hourNum].entries++;
        else hourlyBuckets[hourNum].exits++;
      }

      if (log.movement_type === 'Entrada') {
        todayEntriesPeople.add(log.personnel_id);
      } else if (todayEntriesPeople.has(log.personnel_id)) {
        completedPeople.add(log.personnel_id);
      }
      lastMovementByPerson.set(log.personnel_id, log.movement_type);
    }

    let peakEntryHour: string | null = null;
    let peakEntryCount = 0;
    for (const b of hourlyBuckets) {
      if (b.entries > peakEntryCount) {
        peakEntryCount = b.entries;
        peakEntryHour = b.label;
      }
    }

    // 3. Department Distribution for targetDate
    const activePersonnel = db
      .prepare('SELECT id, role_department FROM personnel WHERE is_active = 1')
      .all() as Array<{ id: number; role_department: string }>;

    const deptMap = new Map<
      string,
      { totalActive: number; presentToday: number; currentlyOnSite: number }
    >();

    for (const p of activePersonnel) {
      const dept = p.role_department.trim() || 'Sin departamento';
      const entry = deptMap.get(dept) || {
        totalActive: 0,
        presentToday: 0,
        currentlyOnSite: 0,
      };
      entry.totalActive++;
      if (todayEntriesPeople.has(p.id) || lastMovementByPerson.has(p.id)) {
        entry.presentToday++;
      }
      if (lastMovementByPerson.get(p.id) === 'Entrada') {
        entry.currentlyOnSite++;
      }
      deptMap.set(dept, entry);
    }

    const departmentDistribution = Array.from(deptMap.entries())
      .map(([department, counts]) => ({
        department,
        ...counts,
      }))
      .sort((a, b) => b.totalActive - a.totalActive || a.department.localeCompare(b.department));

    let currentlyOnSite = 0;
    for (const mv of lastMovementByPerson.values()) {
      if (mv === 'Entrada') currentlyOnSite++;
    }

    res.json({
      date: targetDate,
      summary: {
        totalActive: activePersonnel.length,
        presentToday: lastMovementByPerson.size,
        currentlyOnSite,
        completedToday: completedPeople.size,
        totalScansToday: todayLogs.length,
        peakEntryHour,
        peakEntryCount,
      },
      dailyTrends,
      hourlyPeaks: hourlyBuckets,
      departmentDistribution,
    });
  });

  // Protected Settings Endpoints
  app.get('/api/settings', requireAdmin, (_req, res) => {
    const s = getResolvedSettingsMap();
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
      db_provider: s.db_provider === 'supabase' ? 'supabase' : 'sqlite',
      supabase_url: s.supabase_url || '',
      supabase_key_configured: Boolean(s.supabase_key),
      database_url_configured: Boolean(s.database_url),
      notification_rules: parseNotificationRules(s.notification_rules),
    });
  });

  app.put('/api/settings', requireAdmin, (req, res) => {
    const body = req.body || {};

    if (typeof body.organization_name === 'string' && body.organization_name.trim()) {
      setSetting('organization_name', body.organization_name.trim().slice(0, 80));
    }

    if (body.cooldown_seconds !== undefined) {
      const cd = Math.min(60, Math.max(5, Number(body.cooldown_seconds) || 15));
      setSetting('cooldown_seconds', String(cd));
    }

    if (typeof body.admin_email === 'string') {
      setSetting('admin_email', body.admin_email.trim());
    }

    if (typeof body.email_alerts_enabled === 'boolean') {
      setSetting('email_alerts_enabled', String(body.email_alerts_enabled));
    }

    if (typeof body.smtp_host === 'string') {
      setSetting('smtp_host', body.smtp_host.trim());
    }

    if (body.smtp_port !== undefined) {
      const port = Number(body.smtp_port) || 587;
      setSetting('smtp_port', String(port));
    }

    if (typeof body.smtp_secure === 'boolean') {
      setSetting('smtp_secure', String(body.smtp_secure));
    }

    if (typeof body.smtp_user === 'string') {
      setSetting('smtp_user', body.smtp_user.trim());
    }

    if (typeof body.smtp_pass === 'string' && body.smtp_pass.length > 0) {
      setSetting('smtp_pass', encryptSecret(body.smtp_pass));
    }

    if (typeof body.smtp_from === 'string') {
      setSetting('smtp_from', body.smtp_from.trim());
    }

    if (body.db_provider === 'sqlite' || body.db_provider === 'supabase') {
      setSetting('db_provider', body.db_provider);
    }

    if (typeof body.supabase_url === 'string') {
      setSetting('supabase_url', body.supabase_url.trim());
    }

    if (typeof body.supabase_key === 'string' && body.supabase_key.trim().length > 0) {
      setSetting('supabase_key', encryptSecret(body.supabase_key.trim()));
    }

    if (typeof body.database_url === 'string' && body.database_url.trim().length > 0) {
      setSetting('database_url', encryptSecret(body.database_url.trim()));
    }

    if (body.notification_rules && typeof body.notification_rules === 'object') {
      const sanitizedRules = parseNotificationRules(body.notification_rules);
      setSetting('notification_rules', JSON.stringify(sanitizedRules));
    }

    if (typeof body.new_pin === 'string' && body.new_pin.trim().length > 0) {
      const newPin = body.new_pin.trim();
      if (newPin.length < 4) {
        res.status(400).json({ error: 'El nuevo PIN debe tener al menos 4 caracteres.' });
        return;
      }
      setSetting('admin_pin_hash', hashPin(newPin));
    }

    const s = getResolvedSettingsMap();
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
      db_provider: s.db_provider === 'supabase' ? 'supabase' : 'sqlite',
      supabase_url: s.supabase_url || '',
      supabase_key_configured: Boolean(s.supabase_key),
      database_url_configured: Boolean(s.database_url),
      notification_rules: parseNotificationRules(s.notification_rules),
    });
  });

  app.post('/api/settings/test-supabase', requireAdmin, async (req, res) => {
    const resolved = getResolvedSettingsMap();
    const supabaseUrl = (
      typeof req.body?.supabase_url === 'string' && req.body.supabase_url.trim()
        ? req.body.supabase_url.trim()
        : resolved.supabase_url || ''
    ).replace(/\/+$/, '');

    const supabaseKey =
      typeof req.body?.supabase_key === 'string' && req.body.supabase_key.trim()
        ? req.body.supabase_key.trim()
        : resolved.supabase_key || '';

    const databaseUrl =
      typeof req.body?.database_url === 'string' && req.body.database_url.trim()
        ? req.body.database_url.trim()
        : resolved.database_url || '';

    if (!supabaseUrl && !databaseUrl) {
      res.status(400).json({
        error: 'Debe ingresar la URL y clave API de Supabase o la cadena PostgreSQL (DATABASE_URL).',
      });
      return;
    }

    const verifiedParts: string[] = [];

    if (supabaseUrl) {
      try {
        const parsed = new URL(supabaseUrl);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          res.status(400).json({ error: 'La URL de Supabase debe iniciar con https://.' });
          return;
        }
      } catch {
        res.status(400).json({ error: 'El formato de la URL de Supabase no es válido.' });
        return;
      }

      if (!supabaseKey) {
        res.status(400).json({
          error: 'Debe ingresar la clave API (publishable / anon / service_role) de Supabase.',
        });
        return;
      }

      const apiCheck = await verifySupabaseApi(supabaseUrl, supabaseKey, 8000);
      if (!apiCheck.ok) {
        res.status(apiCheck.status === 401 || apiCheck.status === 403 ? apiCheck.status : 400).json({
          error: apiCheck.error || 'No se pudo verificar la API de Supabase.',
        });
        return;
      }
      verifiedParts.push(`API Supabase (${supabaseUrl}) · HTTP ${apiCheck.status}`);
    }

    if (databaseUrl) {
      const pgCheck = await verifyPostgresTcp(databaseUrl, 5000);
      if (!pgCheck.ok) {
        res.status(400).json({
          error: pgCheck.error || 'No se pudo conectar con PostgreSQL externo.',
        });
        return;
      }
      verifiedParts.push(`PostgreSQL TCP (${pgCheck.host}:${pgCheck.port})`);
    }

    res.json({
      ok: true,
      message: `Conexión verificada: ${verifiedParts.join(' · ')}.`,
    });
  });

  app.post('/api/settings/test-email', requireAdmin, async (req, res) => {
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
    console.log(`ControlQR server listening on http://localhost:${PORT}`);
  });
}

startServer();
