import type {
  AnalyticsResponse,
  AppSettings,
  AttendanceLog,
  BulkImportResponse,
  BulkImportRowInput,
  DailyAttendanceRow,
  NotificationRules,
  Personnel,
  ScanResponse,
} from '../types';

const TOKEN_STORAGE_KEY = 'controlqr_admin_token';

export function getStoredAdminToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredAdminToken(token: string | null): void {
  try {
    if (token) {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage restriction
  }
}

export function getLocalDateString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getLocalTimeString(date: Date = new Date()): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

async function apiFetch<T>(
  url: string,
  options: RequestInit = {},
  requireAuth = false
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  if (requireAuth) {
    const token = getStoredAdminToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = new Error(data.error || data.message || `Error ${res.status}`) as Error & {
      status?: number;
      payload?: unknown;
    };
    err.status = res.status;
    err.payload = data;
    if (res.status === 401 && requireAuth) {
      setStoredAdminToken(null);
    }
    throw err;
  }

  return data as T;
}

export async function fetchAuthStatus(): Promise<{
  authenticated: boolean;
  isDefaultPin: boolean;
  organizationName: string;
}> {
  const token = getStoredAdminToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch('/api/auth/status', { headers });
  if (!res.ok) {
    return { authenticated: false, isDefaultPin: false, organizationName: 'ControlQR Corporativo' };
  }
  return res.json();
}

export async function verifyAdminPin(pin: string): Promise<string> {
  const res = await apiFetch<{ token: string }>('/api/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ pin }),
  });
  setStoredAdminToken(res.token);
  return res.token;
}

export async function logoutAdmin(): Promise<void> {
  const token = getStoredAdminToken();
  if (token) {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => undefined);
  }
  setStoredAdminToken(null);
}

export async function fetchDatabaseStatus(): Promise<{
  dbActive: boolean;
  provider: 'sqlite' | 'supabase';
  label: string;
}> {
  return apiFetch('/api/db/status');
}

export async function fetchScannerConfig(): Promise<{
  cooldownSeconds: number;
  organizationName: string;
}> {
  return apiFetch('/api/scanner/config');
}

export async function submitQrScan(qrToken: string): Promise<ScanResponse> {
  const now = new Date();
  const res = await fetch('/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      qrToken,
      localDate: getLocalDateString(now),
      localTime: getLocalTimeString(now),
    }),
  });
  return res.json();
}

export async function fetchPersonnel(): Promise<Personnel[]> {
  const today = getLocalDateString();
  return apiFetch<Personnel[]>(`/api/personnel?date=${encodeURIComponent(today)}`, {}, true);
}

export async function createPersonnel(input: {
  full_name: string;
  document_id: string;
  role_department: string;
  photo_data: string | null;
}): Promise<Personnel> {
  return apiFetch<Personnel>(
    '/api/personnel',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
    true
  );
}

export async function bulkCreatePersonnel(
  rows: BulkImportRowInput[]
): Promise<BulkImportResponse> {
  return apiFetch<BulkImportResponse>(
    '/api/personnel/bulk',
    {
      method: 'POST',
      body: JSON.stringify({ rows }),
    },
    true
  );
}

export async function updatePersonnel(
  id: number,
  input: {
    full_name: string;
    document_id: string;
    role_department: string;
    photo_data?: string | null;
  }
): Promise<Personnel> {
  return apiFetch<Personnel>(
    `/api/personnel/${id}`,
    {
      method: 'PUT',
      body: JSON.stringify(input),
    },
    true
  );
}

export async function togglePersonnelStatus(id: number, isActive: boolean): Promise<Personnel> {
  return apiFetch<Personnel>(
    `/api/personnel/${id}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ is_active: isActive }),
    },
    true
  );
}

export async function fetchAttendanceLogs(date?: string): Promise<AttendanceLog[]> {
  const query = date ? `?date=${encodeURIComponent(date)}` : '';
  return apiFetch<AttendanceLog[]>(`/api/logs${query}`, {}, true);
}

export async function fetchAttendanceReport(
  date: string,
  includeAbsent: boolean
): Promise<DailyAttendanceRow[]> {
  return apiFetch<DailyAttendanceRow[]>(
    `/api/attendance-report?date=${encodeURIComponent(date)}&includeAbsent=${includeAbsent}`,
    {},
    true
  );
}

export async function fetchAnalytics(date: string): Promise<AnalyticsResponse> {
  return apiFetch<AnalyticsResponse>(
    `/api/analytics?date=${encodeURIComponent(date)}`,
    {},
    true
  );
}

export async function fetchSettings(): Promise<AppSettings> {
  return apiFetch<AppSettings>('/api/settings', {}, true);
}

export async function updateSettings(payload: Partial<{
  organization_name: string;
  cooldown_seconds: number;
  admin_email: string;
  email_alerts_enabled: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_pass: string;
  smtp_from: string;
  new_pin: string;
  db_provider: 'sqlite' | 'supabase';
  supabase_url: string;
  supabase_key: string;
  database_url: string;
  notification_rules: NotificationRules;
}>): Promise<AppSettings> {
  return apiFetch<AppSettings>(
    '/api/settings',
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
    true
  );
}

export async function sendTestEmailRequest(payload: Record<string, unknown>): Promise<{ ok: boolean; message: string }> {
  return apiFetch<{ ok: boolean; message: string }>(
    '/api/settings/test-email',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    true
  );
}

export async function testSupabaseConnection(payload: {
  supabase_url: string;
  supabase_key?: string;
  database_url?: string;
}): Promise<{ ok: boolean; message: string }> {
  return apiFetch<{ ok: boolean; message: string }>(
    '/api/settings/test-supabase',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    true
  );
}
