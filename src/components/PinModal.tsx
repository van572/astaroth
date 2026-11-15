import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, Lock, X } from 'lucide-react';
import { verifyAdminPin } from '../utils/api';

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
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!pin.trim()) {
      setError('Ingrese el PIN o contraseña de administrador.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await verifyAdminPin(pin.trim());
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PIN incorrecto.');
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
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-800">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <h2 id="pin-modal-title" className="font-display text-lg font-bold text-slate-900">
                Acceso Protegido
              </h2>
              <p className="text-sm text-slate-600">
                Ingrese la clave de administrador para abrir <span className="font-semibold text-slate-900">{targetLabel}</span>.
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

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="admin-pin-input" className="block text-sm font-medium text-slate-700">
              PIN o contraseña de administrador
            </label>
            <div className="relative mt-1.5">
              <input
                id="admin-pin-input"
                type={showPin ? 'text' : 'password'}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                autoFocus
                placeholder="Ingrese su clave..."
                className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pr-11 pl-3.5 font-mono text-base text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
              />
              <button
                type="button"
                onClick={() => setShowPin((prev) => !prev)}
                aria-label={showPin ? 'Ocultar clave' : 'Mostrar clave'}
                className="absolute inset-y-0 right-1 flex items-center px-2.5 text-slate-500 hover:text-slate-800"
              >
                {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {isDefaultPin && (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
              PIN inicial predeterminado: <span className="font-mono font-semibold text-slate-900">1234</span>. Puede modificarlo dentro de Panel de Administración.
            </p>
          )}

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-700">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="min-h-10 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-10 rounded-lg bg-blue-700 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-800 disabled:opacity-50"
            >
              {submitting ? 'Verificando...' : 'Desbloquear'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
