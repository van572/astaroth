import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'controlqr.db');
const MASTER_KEY_PATH = path.join(DATA_DIR, '.master.key');

const DATABASE_URL = process.env.DATABASE_URL?.trim() || '';
export const isPostgres = Boolean(DATABASE_URL);

let sqliteDb: Database.Database | null = null;
let pgPool: Pool | null = null;

if (isPostgres) {
  const isLocalPg =
    DATABASE_URL.includes('localhost') || DATABASE_URL.includes('127.0.0.1');
  pgPool = new Pool({
    connectionString: DATABASE_URL,
    ssl: isLocalPg ? false : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
} else {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  sqliteDb = new Database(DB_PATH);
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('foreign_keys = ON');
}

function getEncryptionKey(): Buffer {
  const envKey = process.env.SMTP_ENCRYPTION_KEY?.trim();
  if (envKey) {
    return crypto.createHash('sha256').update(envKey).digest();
  }

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (fs.existsSync(MASTER_KEY_PATH)) {
    const hex = fs.readFileSync(MASTER_KEY_PATH, 'utf8').trim();
    if (/^[0-9a-f]{64}$/i.test(hex)) {
      return Buffer.from(hex, 'hex');
    }
  }

  const generated = crypto.randomBytes(32);
  fs.writeFileSync(MASTER_KEY_PATH, generated.toString('hex'), { mode: 0o600 });
  return generated;
}

export function encryptSecret(plainText: string): string {
  if (!plainText) return '';
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(stored: string): string {
  if (!stored) return '';
  if (!stored.startsWith('enc:v1:')) {
    return stored;
  }
  const parts = stored.split(':');
  if (parts.length !== 5) return '';
  try {
    const iv = Buffer.from(parts[2], 'hex');
    const tag = Buffer.from(parts[3], 'hex');
    const payload = Buffer.from(parts[4], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(payload), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

export function hashPin(pin: string): string {
  return crypto.createHash('sha256').update(`controlqr-pin-salt:${pin}`).digest('hex');
}

const DEFAULT_PIN = process.env.INITIAL_ADMIN_PIN?.trim() || '1234';
export const DEFAULT_PIN_HASH = hashPin(DEFAULT_PIN);

function toSqliteSql(sql: string): string {
  return sql.replace(/\$(\d+)/g, '?');
}

export async function queryOne<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  if (pgPool) {
    const res = await pgPool.query(sql, params);
    return res.rows[0] as T | undefined;
  }
  if (!sqliteDb) throw new Error('SQLite no inicializado');
  return sqliteDb.prepare(toSqliteSql(sql)).get(...params) as T | undefined;
}

export async function queryAll<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  if (pgPool) {
    const res = await pgPool.query(sql, params);
    return res.rows as T[];
  }
  if (!sqliteDb) throw new Error('SQLite no inicializado');
  return sqliteDb.prepare(toSqliteSql(sql)).all(...params) as T[];
}

export async function execute(
  sql: string,
  params: unknown[] = []
): Promise<{ lastInsertId: number; changes: number }> {
  if (pgPool) {
    const res = await pgPool.query(sql, params);
    const firstRow = res.rows[0] as { id?: number | string } | undefined;
    return {
      lastInsertId: firstRow?.id !== undefined ? Number(firstRow.id) : 0,
      changes: res.rowCount ?? 0,
    };
  }
  if (!sqliteDb) throw new Error('SQLite no inicializado');
  const cleanSql = toSqliteSql(sql).replace(/\s+RETURNING\s+id\s*$/i, '');
  const info = sqliteDb.prepare(cleanSql).run(...params);
  return {
    lastInsertId: Number(info.lastInsertRowid || 0),
    changes: info.changes,
  };
}

export async function initDatabase(): Promise<void> {
  if (pgPool) {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS personnel (
        id SERIAL PRIMARY KEY,
        qr_token TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL,
        document_id TEXT UNIQUE NOT NULL,
        role_department TEXT NOT NULL,
        photo_data TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS attendance_logs (
        id SERIAL PRIMARY KEY,
        personnel_id INTEGER NOT NULL REFERENCES personnel(id),
        movement_type TEXT NOT NULL CHECK(movement_type IN ('Entrada', 'Salida')),
        scanned_at TEXT NOT NULL,
        local_date TEXT NOT NULL,
        local_time TEXT NOT NULL,
        email_status TEXT NOT NULL DEFAULT 'skipped',
        email_error TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_logs(local_date);
      CREATE INDEX IF NOT EXISTS idx_attendance_personnel_date ON attendance_logs(personnel_id, local_date);
      CREATE INDEX IF NOT EXISTS idx_personnel_qr ON personnel(qr_token);
    `);
  } else if (sqliteDb) {
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS personnel (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        qr_token TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL,
        document_id TEXT UNIQUE NOT NULL,
        role_department TEXT NOT NULL,
        photo_data TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS attendance_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        personnel_id INTEGER NOT NULL,
        movement_type TEXT NOT NULL CHECK(movement_type IN ('Entrada', 'Salida')),
        scanned_at TEXT NOT NULL,
        local_date TEXT NOT NULL,
        local_time TEXT NOT NULL,
        email_status TEXT NOT NULL DEFAULT 'skipped',
        email_error TEXT,
        FOREIGN KEY (personnel_id) REFERENCES personnel(id)
      );

      CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_logs(local_date);
      CREATE INDEX IF NOT EXISTS idx_attendance_personnel_date ON attendance_logs(personnel_id, local_date);
      CREATE INDEX IF NOT EXISTS idx_personnel_qr ON personnel(qr_token);
    `);
  }

  const envPass = process.env.SMTP_PASS || '';
  const hasEnvSmtp = Boolean(process.env.SMTP_HOST?.trim() && process.env.ADMIN_EMAIL?.trim());

  const defaultSettings: Record<string, string> = {
    admin_pin_hash: DEFAULT_PIN_HASH,
    organization_name: 'ControlQR Corporativo',
    cooldown_seconds: '15',
    admin_email: process.env.ADMIN_EMAIL?.trim() || '',
    email_alerts_enabled: hasEnvSmtp ? 'true' : 'false',
    smtp_host: process.env.SMTP_HOST?.trim() || '',
    smtp_port: process.env.SMTP_PORT?.trim() || '587',
    smtp_secure: process.env.SMTP_SECURE === 'true' ? 'true' : 'false',
    smtp_user: process.env.SMTP_USER?.trim() || '',
    smtp_pass: envPass ? encryptSecret(envPass) : '',
    smtp_from: process.env.SMTP_FROM?.trim() || '',
  };

  for (const [key, value] of Object.entries(defaultSettings)) {
    await execute(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
      [key, value]
    );
  }
}

export async function getSetting(key: string): Promise<string> {
  const row = await queryOne<{ value: string }>('SELECT value FROM settings WHERE key = $1', [key]);
  return row ? row.value : '';
}

export async function setSetting(key: string, value: string): Promise<void> {
  await execute(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}

export async function getAllSettingsMap(): Promise<Record<string, string>> {
  const rows = await queryAll<{ key: string; value: string }>('SELECT key, value FROM settings');
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.key] = row.value;
  }
  return map;
}

export async function getResolvedSettingsMap(): Promise<Record<string, string>> {
  const map = await getAllSettingsMap();
  const decryptedDbPass = decryptSecret(map.smtp_pass || '');
  return {
    ...map,
    admin_email: map.admin_email || process.env.ADMIN_EMAIL?.trim() || '',
    smtp_host: map.smtp_host || process.env.SMTP_HOST?.trim() || '',
    smtp_port: map.smtp_port || process.env.SMTP_PORT?.trim() || '587',
    smtp_secure: map.smtp_secure || (process.env.SMTP_SECURE === 'true' ? 'true' : 'false'),
    smtp_user: map.smtp_user || process.env.SMTP_USER?.trim() || '',
    smtp_pass: decryptedDbPass || process.env.SMTP_PASS || '',
    smtp_from: map.smtp_from || process.env.SMTP_FROM?.trim() || '',
  };
}
