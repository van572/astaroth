import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { recoverAdminPassword, verifyAdminCredentials } from '../utils/api';
import { DatabaseStatusDot } from './DatabaseStatusDot';
import { PWAInstallButton } from './PWAInstallButton';

interface LoginScreenProps {
  organizationName: string;
  isDefaultPin: boolean;
  onLoginSuccess: () => void;
}

export function LoginScreen({
  organizationName,
  isDefaultPin,
  onLoginSuccess,
}: LoginScreenProps) {
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
    if (!username.trim() || !password.trim()) {
      setError('Ingrese su usuario y contraseña de administrador.');
      return;
    }

    setSubmitting(true);
    setError('');
    setSuccessMsg('');
    try {
      await verifyAdminCredentials({
        username: username.trim(),
        password: password.trim(),
      });
      onLoginSuccess();
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
      setSuccessMsg(
        res.message || 'Contraseña restablecida correctamente. Ya puede iniciar sesión.'
      );
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
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="font-display text-lg font-bold tracking-tight text-slate-900">
              Control de Ingreso
            </span>
            <span className="hidden text-slate-300 sm:inline" aria-hidden="true">
              ·
            </span>
            <span className="hidden text-xs font-medium text-slate-500 sm:inline">
              {organizationName}
            </span>
          </div>

          <div className="flex items-center gap-3.5 shrink-0">
            <DatabaseStatusDot />
            <PWAInstallButton />
          </div>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mb-6 flex items-center gap-3.5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-700 text-white">
              {mode === 'login' ? <Lock className="h-6 w-6" /> : <KeyRound className="h-6 w-6" />}
            </div>
            <div>
              <h1 className="font-display text-xl font-bold text-slate-900">
                {mode === 'login' ? 'Iniciar Sesión' : 'Recuperar Contraseña'}
              </h1>
              <p className="mt-0.5 text-xs text-slate-600">
                {mode === 'login'
                  ? 'Acceso restringido. Autentíquese para ingresar al sistema.'
                  : 'Ingrese la clave secreta maestra para restablecer el acceso.'}
              </p>
            </div>
          </div>

          {successMsg && (
            <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium text-emerald-800">
              {successMsg}
            </div>
          )}

          {mode === 'login' ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label htmlFor="login-username" className="block text-xs font-semibold text-slate-700">
                  Usuario administrador
                </label>
                <input
                  id="login-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  placeholder="admin"
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 font-mono text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                />
              </div>

              <div>
                <label htmlFor="login-password" className="block text-xs font-semibold text-slate-700">
                  Contraseña o PIN
                </label>
                <div className="relative mt-1.5">
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoFocus
                    autoComplete="current-password"
                    placeholder="Ingrese su contraseña..."
                    className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pr-11 pl-3.5 font-mono text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    className="absolute inset-y-0 right-1 flex items-center px-3 text-slate-500 hover:text-slate-800"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {isDefaultPin && (
                <div className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
                  <span>
                    Acceso inicial: usuario{' '}
                    <span className="font-mono font-semibold text-slate-900">admin</span> · clave{' '}
                    <span className="font-mono font-semibold text-slate-900">1234</span>
                  </span>
                </div>
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
                    setSuccessMsg('');
                  }}
                  className="text-xs font-semibold text-blue-700 hover:underline"
                >
                  ¿Olvidó su contraseña?
                </button>

                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex min-h-10 items-center justify-center rounded-lg bg-blue-700 px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-blue-800 disabled:opacity-50"
                >
                  {submitting ? 'Verificando...' : 'Entrar al sistema'}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleRecover} className="space-y-4">
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
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 font-mono text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
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
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 font-mono text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Predeterminada: <code className="font-mono text-slate-700">CONTROLQR-RECOVER-2026</code>
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
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 font-mono text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
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
                    setSuccessMsg('');
                  }}
                  className="text-xs font-semibold text-blue-700 hover:underline"
                >
                  ← Volver al login
                </button>

                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex min-h-10 items-center justify-center rounded-lg bg-blue-700 px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-blue-800 disabled:opacity-50"
                >
                  {submitting ? 'Restableciendo...' : 'Restablecer Clave'}
                </button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
