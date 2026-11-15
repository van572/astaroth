export type ModuleView = 'home' | 'scanner' | 'register' | 'admin';

export type MovementType = 'Entrada' | 'Salida';

export type EmailDeliveryStatus = 'sent' | 'failed' | 'skipped' | 'pending';

export interface Personnel {
  id: number;
  qr_token: string;
  full_name: string;
  document_id: string;
  role_department: string;
  photo_data: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  last_movement_today?: MovementType | null;
  last_scanned_today?: string | null;
  total_logs?: number;
}

export interface AttendanceLog {
  id: number;
  personnel_id: number;
  movement_type: MovementType;
  scanned_at: string;
  local_date: string;
  local_time: string;
  email_status: EmailDeliveryStatus;
  email_error: string | null;
  full_name: string;
  document_id: string;
  role_department: string;
  photo_data: string | null;
  is_active: number;
}

export interface DailyAttendanceRow {
  document_id: string;
  full_name: string;
  role_department: string;
  date: string;
  entry_time: string;
  exit_time: string;
  status: string;
  personnel_id: number;
  is_active: number;
}

export interface ScanResponse {
  status: 'success' | 'cooldown' | 'inactive' | 'invalid';
  message: string;
  movementType?: MovementType;
  scannedAt?: string;
  localDate?: string;
  localTime?: string;
  cooldownSeconds?: number;
  remainingSeconds?: number;
  lastMovement?: MovementType;
  offlineQueued?: boolean;
  person?: {
    id: number;
    full_name: string;
    document_id: string;
    role_department: string;
    photo_data: string | null;
    is_active: number;
  };
}

export interface CachedScannerPerson {
  id: number;
  qr_token: string;
  full_name: string;
  document_id: string;
  role_department: string;
  photo_data: string | null;
  is_active: number;
  last_movement_today: MovementType | null;
  last_movement_date: string | null;
  last_scanned_at: string | null;
}

export interface ScannerBootstrapResponse {
  cooldownSeconds: number;
  organizationName: string;
  serverDate: string;
  syncedAt: string;
  personnel: Array<{
    id: number;
    qr_token: string;
    full_name: string;
    document_id: string;
    role_department: string;
    photo_data: string | null;
    is_active: number;
    last_movement_today: MovementType | null;
    last_scanned_at: string | null;
  }>;
}

export interface PendingOfflineScan {
  clientScanId: string;
  qrToken: string;
  personId: number;
  fullName: string;
  documentId: string;
  roleDepartment: string;
  movementType: MovementType;
  scannedAt: string;
  localDate: string;
  localTime: string;
  attempts: number;
  lastError?: string;
}

export interface SyncBatchResultItem {
  clientScanId: string;
  status: 'synced' | 'duplicate' | 'rejected';
  movementType?: MovementType;
  reason?: string;
}

export interface SyncBatchResponse {
  syncedCount: number;
  duplicateCount: number;
  rejectedCount: number;
  results: SyncBatchResultItem[];
}

export interface NotificationRules {
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

export interface AppSettings {
  organization_name: string;
  cooldown_seconds: number;
  admin_email: string;
  email_alerts_enabled: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_pass_configured: boolean;
  smtp_from: string;
  is_default_pin: boolean;
  db_provider: 'sqlite' | 'supabase';
  supabase_url: string;
  supabase_key_configured: boolean;
  database_url_configured: boolean;
  notification_rules: NotificationRules;
}

export interface BulkImportRowInput {
  rowNumber: number;
  full_name: string;
  document_id: string;
  role_department: string;
}

export interface BulkImportError {
  rowNumber: number;
  document_id: string;
  full_name: string;
  reason: string;
}

export interface BulkImportResponse {
  created: Personnel[];
  errors: BulkImportError[];
}

export interface AnalyticsDailyPoint {
  date: string;
  label: string;
  entries: number;
  exits: number;
  uniquePeople: number;
}

export interface AnalyticsHourlyPoint {
  hour: number;
  label: string;
  entries: number;
  exits: number;
}

export interface AnalyticsDepartmentPoint {
  department: string;
  totalActive: number;
  presentToday: number;
  currentlyOnSite: number;
}

export interface AnalyticsResponse {
  date: string;
  summary: {
    totalActive: number;
    presentToday: number;
    currentlyOnSite: number;
    completedToday: number;
    totalScansToday: number;
    peakEntryHour: string | null;
    peakEntryCount: number;
  };
  dailyTrends: AnalyticsDailyPoint[];
  hourlyPeaks: AnalyticsHourlyPoint[];
  departmentDistribution: AnalyticsDepartmentPoint[];
}
