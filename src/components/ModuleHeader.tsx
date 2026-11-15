import { ArrowLeft, Lock, LockOpen } from 'lucide-react';
import type { ModuleView } from '../types';
import { DatabaseStatusDot } from './DatabaseStatusDot';
import { PWAInstallButton } from './PWAInstallButton';

interface ModuleHeaderProps {
  organizationName: string;
  activeView: Exclude<ModuleView, 'home'>;
  isAdminAuthenticated: boolean;
  onNavigate: (view: ModuleView) => void;
  onLockSession: () => void;
}

export function ModuleHeader({
  organizationName,
  activeView,
  isAdminAuthenticated,
  onNavigate,
  onLockSession,
}: ModuleHeaderProps) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-6 py-3.5">
        {/* Zone 1: Brand / Back to Home */}
        <div className="flex items-center gap-4 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('home')}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Inicio
          </button>
          <span className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            {organizationName}
          </span>
          <span className="hidden text-slate-300 sm:inline" aria-hidden="true">·</span>
          <span className="hidden sm:inline-flex">
            <DatabaseStatusDot compact />
          </span>
        </div>

        {/* Zone 2: Clean single-line module links */}
        <nav className="hidden items-center gap-6 md:flex">
          <button
            type="button"
            onClick={() => onNavigate('scanner')}
            className={`border-b-2 py-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeView === 'scanner'
                ? 'border-blue-700 text-blue-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Modo Escáner
          </button>
          <button
            type="button"
            onClick={() => onNavigate('register')}
            className={`inline-flex items-center gap-1.5 border-b-2 py-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeView === 'register'
                ? 'border-blue-700 text-blue-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {!isAdminAuthenticated && <Lock className="h-3 w-3 text-slate-400" />}
            Registro de Personal
          </button>
          <button
            type="button"
            onClick={() => onNavigate('admin')}
            className={`inline-flex items-center gap-1.5 border-b-2 py-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeView === 'admin'
                ? 'border-blue-700 text-blue-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {!isAdminAuthenticated && <Lock className="h-3 w-3 text-slate-400" />}
            Panel de Administración
          </button>
        </nav>

        {/* Zone 3: Install & primary session action */}
        <div className="flex items-center gap-2.5 shrink-0">
          <PWAInstallButton />
          {isAdminAuthenticated ? (
            <button
              type="button"
              onClick={onLockSession}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <LockOpen className="h-3.5 w-3.5 text-emerald-700" />
              Bloquear sesión
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate('admin')}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Lock className="h-3.5 w-3.5" />
              Acceso admin
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
