import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Lock,
  LockOpen,
  QrCode,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import type { ModuleView } from '../types';
import { DatabaseStatusDot } from './DatabaseStatusDot';
import { PWAInstallButton } from './PWAInstallButton';

interface HomeAccessViewProps {
  organizationName: string;
  isAdminAuthenticated: boolean;
  onSelectModule: (target: ModuleView) => void;
  onLockSession: () => void;
}

export function HomeAccessView({
  organizationName,
  isAdminAuthenticated,
  onSelectModule,
  onLockSession,
}: HomeAccessViewProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formattedDate = now.toLocaleDateString('es-ES', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const formattedTime = now.toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      {/* Clean top bar */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-6 py-4">
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            Control de Ingreso
          </span>

          <div className="hidden items-center gap-3 text-sm text-slate-500 sm:flex">
            <span className="capitalize">{formattedDate}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono font-medium text-slate-800 tabular-nums">
              {formattedTime}
            </span>
          </div>

          <div className="flex items-center gap-3.5 shrink-0">
            <DatabaseStatusDot />
            <PWAInstallButton />
            <button
              type="button"
              onClick={onLockSession}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <Lock className="h-3.5 w-3.5 text-slate-600" />
              Cerrar sesión
            </button>
          </div>
        </div>
      </header>

      {/* Main focal selection area: ONLY the 3 system modules */}
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-6 py-12">
        <div className="max-w-2xl">
          <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl [text-wrap:balance]">
            Control de Entradas y Salidas por Código QR
          </h1>
          <p className="mt-3 text-base leading-relaxed text-slate-600">
            Seleccione el módulo de operación. Al abrir el Modo Escáner, el terminal quedará bloqueado y requerirá contraseña de administrador para poder salir.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
          {/* Module 1: Scanner Mode */}
          <button
            type="button"
            onClick={() => onSelectModule('scanner')}
            className="group flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-7 text-left transition-all duration-150 hover:border-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
          >
            <div>
              <div className="flex items-center justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-700 text-white">
                  <QrCode className="h-6 w-6" />
                </div>
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
                  <Lock className="h-3.5 w-3.5" />
                  Bloqueo al salir
                </span>
              </div>

              <h2 className="mt-6 font-display text-xl font-bold text-slate-900">
                Modo Escáner
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Terminal de lectura continua en tiempo real. Detecta automáticamente Entrada o Salida con protección anti-rebote y bloqueo de salida.
              </p>
            </div>

            <div className="mt-8 flex items-center justify-between border-t border-slate-100 pt-4 text-sm font-semibold text-blue-700">
              <span>Abrir terminal</span>
              <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-1" />
            </div>
          </button>

          {/* Module 2: Personnel Registration */}
          <button
            type="button"
            onClick={() => onSelectModule('register')}
            className="group flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-7 text-left transition-all duration-150 hover:border-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
          >
            <div>
              <div className="flex items-center justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-900 text-white">
                  <UserPlus className="h-6 w-6" />
                </div>
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
                  {isAdminAuthenticated ? (
                    <>
                      <LockOpen className="h-3.5 w-3.5 text-emerald-700" />
                      Autorizado
                    </>
                  ) : (
                    <>
                      <Lock className="h-3.5 w-3.5 text-slate-500" />
                      Requiere PIN
                    </>
                  )}
                </span>
              </div>

              <h2 className="mt-6 font-display text-xl font-bold text-slate-900">
                Registro de Personal
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Alta de personal sin cuentas de usuario y generación automática de carnet digital con código QR único listo para descargar o imprimir.
              </p>
            </div>

            <div className="mt-8 flex items-center justify-between border-t border-slate-100 pt-4 text-sm font-semibold text-slate-900 group-hover:text-blue-700">
              <span>Registrar y emitir carnet</span>
              <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-1" />
            </div>
          </button>

          {/* Module 3: Admin Panel */}
          <button
            type="button"
            onClick={() => onSelectModule('admin')}
            className="group flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-7 text-left transition-all duration-150 hover:border-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
          >
            <div>
              <div className="flex items-center justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-900 text-white">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
                  {isAdminAuthenticated ? (
                    <>
                      <LockOpen className="h-3.5 w-3.5 text-emerald-700" />
                      Autorizado
                    </>
                  ) : (
                    <>
                      <Lock className="h-3.5 w-3.5 text-slate-500" />
                      Requiere PIN
                    </>
                  )}
                </span>
              </div>

              <h2 className="mt-6 font-display text-xl font-bold text-slate-900">
                Panel de Administración
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Edición y activación de carnets, consulta de historial en vivo, exportación de asistencia CSV/Excel y alertas SMTP automáticas.
              </p>
            </div>

            <div className="mt-8 flex items-center justify-between border-t border-slate-100 pt-4 text-sm font-semibold text-slate-900 group-hover:text-blue-700">
              <span>Abrir administración</span>
              <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-1" />
            </div>
          </button>
        </div>
      </main>
    </div>
  );
}
