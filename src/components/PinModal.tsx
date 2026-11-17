import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, KeyRound, Lock, X } from 'lucide-react';
import { recoverAdminPassword, verifyAdminCredentials } from '../utils/api';

interface PinModalProps {
  targetLabel: string;
  isDefaultPin: boolean;
  onSuccess: () => void;
  onCancel: () => void;
}

export function PinModal({
  targetLabel,
  isDefaultPin,
  onSuccess,
  onCancel,
}: PinModalProps) {
  const [mode, setMode] = useState<'login' | 'recover'>('login');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [recoverySecret, setRecoverySecret] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    if (!password.trim()) {
      setError('Ingrese la contraseña o PIN de administrador.');
      return;
    }

    setSubmitting(true);
    setError('');
    setSuccessMsg('');
    try {
      await verifyAdminCredentials({
        username: username.trim() || 'admin',
        password: password.trim(),
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Credenciales incorrectas.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRecover(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !recoverySecret.trim() || !newPassword.trim()) {
      setError('Complete todos los campos de recuperación.');
      return;
    }
    if (newPassword.trim().length < 4) {
      setError('La nueva contraseña debe tener al menos 4 caracteres.');
      return;
    }

    setSubmitting(true);
    setError('');
    setSuccessMsg('');
    try {
      const res = await recoverAdminPassword({
        username: username.trim(),
        recovery_secret: recoverySecret.trim(),
        new_password: newPassword.trim(),
      });
      setSuccessMsg(res.message || 'Contraseña restablecida correctamente. Ya puede iniciar sesión.');
      setMode('login');
      setPassword('');
      setNewPassword('');
      setRecoverySecret('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al recuperar la contraseña.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pin-modal-title"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
              {mode === 'login' ? <Lock className="h-5 w-5" /> : <KeyRound className="h-5 w-5" />}
            </div>
            <div>
              <h2 id="pin-modal-title" className="font-display text-lg font-bold text-slate-900">
                {mode === 'login' ? 'Acceso de Administrador' : 'Recuperación de Contraseña'}
              </h2>
              <p className="text-xs text-slate-600">
                {mode === 'login'
                  ? `Ingrese credenciales para abrir ${targetLabel}.`
                  : 'Ingrese la clave secreta maestra para restablecer el acceso.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cerrar ventana"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {successMsg && (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium text-emerald-800">
            {successMsg}
          </div>
        )}

        {mode === 'login' ? (
          <form onSubmit={handleLogin} className="mt-5 space-y-4">
            <div>
              <label htmlFor="admin-username" className="block text-xs font-semibold text-slate-700">
                Usuario administrador
              </label>
              <input
                id="admin-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 font-mono text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="admin-password" className="block text-xs font-semibold text-slate-700">
                Contraseña o PIN
              </label>
              <div className="relative mt-1.5">
                <input
                  id="admin-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                  placeholder="Ingrese contraseña..."
                  className="w-full rounded-lg border border-slate-300 bg-white py-2 pr-10 pl-3.5 font-mono text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  className="absolute inset-y-0 right-1 flex items-center px-2.5 text-slate-500 hover:text-slate-800"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {isDefaultPin && (
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs text-slate-600">
                Usuario inicial: <span className="font-mono font-semibold text-slate-900">admin</span> · PIN: <span className="font-mono font-semibold text-slate-900">1234</span>
              </p>
            )}

            {error && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700">
                {error}
              </p>
            )}

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => {
                  setMode('recover');
                  setError('');
                }}
                className="text-xs font-semibold text-blue-700 hover:underline"
              >
                ¿Olvidó su contraseña?
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onCancel}
                  className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                >
                  {submitting ? 'Verificando...' : 'Iniciar Sesión'}
                </button>
              </div>
            </div>
          </form>
        ) : (
          <form onSubmit={handleRecover} className="mt-5 space-y-4">
            <div>
              <label htmlFor="recover-username" className="block text-xs font-semibold text-slate-700">
                Usuario a recuperar
              </label>
              <input
                id="recover-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 font-mono text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="recover-secret" className="block text-xs font-semibold text-slate-700">
                Clave secreta de recuperación
              </label>
              <input
                id="recover-secret"
                type="password"
                value={recoverySecret}
                onChange={(e) => setRecoverySecret(e.target.value)}
                placeholder="Ej. CONTROLQR-RECOVER-2026"
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 font-mono text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Predeterminada: <code className="font-mono text-slate-700">CONTROLQR-RECOVER-2026</code> (configurable en Gestión de Administradores).
              </p>
            </div>

            <div>
              <label htmlFor="recover-newpassword" className="block text-xs font-semibold text-slate-700">
                Nueva contraseña
              </label>
              <input
                id="recover-newpassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Mínimo 4 caracteres..."
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 font-mono text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>

            {error && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700">
                {error}
              </p>
            )}

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError('');
                }}
                className="text-xs font-semibold text-blue-700 hover:underline"
              >
                ← Volver al login
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onCancel}
                  className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                >
                  {submitting ? 'Restableciendo...' : 'Restablecer Clave'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
