import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Ban,
  BarChart3,
  BellRing,
  CheckCircle2,
  Database,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FileSpreadsheet,
  KeyRound,
  Mail,
  Plus,
  QrCode,
  RefreshCw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import type {
  AnalyticsResponse,
  AppSettings,
  AttendanceLog,
  DailyAttendanceRow,
  NotificationRules,
  Personnel,
} from '../types';
import {
  fetchAnalytics,
  fetchAttendanceLogs,
  fetchAttendanceReport,
  fetchPersonnel,
  fetchSettings,
  getLocalDateString,
  sendTestEmailRequest,
  testSupabaseConnection,
  togglePersonnelStatus,
  updatePersonnel,
  updateSettings,
} from '../utils/api';
import { getInitials, resizePhotoFile } from '../utils/cardExporter';
import { exportAttendanceCsv, exportAttendanceXlsx } from '../utils/reportExporter';
import { refreshDatabaseStatus } from '../hooks/useDatabaseStatus';
import { AttendanceChartsSection } from './AttendanceChartsSection';
import { DatabaseStatusDot } from './DatabaseStatusDot';
import { IdCardPreview } from './IdCardPreview';

interface AdminModuleProps {
  organizationName: string;
  onOrganizationNameChange: (name: string) => void;
  onAuthExpired: () => void;
}

type AdminTab = 'overview' | 'personnel' | 'reports' | 'settings';
type PersonnelFilter = 'all' | 'active' | 'inactive';
type ReportViewMode = 'consolidated' | 'realtime';

const DEFAULT_RULES: NotificationRules = {
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

export function AdminModule({
  organizationName,
  onOrganizationNameChange,
  onAuthExpired,
}: AdminModuleProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');

  // Data state
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [reportRows, setReportRows] = useState<DailyAttendanceRow[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);

  const [loading, setLoading] = useState(true);
  const [errorBanner, setErrorBanner] = useState('');

  // Personnel filters & modals
  const [personSearch, setPersonSearch] = useState('');
  const [personFilter, setPersonFilter] = useState<PersonnelFilter>('all');
  const [editingPerson, setEditingPerson] = useState<Personnel | null>(null);
  const [cardModalPerson, setCardModalPerson] = useState<Personnel | null>(null);

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editDocId, setEditDocId] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editPhoto, setEditPhoto] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const editFileInputRef = useRef<HTMLInputElement | null>(null);

  // Reports filters
  const [selectedDate, setSelectedDate] = useState<string>(() => getLocalDateString());
  const [reportSearch, setReportSearch] = useState('');
  const [includeAbsent, setIncludeAbsent] = useState(false);
  const [reportViewMode, setReportViewMode] = useState<ReportViewMode>('consolidated');
  const [liveRefresh, setLiveRefresh] = useState(true);

  // Settings form state
  const [orgInput, setOrgInput] = useState('');
  const [cooldownInput, setCooldownInput] = useState(15);
  const [adminEmailInput, setAdminEmailInput] = useState('');
  const [alertsEnabledInput, setAlertsEnabledInput] = useState(false);
  const [smtpHostInput, setSmtpHostInput] = useState('');
  const [smtpPortInput, setSmtpPortInput] = useState(587);
  const [smtpSecureInput, setSmtpSecureInput] = useState(false);
  const [smtpUserInput, setSmtpUserInput] = useState('');
  const [smtpPassInput, setSmtpPassInput] = useState('');
  const [smtpFromInput, setSmtpFromInput] = useState('');
  const [newPinInput, setNewPinInput] = useState('');
  const [secretDbUnlocked, setSecretDbUnlocked] = useState(false);
  const [dbProviderInput, setDbProviderInput] = useState<'sqlite' | 'supabase'>('sqlite');
  const [supabaseUrlInput, setSupabaseUrlInput] = useState('');
  const [supabaseKeyInput, setSupabaseKeyInput] = useState('');
  const [databaseUrlInput, setDatabaseUrlInput] = useState('');
  const [testingSupabase, setTestingSupabase] = useState(false);
  const [rulesInput, setRulesInput] = useState<NotificationRules>(DEFAULT_RULES);
  const [customDeptInput, setCustomDeptInput] = useState('');
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );
  const [testingEmail, setTestingEmail] = useState(false);

  const handleApiError = useCallback(
    (err: unknown) => {
      const e = err as Error & { status?: number };
      if (e.status === 401) {
        onAuthExpired();
        return;
      }
      setErrorBanner(e.message || 'Error cargando datos del panel.');
    },
    [onAuthExpired]
  );

  const loadAllData = useCallback(
    async (dateForReport: string, absentFlag: boolean, silent = false) => {
      if (!silent) setLoading(true);
      try {
        const [pList, lList, rList, aData, sData] = await Promise.all([
          fetchPersonnel(),
          fetchAttendanceLogs(dateForReport),
          fetchAttendanceReport(dateForReport, absentFlag),
          fetchAnalytics(dateForReport),
          fetchSettings(),
        ]);
        setPersonnel(pList);
        setLogs(lList);
        setReportRows(rList);
        setAnalytics(aData);
        setSettings(sData);

        if (!silent) {
          setOrgInput(sData.organization_name);
          setCooldownInput(sData.cooldown_seconds);
          setAdminEmailInput(sData.admin_email);
          setAlertsEnabledInput(sData.email_alerts_enabled);
          setSmtpHostInput(sData.smtp_host);
          setSmtpPortInput(sData.smtp_port);
          setSmtpSecureInput(sData.smtp_secure);
          setSmtpUserInput(sData.smtp_user);
          setSmtpFromInput(sData.smtp_from);
          setDbProviderInput(sData.db_provider || 'sqlite');
          setSupabaseUrlInput(sData.supabase_url || '');
          setRulesInput(sData.notification_rules || DEFAULT_RULES);
        }
        setErrorBanner('');
      } catch (err) {
        handleApiError(err);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [handleApiError]
  );

  useEffect(() => {
    loadAllData(selectedDate, includeAbsent, false);
  }, [loadAllData, selectedDate, includeAbsent]);

  // Real-time auto-polling for live attendance & logs
  useEffect(() => {
    if (!liveRefresh) return;
    const timer = setInterval(() => {
      loadAllData(selectedDate, includeAbsent, true);
    }, 5000);
    return () => clearInterval(timer);
  }, [liveRefresh, loadAllData, selectedDate, includeAbsent]);

  const filteredPersonnel = useMemo(() => {
    const q = personSearch.trim().toLowerCase();
    return personnel.filter((p) => {
      if (personFilter === 'active' && p.is_active !== 1) return false;
      if (personFilter === 'inactive' && p.is_active !== 0) return false;
      if (!q) return true;
      return (
        p.full_name.toLowerCase().includes(q) ||
        p.document_id.toLowerCase().includes(q) ||
        p.role_department.toLowerCase().includes(q)
      );
    });
  }, [personnel, personSearch, personFilter]);

  const filteredReportRows = useMemo(() => {
    const q = reportSearch.trim().toLowerCase();
    if (!q) return reportRows;
    return reportRows.filter(
      (r) =>
        r.full_name.toLowerCase().includes(q) ||
        r.document_id.toLowerCase().includes(q) ||
        r.role_department.toLowerCase().includes(q)
    );
  }, [reportRows, reportSearch]);

  const filteredLogs = useMemo(() => {
    const q = reportSearch.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter(
      (l) =>
        l.full_name.toLowerCase().includes(q) ||
        l.document_id.toLowerCase().includes(q) ||
        l.role_department.toLowerCase().includes(q)
    );
  }, [logs, reportSearch]);

  const availableDepartments = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of personnel) {
      const clean = p.role_department.trim();
      if (clean && !map.has(clean.toLowerCase())) {
        map.set(clean.toLowerCase(), clean);
      }
    }
    for (const d of rulesInput.allowedDepartments) {
      const clean = d.trim();
      if (clean && !map.has(clean.toLowerCase())) {
        map.set(clean.toLowerCase(), clean);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b, 'es'));
  }, [personnel, rulesInput.allowedDepartments]);

  const metrics = useMemo(() => {
    const activeCount = personnel.filter((p) => p.is_active === 1).length;
    const onSiteCount = reportRows.filter((r) => r.status === 'En jornada').length;
    const completedCount = reportRows.filter((r) => r.status === 'Completado').length;
    return {
      activeCount,
      onSiteCount,
      completedCount,
      dayLogsCount: logs.length,
    };
  }, [personnel, reportRows, logs]);

  function openEditModal(person: Personnel) {
    setEditingPerson(person);
    setEditName(person.full_name);
    setEditDocId(person.document_id);
    setEditRole(person.role_department);
    setEditPhoto(person.photo_data);
    setEditError('');
  }

  async function handleEditPhotoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const resized = await resizePhotoFile(file);
      setEditPhoto(resized);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Error procesando fotografía.');
    }
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editingPerson) return;
    setEditSaving(true);
    setEditError('');

    try {
      await updatePersonnel(editingPerson.id, {
        full_name: editName.trim(),
        document_id: editDocId.trim(),
        role_department: editRole.trim(),
        photo_data: editPhoto,
      });
      setEditingPerson(null);
      await loadAllData(selectedDate, includeAbsent, true);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Error al actualizar el registro.');
    } finally {
      setEditSaving(false);
    }
  }

  async function handleToggleActive(person: Personnel) {
    try {
      await togglePersonnelStatus(person.id, person.is_active !== 1);
      await loadAllData(selectedDate, includeAbsent, true);
    } catch (err) {
      handleApiError(err);
    }
  }

  async function handleSaveSettings(e: FormEvent) {
    e.preventDefault();
    setSettingsSaving(true);
    setSettingsStatus(null);
    try {
      const updated = await updateSettings({
        organization_name: orgInput.trim(),
        cooldown_seconds: Number(cooldownInput),
        admin_email: adminEmailInput.trim(),
        email_alerts_enabled: alertsEnabledInput,
        smtp_host: smtpHostInput.trim(),
        smtp_port: Number(smtpPortInput),
        smtp_secure: smtpSecureInput,
        smtp_user: smtpUserInput.trim(),
        smtp_pass: smtpPassInput,
        smtp_from: smtpFromInput.trim(),
        new_pin: newPinInput.trim() || undefined,
        db_provider: dbProviderInput,
        supabase_url: supabaseUrlInput.trim(),
        supabase_key: supabaseKeyInput.trim() || undefined,
        database_url: databaseUrlInput.trim() || undefined,
        notification_rules: rulesInput,
      });
      setSettings(updated);
      setRulesInput(updated.notification_rules || DEFAULT_RULES);
      setSmtpPassInput('');
      setSupabaseKeyInput('');
      setDatabaseUrlInput('');
      setNewPinInput('');
      onOrganizationNameChange(updated.organization_name);
      setSettingsStatus({
        type: 'ok',
        text: 'Configuración guardada correctamente.',
      });
      void refreshDatabaseStatus();
    } catch (err) {
      setSettingsStatus({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo guardar la configuración.',
      });
    } finally {
      setSettingsSaving(false);
    }
  }

  async function handleTestSupabase() {
    setTestingSupabase(true);
    setSettingsStatus(null);
    try {
      const res = await testSupabaseConnection({
        supabase_url: supabaseUrlInput.trim(),
        supabase_key: supabaseKeyInput.trim() || undefined,
        database_url: databaseUrlInput.trim() || undefined,
      });
      setSettingsStatus({ type: 'ok', text: res.message });
      void refreshDatabaseStatus();
    } catch (err) {
      setSettingsStatus({
        type: 'err',
        text: err instanceof Error ? err.message : 'No se pudo verificar la conexión con Supabase.',
      });
    } finally {
      setTestingSupabase(false);
    }
  }

  async function handleTestEmail() {
    setTestingEmail(true);
    setSettingsStatus(null);
    try {
      const res = await sendTestEmailRequest({
        organization_name: orgInput.trim(),
        admin_email: adminEmailInput.trim(),
        smtp_host: smtpHostInput.trim(),
        smtp_port: Number(smtpPortInput),
        smtp_secure: smtpSecureInput,
        smtp_user: smtpUserInput.trim(),
        smtp_pass: smtpPassInput || undefined,
        smtp_from: smtpFromInput.trim(),
      });
      setSettingsStatus({ type: 'ok', text: res.message });
    } catch (err) {
      setSettingsStatus({
        type: 'err',
        text: err instanceof Error ? err.message : 'Falló el envío del correo de prueba.',
      });
    } finally {
      setTestingEmail(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      {/* Page Title & Tab Switcher */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Panel de Administración y Reportes
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Gestione carnets del personal, consulte movimientos en tiempo real, exporte asistencia y configure notificaciones por correo.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-200/70 p-1">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'overview'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            Resumen Visual
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('personnel')}
            className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'personnel'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            Personal y Carnets
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('reports')}
            className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'reports'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Asistencia y Reportes
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'settings'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Mail className="h-3.5 w-3.5" />
            Notificaciones y Seguridad
          </button>
        </div>
      </div>

      {errorBanner && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {errorBanner}
        </div>
      )}

      {/* TAB 0: VISUAL ANALYTICS OVERVIEW */}
      {activeTab === 'overview' && (
        <AttendanceChartsSection
          analytics={analytics}
          loading={loading}
          selectedDate={selectedDate}
          onDateChange={(d) => setSelectedDate(d)}
          onRefresh={() => loadAllData(selectedDate, includeAbsent, false)}
        />
      )}

      {/* TAB 1: PERSONNEL MANAGEMENT */}
      {activeTab === 'personnel' && (
        <div className="mt-6 space-y-5">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={personSearch}
                onChange={(e) => setPersonSearch(e.target.value)}
                placeholder="Buscar por nombre, documento o cargo..."
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pr-3.5 pl-10 text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
              />
            </div>

            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              {(
                [
                  { id: 'all', label: `Todos (${personnel.length})` },
                  {
                    id: 'active',
                    label: `Activos (${personnel.filter((p) => p.is_active === 1).length})`,
                  },
                  {
                    id: 'inactive',
                    label: `Desactivados (${personnel.filter((p) => p.is_active === 0).length})`,
                  },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPersonFilter(tab.id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    personFilter === tab.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Personnel Table */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            {loading ? (
              <div className="space-y-3 p-6">
                <div className="h-9 animate-pulse rounded bg-slate-100" />
                <div className="h-9 animate-pulse rounded bg-slate-100" />
                <div className="h-9 animate-pulse rounded bg-slate-100" />
              </div>
            ) : filteredPersonnel.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <Users className="mx-auto h-8 w-8 text-slate-400" />
                <h2 className="mt-3 font-display text-base font-bold text-slate-900">
                  No hay registros para mostrar
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {personnel.length === 0
                    ? 'Registre personal desde el módulo "Registro de Personal" para generar su primer carnet QR.'
                    : 'Pruebe ajustando los términos de búsqueda o el filtro de estado.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="px-4 py-3">Personal</th>
                      <th className="px-4 py-3">Documento / ID</th>
                      <th className="px-4 py-3">Cargo / Departamento</th>
                      <th className="px-4 py-3">Estado del Carnet</th>
                      <th className="px-4 py-3">Último mov. hoy</th>
                      <th className="px-4 py-3 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredPersonnel.map((person) => {
                      const active = person.is_active === 1;
                      return (
                        <tr key={person.id} className="transition-colors hover:bg-slate-50/70">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                                {person.photo_data ? (
                                  <img
                                    src={person.photo_data}
                                    alt={person.full_name}
                                    referrerPolicy="no-referrer"
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center bg-blue-50 text-xs font-bold text-blue-700">
                                    {getInitials(person.full_name)}
                                  </div>
                                )}
                              </div>
                              <span className="font-medium text-slate-900">{person.full_name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs font-medium text-slate-700 tabular-nums">
                            {person.document_id}
                          </td>
                          <td className="px-4 py-3 text-slate-600">{person.role_department}</td>
                          <td className="px-4 py-3">
                            {active ? (
                              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Activo
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700">
                                <Ban className="h-3.5 w-3.5" />
                                Desactivado
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-600 tabular-nums">
                            {person.last_movement_today ? (
                              <span>
                                <strong
                                  className={
                                    person.last_movement_today === 'Entrada'
                                      ? 'text-emerald-700'
                                      : 'text-blue-700'
                                  }
                                >
                                  {person.last_movement_today}
                                </strong>{' '}
                                <span className="font-mono text-slate-500">
                                  ({person.last_scanned_today})
                                </span>
                              </span>
                            ) : (
                              <span className="text-slate-400">Sin registros hoy</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setCardModalPerson(person)}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                              >
                                <QrCode className="h-3.5 w-3.5 text-blue-700" />
                                Carnet
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditModal(person)}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                              >
                                <Edit3 className="h-3.5 w-3.5 text-slate-600" />
                                Editar
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleActive(person)}
                                className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
                                  active
                                    ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                                    : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                }`}
                              >
                                {active ? 'Desactivar' : 'Activar'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: ATTENDANCE REPORTS & REAL-TIME LOGS */}
      {activeTab === 'reports' && (
        <div className="mt-6 space-y-6">
          {/* 4-column summary metrics */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <span className="text-xs text-slate-500">Personal activo</span>
              <div className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                {metrics.activeCount}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <span className="text-xs text-slate-500">En jornada ({selectedDate})</span>
              <div className="mt-1 font-mono text-2xl font-bold text-emerald-700 tabular-nums">
                {metrics.onSiteCount}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <span className="text-xs text-slate-500">Jornadas completadas</span>
              <div className="mt-1 font-mono text-2xl font-bold text-blue-700 tabular-nums">
                {metrics.completedCount}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <span className="text-xs text-slate-500">Lecturas totales del día</span>
              <div className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                {metrics.dayLogsCount}
              </div>
            </div>
          </div>

          {/* Filter & Export Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <label htmlFor="report-date" className="sr-only">
                  Filtrar por fecha
                </label>
                <input
                  id="report-date"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value || getLocalDateString())}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs font-medium text-slate-800 focus:border-blue-700 focus:outline-none"
                />
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={reportSearch}
                  onChange={(e) => setReportSearch(e.target.value)}
                  placeholder="Filtrar nombre o ID..."
                  className="w-52 rounded-lg border border-slate-300 bg-white py-2 pr-3 pl-8 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                />
              </div>

              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={includeAbsent}
                  onChange={(e) => setIncludeAbsent(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-700"
                />
                Incluir personal sin registro
              </label>

              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={liveRefresh}
                  onChange={(e) => setLiveRefresh(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-700"
                />
                Actualización en vivo
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => loadAllData(selectedDate, includeAbsent, false)}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Actualizar
              </button>
              <button
                type="button"
                onClick={() => exportAttendanceCsv(filteredReportRows, selectedDate)}
                disabled={filteredReportRows.length === 0}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5 text-blue-700" />
                Exportar CSV
              </button>
              <button
                type="button"
                onClick={() => exportAttendanceXlsx(filteredReportRows, selectedDate)}
                disabled={filteredReportRows.length === 0}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-40 whitespace-nowrap shrink-0"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Exportar Excel (.xlsx)
              </button>
            </div>
          </div>

          {/* Segmented Table Mode Switcher */}
          <div className="flex items-center gap-1 self-start rounded-lg bg-slate-200/70 p-1 w-fit">
            <button
              type="button"
              onClick={() => setReportViewMode('consolidated')}
              className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                reportViewMode === 'consolidated'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Reporte Diario Consolidado
            </button>
            <button
              type="button"
              onClick={() => setReportViewMode('realtime')}
              className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                reportViewMode === 'realtime'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Historial de Movimientos ({filteredLogs.length})
            </button>
          </div>

          {/* Table View */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            {reportViewMode === 'consolidated' ? (
              filteredReportRows.length === 0 ? (
                <div className="px-6 py-12 text-center text-sm text-slate-600">
                  No hay registros de asistencia para la fecha {selectedDate}.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                        <th className="px-4 py-3">ID</th>
                        <th className="px-4 py-3">Nombre</th>
                        <th className="px-4 py-3">Fecha</th>
                        <th className="px-4 py-3">Hora de Entrada</th>
                        <th className="px-4 py-3">Hora de Salida</th>
                        <th className="px-4 py-3">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredReportRows.map((row, idx) => (
                        <tr
                          key={`${row.personnel_id}-${row.entry_time}-${idx}`}
                          className="hover:bg-slate-50/70"
                        >
                          <td className="px-4 py-2.5 font-mono text-xs font-medium text-slate-700 tabular-nums">
                            {row.document_id}
                          </td>
                          <td className="px-4 py-2.5 font-medium text-slate-900">
                            {row.full_name}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs text-slate-600 tabular-nums">
                            {row.date}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs font-medium text-emerald-700 tabular-nums">
                            {row.entry_time}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs font-medium text-blue-700 tabular-nums">
                            {row.exit_time}
                          </td>
                          <td className="px-4 py-2.5 text-xs font-semibold">
                            <span
                              className={
                                row.status === 'Completado'
                                  ? 'text-blue-700'
                                  : row.status === 'En jornada'
                                  ? 'text-emerald-700'
                                  : 'text-slate-500'
                              }
                            >
                              {row.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : filteredLogs.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-slate-600">
                No hay movimientos individuales registrados para el {selectedDate}.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="px-4 py-3">Hora Exacta</th>
                      <th className="px-4 py-3">ID</th>
                      <th className="px-4 py-3">Nombre</th>
                      <th className="px-4 py-3">Cargo / Depto.</th>
                      <th className="px-4 py-3">Movimiento</th>
                      <th className="px-4 py-3">Notificación Correo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-2.5 font-mono text-xs font-semibold text-slate-800 tabular-nums">
                          {log.local_time}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-600 tabular-nums">
                          {log.document_id}
                        </td>
                        <td className="px-4 py-2.5 font-medium text-slate-900">{log.full_name}</td>
                        <td className="px-4 py-2.5 text-xs text-slate-600">
                          {log.role_department}
                        </td>
                        <td className="px-4 py-2.5 text-xs font-bold">
                          <span
                            className={
                              log.movement_type === 'Entrada'
                                ? 'text-emerald-700'
                                : 'text-blue-700'
                            }
                          >
                            {log.movement_type}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          {log.email_status === 'sent' && (
                            <span className="text-emerald-700 font-medium">Enviado</span>
                          )}
                          {log.email_status === 'pending' && (
                            <span className="text-amber-700 font-medium">Enviando...</span>
                          )}
                          {log.email_status === 'skipped' && (
                            <span className="text-slate-500" title={log.email_error || ''}>
                              {log.email_error || 'Desactivado / Sin SMTP'}
                            </span>
                          )}
                          {log.email_status === 'failed' && (
                            <span className="text-red-700 font-medium" title={log.email_error || ''}>
                              Error: {log.email_error || 'Fallo SMTP'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: SMTP NOTIFICATIONS & SECURITY */}
      {activeTab === 'settings' && (
        <form onSubmit={handleSaveSettings} className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left: Email & SMTP Configuration */}
          <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-6 lg:col-span-7">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h2 className="font-display text-lg font-bold text-slate-900">
                  Alertas Automáticas por Correo (SMTP)
                </h2>
                <p className="mt-0.5 text-xs text-slate-600">
                  Envía un correo en segundo plano al administrador cada vez que se registra una Entrada o Salida válida sin congelar el escáner.
                </p>
              </div>

              <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-800 whitespace-nowrap shrink-0">
                <input
                  type="checkbox"
                  checked={alertsEnabledInput}
                  onChange={(e) => setAlertsEnabledInput(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-700"
                />
                Activar alertas
              </label>
            </div>

            <div>
              <label htmlFor="cfg-admin-email" className="block text-sm font-medium text-slate-700">
                Correo electrónico del administrador (destinatario)
              </label>
              <input
                id="cfg-admin-email"
                type="email"
                value={adminEmailInput}
                onChange={(e) => setAdminEmailInput(e.target.value)}
                placeholder="admin@empresa.com"
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label htmlFor="cfg-smtp-host" className="block text-sm font-medium text-slate-700">
                  Servidor SMTP (Host)
                </label>
                <input
                  id="cfg-smtp-host"
                  type="text"
                  value={smtpHostInput}
                  onChange={(e) => setSmtpHostInput(e.target.value)}
                  placeholder="smtp.gmail.com"
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 font-mono text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="cfg-smtp-port" className="block text-sm font-medium text-slate-700">
                  Puerto
                </label>
                <input
                  id="cfg-smtp-port"
                  type="number"
                  value={smtpPortInput}
                  onChange={(e) => setSmtpPortInput(Number(e.target.value))}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-blue-700 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="cfg-smtp-user" className="block text-sm font-medium text-slate-700">
                  Usuario SMTP
                </label>
                <input
                  id="cfg-smtp-user"
                  type="text"
                  value={smtpUserInput}
                  onChange={(e) => setSmtpUserInput(e.target.value)}
                  placeholder="notificaciones@empresa.com"
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="cfg-smtp-pass" className="block text-sm font-medium text-slate-700">
                  Contraseña / App Password SMTP
                </label>
                <input
                  id="cfg-smtp-pass"
                  type="password"
                  value={smtpPassInput}
                  onChange={(e) => setSmtpPassInput(e.target.value)}
                  placeholder={
                    settings?.smtp_pass_configured
                      ? '•••••••• (guardada, dejar vacío para mantener)'
                      : 'Ingrese contraseña SMTP'
                  }
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 items-center">
              <div>
                <label htmlFor="cfg-smtp-from" className="block text-sm font-medium text-slate-700">
                  Remitente (From) opcional
                </label>
                <input
                  id="cfg-smtp-from"
                  type="text"
                  value={smtpFromInput}
                  onChange={(e) => setSmtpFromInput(e.target.value)}
                  placeholder="ControlQR <no-reply@empresa.com>"
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
                />
              </div>

              <label className="mt-5 inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={smtpSecureInput}
                  onChange={(e) => setSmtpSecureInput(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-700"
                />
                Usar SSL/TLS directo (puerto 465)
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={handleTestEmail}
                disabled={testingEmail}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5 text-blue-700" />
                {testingEmail ? 'Enviando prueba...' : 'Enviar correo de prueba'}
              </button>
            </div>
          </div>

          {/* Right: Security & Terminal Rules */}
          <div className="flex flex-col justify-between space-y-5 rounded-xl border border-slate-200 bg-white p-6 lg:col-span-5">
            <div className="space-y-5">
              <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4">
                <ShieldCheck className="h-5 w-5 text-blue-700" />
                <h2 className="font-display text-lg font-bold text-slate-900">
                  Seguridad y Terminal
                </h2>
              </div>

              <div>
                <label htmlFor="cfg-org-name" className="block text-sm font-medium text-slate-700">
                  Nombre de la organización / sede
                </label>
                <input
                  id="cfg-org-name"
                  type="text"
                  value={orgInput}
                  onChange={(e) => setOrgInput(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Aparece en el encabezado de los carnets QR y en los correos de alerta.
                </p>
              </div>

              <div>
                <label htmlFor="cfg-cooldown" className="block text-sm font-medium text-slate-700">
                  Bloqueo anti-rebote en escáner (segundos)
                </label>
                <div className="mt-1.5 flex items-center gap-4">
                  <input
                    id="cfg-cooldown"
                    type="range"
                    min={10}
                    max={30}
                    step={1}
                    value={cooldownInput}
                    onChange={(e) => setCooldownInput(Number(e.target.value))}
                    className="flex-1 accent-blue-700"
                  />
                  <span className="w-14 rounded-lg border border-slate-200 bg-slate-50 py-1.5 text-center font-mono text-sm font-bold text-slate-900 tabular-nums">
                    {cooldownInput}s
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Evita lecturas duplicadas si una persona mantiene su carnet frente a la cámara.
                </p>
              </div>

              <div>
                <label htmlFor="cfg-new-pin" className="block text-sm font-medium text-slate-700">
                  Cambiar PIN / Contraseña de administrador
                </label>
                <input
                  id="cfg-new-pin"
                  type="password"
                  value={newPinInput}
                  onChange={(e) => setNewPinInput(e.target.value)}
                  placeholder="Dejar vacío para conservar el actual"
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 font-mono text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Mínimo 4 caracteres. Protege el acceso a Registro y Administración.
                </p>
              </div>
            </div>

            <div className="space-y-3 border-t border-slate-100 pt-4">
              {settingsStatus && (
                <div
                  className={`rounded-lg border px-3.5 py-2.5 text-xs font-medium ${
                    settingsStatus.type === 'ok'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : 'border-red-200 bg-red-50 text-red-700'
                  }`}
                >
                  {settingsStatus.text}
                </div>
              )}

              <button
                type="submit"
                disabled={settingsSaving}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-800 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {settingsSaving ? 'Guardando cambios...' : 'Guardar Configuración'}
              </button>
            </div>
          </div>

          {/* Custom Notification Rules Section */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-12">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                  <BellRing className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-display text-lg font-bold text-slate-900">
                    Reglas de Notificación Personalizadas
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-600">
                    Filtre los correos automáticos para recibir alertas únicamente de ciertos departamentos o incidencias específicas (retardos y salidas tempranas).
                  </p>
                </div>
              </div>

              <span className="text-xs font-medium text-slate-500">
                {alertsEnabledInput
                  ? 'Filtro aplicado sobre alertas activas'
                  : 'Active "Activar alertas" en SMTP para enviar correos'}
              </span>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-12">
              {/* Column 1: Department Filter */}
              <div className="space-y-3.5 lg:col-span-5">
                <div>
                  <label className="block text-sm font-semibold text-slate-900">
                    1. Alcance por departamento
                  </label>
                  <p className="text-xs text-slate-500">
                    Elija si las alertas aplican a toda la organización o solo a áreas puntuales.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() =>
                      setRulesInput((prev) => ({ ...prev, departmentScope: 'all' }))
                    }
                    className={`rounded-md px-3 py-2 text-xs font-semibold transition-colors ${
                      rulesInput.departmentScope === 'all'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Todos los departamentos
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setRulesInput((prev) => ({ ...prev, departmentScope: 'selected' }))
                    }
                    className={`rounded-md px-3 py-2 text-xs font-semibold transition-colors ${
                      rulesInput.departmentScope === 'selected'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Solo seleccionados ({rulesInput.allowedDepartments.length})
                  </button>
                </div>

                {rulesInput.departmentScope === 'selected' && (
                  <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium text-slate-700">
                        Departamentos habilitados
                      </span>
                      {availableDepartments.length > 0 && (
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() =>
                              setRulesInput((prev) => ({
                                ...prev,
                                allowedDepartments: [...availableDepartments],
                              }))
                            }
                            className="font-semibold text-blue-700 hover:underline"
                          >
                            Marcar todos
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setRulesInput((prev) => ({
                                ...prev,
                                allowedDepartments: [],
                              }))
                            }
                            className="font-medium text-slate-500 hover:text-slate-800"
                          >
                            Limpiar
                          </button>
                        </div>
                      )}
                    </div>

                    {availableDepartments.length === 0 ? (
                      <p className="text-xs text-slate-500">
                        Aún no hay departamentos registrados en el personal. Agregue uno abajo para preconfigurar la regla.
                      </p>
                    ) : (
                      <div className="grid max-h-44 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
                        {availableDepartments.map((dept) => {
                          const checked = rulesInput.allowedDepartments.some(
                            (d) => d.trim().toLowerCase() === dept.toLowerCase()
                          );
                          return (
                            <label
                              key={dept}
                              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs transition-colors ${
                                checked
                                  ? 'border-blue-600 bg-blue-50 font-medium text-blue-900'
                                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const isChecked = e.target.checked;
                                  setRulesInput((prev) => {
                                    const filtered = prev.allowedDepartments.filter(
                                      (d) => d.trim().toLowerCase() !== dept.toLowerCase()
                                    );
                                    return {
                                      ...prev,
                                      allowedDepartments: isChecked
                                        ? [...filtered, dept]
                                        : filtered,
                                    };
                                  });
                                }}
                                className="h-3.5 w-3.5 rounded border-slate-300 text-blue-700 focus:ring-blue-700"
                              />
                              <span className="truncate">{dept}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}

                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="text"
                        value={customDeptInput}
                        onChange={(e) => setCustomDeptInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const val = customDeptInput.trim();
                            if (!val) return;
                            setRulesInput((prev) => {
                              const exists = prev.allowedDepartments.some(
                                (d) => d.trim().toLowerCase() === val.toLowerCase()
                              );
                              return exists
                                ? prev
                                : {
                                    ...prev,
                                    allowedDepartments: [...prev.allowedDepartments, val],
                                  };
                            });
                            setCustomDeptInput('');
                          }
                        }}
                        placeholder="Agregar cargo/depto. manual..."
                        className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const val = customDeptInput.trim();
                          if (!val) return;
                          setRulesInput((prev) => {
                            const exists = prev.allowedDepartments.some(
                              (d) => d.trim().toLowerCase() === val.toLowerCase()
                            );
                            return exists
                              ? prev
                              : {
                                  ...prev,
                                  allowedDepartments: [...prev.allowedDepartments, val],
                                };
                          });
                          setCustomDeptInput('');
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 whitespace-nowrap shrink-0"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Añadir
                      </button>
                    </div>

                    {rulesInput.allowedDepartments.length === 0 && (
                      <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                        Sin departamentos marcados: no se enviarán alertas por correo hasta seleccionar al menos uno.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Column 2: Incident & Event Type Filter + Schedule */}
              <div className="space-y-4 lg:col-span-7">
                <div>
                  <label className="block text-sm font-semibold text-slate-900">
                    2. Movimientos e incidencias a notificar
                  </label>
                  <p className="text-xs text-slate-500">
                    Defina si desea recibir todos los registros o restringir las alertas a incidencias como retardos y salidas tempranas.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-1.5 rounded-lg bg-slate-100 p-1 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() =>
                      setRulesInput((prev) => ({ ...prev, eventMode: 'all' }))
                    }
                    className={`rounded-md px-3 py-2 text-xs font-semibold transition-colors ${
                      rulesInput.eventMode === 'all'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Todos los movimientos
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setRulesInput((prev) => ({ ...prev, eventMode: 'incidents_only' }))
                    }
                    className={`rounded-md px-3 py-2 text-xs font-semibold transition-colors ${
                      rulesInput.eventMode === 'incidents_only'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Solo incidencias
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setRulesInput((prev) => ({ ...prev, eventMode: 'custom' }))
                    }
                    className={`rounded-md px-3 py-2 text-xs font-semibold transition-colors ${
                      rulesInput.eventMode === 'custom'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Personalizado
                  </button>
                </div>

                {rulesInput.eventMode !== 'all' && (
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {rulesInput.eventMode === 'custom' && (
                      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs">
                        <input
                          type="checkbox"
                          checked={rulesInput.notifyOnEntry}
                          onChange={(e) =>
                            setRulesInput((prev) => ({
                              ...prev,
                              notifyOnEntry: e.target.checked,
                            }))
                          }
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-700"
                        />
                        <div>
                          <span className="block font-semibold text-slate-900">
                            Entradas puntuales
                          </span>
                          <span className="text-slate-500">
                            Ingresos dentro de la hora límite y tolerancia.
                          </span>
                        </div>
                      </label>
                    )}

                    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-xs">
                      <input
                        type="checkbox"
                        checked={rulesInput.notifyOnLateEntry}
                        onChange={(e) =>
                          setRulesInput((prev) => ({
                            ...prev,
                            notifyOnLateEntry: e.target.checked,
                          }))
                        }
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-700"
                      />
                      <div>
                        <span className="block font-semibold text-slate-900">
                          Retardos en entrada
                        </span>
                        <span className="text-slate-600">
                          Entradas posteriores a {rulesInput.workStartTime} + {rulesInput.lateGraceMinutes} min.
                        </span>
                      </div>
                    </label>

                    {rulesInput.eventMode === 'custom' && (
                      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs">
                        <input
                          type="checkbox"
                          checked={rulesInput.notifyOnExit}
                          onChange={(e) =>
                            setRulesInput((prev) => ({
                              ...prev,
                              notifyOnExit: e.target.checked,
                            }))
                          }
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-700"
                        />
                        <div>
                          <span className="block font-semibold text-slate-900">
                            Salidas regulares
                          </span>
                          <span className="text-slate-500">
                            Salidas en horario normal o posterior a la jornada.
                          </span>
                        </div>
                      </label>
                    )}

                    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-xs">
                      <input
                        type="checkbox"
                        checked={rulesInput.notifyOnEarlyExit}
                        onChange={(e) =>
                          setRulesInput((prev) => ({
                            ...prev,
                            notifyOnEarlyExit: e.target.checked,
                          }))
                        }
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-700"
                      />
                      <div>
                        <span className="block font-semibold text-slate-900">
                          Salidas tempranas
                        </span>
                        <span className="text-slate-600">
                          Salidas previas a {rulesInput.workEndTime} (margen {rulesInput.earlyGraceMinutes} min).
                        </span>
                      </div>
                    </label>
                  </div>
                )}

                {/* Schedule Reference Thresholds */}
                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800">
                      Umbrales de horario para detección de incidencias
                    </span>
                    <span className="text-xs text-slate-500">
                      Se incluye el detalle de la incidencia en el asunto del correo
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div>
                      <label htmlFor="rule-start-time" className="block text-xs font-medium text-slate-600">
                        Hora límite entrada
                      </label>
                      <input
                        id="rule-start-time"
                        type="time"
                        value={rulesInput.workStartTime}
                        onChange={(e) =>
                          setRulesInput((prev) => ({
                            ...prev,
                            workStartTime: e.target.value || '09:00',
                          }))
                        }
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label htmlFor="rule-late-grace" className="block text-xs font-medium text-slate-600">
                        Tolerancia (min)
                      </label>
                      <input
                        id="rule-late-grace"
                        type="number"
                        min={0}
                        max={180}
                        value={rulesInput.lateGraceMinutes}
                        onChange={(e) =>
                          setRulesInput((prev) => ({
                            ...prev,
                            lateGraceMinutes: Math.max(0, Math.min(180, Number(e.target.value) || 0)),
                          }))
                        }
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 tabular-nums focus:border-blue-700 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label htmlFor="rule-end-time" className="block text-xs font-medium text-slate-600">
                        Hora mínima salida
                      </label>
                      <input
                        id="rule-end-time"
                        type="time"
                        value={rulesInput.workEndTime}
                        onChange={(e) =>
                          setRulesInput((prev) => ({
                            ...prev,
                            workEndTime: e.target.value || '17:00',
                          }))
                        }
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label htmlFor="rule-early-grace" className="block text-xs font-medium text-slate-600">
                        Margen previo (min)
                      </label>
                      <input
                        id="rule-early-grace"
                        type="number"
                        min={0}
                        max={180}
                        value={rulesInput.earlyGraceMinutes}
                        onChange={(e) =>
                          setRulesInput((prev) => ({
                            ...prev,
                            earlyGraceMinutes: Math.max(0, Math.min(180, Number(e.target.value) || 0)),
                          }))
                        }
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 tabular-nums focus:border-blue-700 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-4">
              <p className="text-xs text-slate-600">
                <strong className="text-slate-900">Resumen activo:</strong>{' '}
                {rulesInput.departmentScope === 'all'
                  ? 'Todos los departamentos'
                  : rulesInput.allowedDepartments.length > 0
                  ? `${rulesInput.allowedDepartments.length} depto(s): ${rulesInput.allowedDepartments.join(', ')}`
                  : 'Ningún departamento seleccionado'}
                {' · '}
                {rulesInput.eventMode === 'all'
                  ? 'Todas las Entradas y Salidas'
                  : rulesInput.eventMode === 'incidents_only'
                  ? [
                      rulesInput.notifyOnLateEntry ? 'Retardos' : null,
                      rulesInput.notifyOnEarlyExit ? 'Salidas tempranas' : null,
                    ]
                      .filter(Boolean)
                      .join(' y ') || 'Ninguna incidencia seleccionada'
                  : [
                      rulesInput.notifyOnEntry ? 'Entradas puntuales' : null,
                      rulesInput.notifyOnLateEntry ? 'Retardos' : null,
                      rulesInput.notifyOnExit ? 'Salidas regulares' : null,
                      rulesInput.notifyOnEarlyExit ? 'Salidas tempranas' : null,
                    ]
                      .filter(Boolean)
                      .join(', ') || 'Ningún evento seleccionado'}
              </p>

              <button
                type="submit"
                disabled={settingsSaving}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Save className="h-3.5 w-3.5" />
                {settingsSaving ? 'Guardando...' : 'Guardar reglas y configuración'}
              </button>
            </div>
          </div>

          {/* Secret Mode: External Database / Supabase Credentials */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-12">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900 text-white">
                  <Database className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="font-display text-base font-bold text-slate-900">
                      Modo Secreto · Base de Datos Externa (Supabase / PostgreSQL)
                    </h2>
                    <DatabaseStatusDot showFullLabel />
                  </div>
                  <p className="text-xs text-slate-600">
                    Almacene cifradas con AES-256-GCM las credenciales de Supabase o PostgreSQL (también compatibles con variables de entorno).
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSecretDbUnlocked((prev) => !prev)}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                {secretDbUnlocked ? (
                  <>
                    <EyeOff className="h-3.5 w-3.5" />
                    Ocultar secretos de BD
                  </>
                ) : (
                  <>
                    <Eye className="h-3.5 w-3.5 text-blue-700" />
                    Abrir modo secreto
                  </>
                )}
              </button>
            </div>

            {secretDbUnlocked && (
              <div className="mt-5 space-y-4 border-t border-slate-100 pt-5">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <label
                      htmlFor="cfg-db-provider"
                      className="block text-sm font-medium text-slate-700"
                    >
                      Modo de almacenamiento activo
                    </label>
                    <select
                      id="cfg-db-provider"
                      value={dbProviderInput}
                      onChange={(e) =>
                        setDbProviderInput(e.target.value === 'supabase' ? 'supabase' : 'sqlite')
                      }
                      className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
                    >
                      <option value="sqlite">SQLite Local (controlqr.db)</option>
                      <option value="supabase">Supabase / PostgreSQL Externo</option>
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label
                      htmlFor="cfg-supabase-url"
                      className="block text-sm font-medium text-slate-700"
                    >
                      Supabase Project URL
                    </label>
                    <input
                      id="cfg-supabase-url"
                      type="url"
                      value={supabaseUrlInput}
                      onChange={(e) => setSupabaseUrlInput(e.target.value)}
                      placeholder="https://tu-proyecto.supabase.co"
                      className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 font-mono text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="cfg-supabase-key"
                      className="block text-sm font-medium text-slate-700"
                    >
                      Supabase API Key (anon o service_role)
                    </label>
                    <input
                      id="cfg-supabase-key"
                      type="password"
                      value={supabaseKeyInput}
                      onChange={(e) => setSupabaseKeyInput(e.target.value)}
                      placeholder={
                        settings?.supabase_key_configured
                          ? '•••••••• (cifrada en servidor, dejar vacío para mantener)'
                          : 'eyJhbGciOiJIUzI1NiIsInR5cCI6...'
                      }
                      className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 font-mono text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="cfg-database-url"
                      className="block text-sm font-medium text-slate-700"
                    >
                      Cadena PostgreSQL (DATABASE_URL)
                    </label>
                    <input
                      id="cfg-database-url"
                      type="password"
                      value={databaseUrlInput}
                      onChange={(e) => setDatabaseUrlInput(e.target.value)}
                      placeholder={
                        settings?.database_url_configured
                          ? '•••••••• (cifrada en servidor, dejar vacío para mantener)'
                          : 'postgresql://postgres:password@db.xxx.supabase.co:5432/postgres'
                      }
                      className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 font-mono text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <KeyRound className="h-3.5 w-3.5 text-slate-400" />
                    <span>
                      Estado de secretos:{' '}
                      <strong className="text-slate-700">
                        {settings?.supabase_key_configured || settings?.database_url_configured
                          ? 'Credenciales cifradas guardadas'
                          : 'Sin credenciales externas guardadas'}
                      </strong>
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={handleTestSupabase}
                    disabled={testingSupabase}
                    className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <Database className="h-3.5 w-3.5 text-blue-700" />
                    {testingSupabase ? 'Verificando Supabase...' : 'Probar conexión Supabase'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </form>
      )}

      {/* EDIT PERSONNEL MODAL */}
      {editingPerson && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="font-display text-lg font-bold text-slate-900">
                Editar Datos de Personal
              </h2>
              <button
                type="button"
                onClick={() => setEditingPerson(null)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">Nombre completo</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    Documento / Código
                  </label>
                  <input
                    type="text"
                    required
                    value={editDocId}
                    onChange={(e) => setEditDocId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">
                    Cargo / Departamento
                  </label>
                  <input
                    type="text"
                    required
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <span className="block text-sm font-medium text-slate-700">Fotografía</span>
                <input
                  ref={editFileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleEditPhotoChange}
                  className="hidden"
                />
                <div className="mt-2 flex items-center gap-3">
                  <div className="h-12 w-12 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                    {editPhoto ? (
                      <img
                        src={editPhoto}
                        alt={editName}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-blue-50 text-xs font-bold text-blue-700">
                        {getInitials(editName)}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => editFileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Cambiar foto
                  </button>
                  {editPhoto && (
                    <button
                      type="button"
                      onClick={() => setEditPhoto(null)}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Quitar
                    </button>
                  )}
                </div>
              </div>

              {editError && (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                  {editError}
                </p>
              )}

              <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setEditingPerson(null)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={editSaving}
                  className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                >
                  {editSaving ? 'Guardando...' : 'Guardar Cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIEW / EXPORT ID CARD MODAL */}
      {cardModalPerson && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="font-display text-lg font-bold text-slate-900">
                Carnet Digital QR
              </h2>
              <button
                type="button"
                onClick={() => setCardModalPerson(null)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <IdCardPreview
              fullName={cardModalPerson.full_name}
              documentId={cardModalPerson.document_id}
              roleDepartment={cardModalPerson.role_department}
              qrToken={cardModalPerson.qr_token}
              photoData={cardModalPerson.photo_data}
              organizationName={organizationName}
            />
          </div>
        </div>
      )}
    </div>
  );
}
