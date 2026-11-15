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
  person?: {
    id: number;
    full_name: string;
    document_id: string;
    role_department: string;
    photo_data: string | null;
    is_active: number;
  };
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
}
