import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const rawDataDir = process.env.DATA_DIR?.trim() || '';
const dataDirIsPostgresUrl = /^postgres(ql)?:\/\//i.test(rawDataDir);
const DATA_DIR = rawDataDir && !dataDirIsPostgresUrl
  ? path.resolve(rawDataDir)
  : path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'controlqr.db');
const MASTER_KEY_PATH = path.join(DATA_DIR, '.master.key');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function getEncryptionKey(): Buffer {
  const envKey = process.env.SMTP_ENCRYPTION_KEY?.trim();
  if (envKey) {
    return crypto.createHash('sha256').update(envKey).digest();
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

export async function execute(sql: string, params: unknown[] = []): Promise<unknown> {
  const normalizedSql = sql.replace(/\$\d+/g, '?');
  return db.prepare(normalizedSql).run(...params);
}

const DEFAULT_PIN = process.env.INITIAL_ADMIN_PIN?.trim() || '1234';
export const DEFAULT_PIN_HASH = hashPin(DEFAULT_PIN);

export function initDatabase(): void {
  db.exec(`
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
      client_scan_id TEXT,
      FOREIGN KEY (personnel_id) REFERENCES personnel(id)
    );

    CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_logs(local_date);
    CREATE INDEX IF NOT EXISTS idx_attendance_personnel_date ON attendance_logs(personnel_id, local_date);
    CREATE INDEX IF NOT EXISTS idx_personnel_qr ON personnel(qr_token);
  `);

  const logColumns = db.prepare('PRAGMA table_info(attendance_logs)').all() as Array<{ name: string }>;
  if (!logColumns.some((col) => col.name === 'client_scan_id')) {
    db.exec('ALTER TABLE attendance_logs ADD COLUMN client_scan_id TEXT;');
  }
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_client_scan_id ON attendance_logs(client_scan_id) WHERE client_scan_id IS NOT NULL;'
  );

  const envPass = process.env.SMTP_PASS || '';
  const hasEnvSmtp = Boolean(process.env.SMTP_HOST?.trim() && process.env.ADMIN_EMAIL?.trim());
  const envSupabaseKey = process.env.SUPABASE_KEY?.trim() || '';
  const envDatabaseUrl = process.env.DATABASE_URL?.trim() || (dataDirIsPostgresUrl ? rawDataDir : '');
  const hasEnvSupabase = Boolean(process.env.SUPABASE_URL?.trim() || envDatabaseUrl);

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
    db_provider: hasEnvSupabase ? 'supabase' : 'sqlite',
    supabase_url: process.env.SUPABASE_URL?.trim() || '',
    supabase_key: envSupabaseKey ? encryptSecret(envSupabaseKey) : '',
    database_url: envDatabaseUrl ? encryptSecret(envDatabaseUrl) : '',
    notification_rules: JSON.stringify({
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
    }),
  };

  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );

  const tx = db.transaction(() => {
    for (const [key, value] of Object.entries(defaultSettings)) {
      insertSetting.run(key, value);
    }
  });
  tx();
}

export function getSetting(key: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row ? row.value : '';
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

export function getAllSettingsMap(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{
    key: string;
    value: string;
  }>;
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.key] = row.value;
  }
  return map;
}

export function getResolvedSettingsMap(): Record<string, string> {
  const map = getAllSettingsMap();
  const decryptedDbPass = decryptSecret(map.smtp_pass || '');
  const decryptedSupabaseKey = decryptSecret(map.supabase_key || '');
  const decryptedDatabaseUrl = decryptSecret(map.database_url || '');
  return {
    ...map,
    admin_email: map.admin_email || process.env.ADMIN_EMAIL?.trim() || '',
    smtp_host: map.smtp_host || process.env.SMTP_HOST?.trim() || '',
    smtp_port: map.smtp_port || process.env.SMTP_PORT?.trim() || '587',
    smtp_secure: map.smtp_secure || (process.env.SMTP_SECURE === 'true' ? 'true' : 'false'),
    smtp_user: map.smtp_user || process.env.SMTP_USER?.trim() || '',
    smtp_pass: decryptedDbPass || process.env.SMTP_PASS || '',
    smtp_from: map.smtp_from || process.env.SMTP_FROM?.trim() || '',
    db_provider: map.db_provider === 'supabase' ? 'supabase' : 'sqlite',
    supabase_url: map.supabase_url || process.env.SUPABASE_URL?.trim() || '',
    supabase_key: decryptedSupabaseKey || process.env.SUPABASE_KEY?.trim() || '',
    database_url: decryptedDatabaseUrl || process.env.DATABASE_URL?.trim() || (dataDirIsPostgresUrl ? rawDataDir : ''),
  };
}
