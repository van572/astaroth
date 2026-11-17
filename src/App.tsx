import { useCallback, useEffect, useState } from 'react';
import type { ModuleView } from './types';
import { fetchAuthStatus, logoutAdmin } from './utils/api';
import { useOfflineSyncStatus } from './utils/offlineSync';
import { HomeAccessView } from './components/HomeAccessView';
import { ModuleHeader } from './components/ModuleHeader';
import { ScannerModule } from './components/ScannerModule';
import { RegisterModule } from './components/RegisterModule';
import { AdminModule } from './components/AdminModule';
import { LoginScreen } from './components/LoginScreen';
import { PinModal } from './components/PinModal';

const SCANNER_LOCK_KEY = 'controlqr_scanner_locked';

function getStoredScannerLock(): boolean {
  try {
    return sessionStorage.getItem(SCANNER_LOCK_KEY) === '1';
  } catch {
    return false;
  }
}

function setStoredScannerLock(locked: boolean): void {
  try {
    if (locked) {
      sessionStorage.setItem(SCANNER_LOCK_KEY, '1');
    } else {
      sessionStorage.removeItem(SCANNER_LOCK_KEY);
    }
  } catch {
    // Ignore storage restrictions
  }
}

export default function App() {
  useOfflineSyncStatus();
  const [authChecking, setAuthChecking] = useState(true);
  const [activeView, setActiveView] = useState<Exclude<ModuleView, 'login'>>(() =>
    getStoredScannerLock() ? 'scanner' : 'home'
  );
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [isDefaultPin, setIsDefaultPin] = useState(true);
  const [organizationName, setOrganizationName] = useState('ControlQR Corporativo');
  const [pendingExitTarget, setPendingExitTarget] = useState<
    'home' | 'register' | 'admin' | 'logout' | null
  >(null);

  const syncAuthStatus = useCallback(async () => {
    try {
      const status = await fetchAuthStatus();
      setIsAdminAuthenticated(status.authenticated);
      setIsDefaultPin(status.isDefaultPin);
      setOrganizationName(status.organizationName || 'ControlQR Corporativo');
      if (!status.authenticated && !getStoredScannerLock()) {
        setActiveView('home');
      }
    } catch {
      setIsAdminAuthenticated(false);
    } finally {
      setAuthChecking(false);
    }
  }, []);

  useEffect(() => {
    void syncAuthStatus();
  }, [syncAuthStatus]);

  function handleNavigate(target: ModuleView) {
    if (target === 'login') {
      return;
    }

    // While inside Scanner mode, ALWAYS require admin password to leave
    if (activeView === 'scanner' && target !== 'scanner') {
      setPendingExitTarget(target);
      return;
    }

    if (target === 'scanner') {
      setStoredScannerLock(true);
      setActiveView('scanner');
      return;
    }

    if (isAdminAuthenticated) {
      setActiveView(target);
    } else {
      setPendingExitTarget(target);
    }
  }

  async function handlePinSuccess() {
    const target = pendingExitTarget;
    setPendingExitTarget(null);
    setStoredScannerLock(false);

    if (target === 'logout') {
      await logoutAdmin();
      setIsAdminAuthenticated(false);
      setActiveView('home');
      return;
    }

    setIsAdminAuthenticated(true);
    await syncAuthStatus();
    if (target) {
      setActiveView(target);
    }
  }

  async function handleLockSession() {
    if (activeView === 'scanner') {
      setPendingExitTarget('logout');
      return;
    }
    setStoredScannerLock(false);
    await logoutAdmin();
    setIsAdminAuthenticated(false);
    setActiveView('home');
  }

  function handleAuthExpired() {
    setIsAdminAuthenticated(false);
    setStoredScannerLock(false);
    setActiveView('home');
  }

  if (authChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm font-medium text-slate-600">
        Verificando acceso al sistema...
      </div>
    );
  }

  // Block ALL functions behind the Login gate until authenticated (unless kiosk scanner was locked in this tab)
  const isLockedKioskActive = activeView === 'scanner' && getStoredScannerLock();
  if (!isAdminAuthenticated && !isLockedKioskActive) {
    return (
      <LoginScreen
        organizationName={organizationName}
        isDefaultPin={isDefaultPin}
        onLoginSuccess={() => {
          setIsAdminAuthenticated(true);
          setActiveView('home');
          void syncAuthStatus();
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {activeView === 'home' ? (
        <HomeAccessView
          organizationName={organizationName}
          isAdminAuthenticated={isAdminAuthenticated}
          onSelectModule={handleNavigate}
          onLockSession={handleLockSession}
        />
      ) : (
        <>
          <ModuleHeader
            organizationName={organizationName}
            activeView={activeView}
            isAdminAuthenticated={isAdminAuthenticated}
            onNavigate={handleNavigate}
            onLockSession={handleLockSession}
          />
          <main>
            {activeView === 'scanner' && <ScannerModule />}
            {activeView === 'register' && (
              <RegisterModule organizationName={organizationName} />
            )}
            {activeView === 'admin' && (
              <AdminModule
                organizationName={organizationName}
                onOrganizationNameChange={setOrganizationName}
                onAuthExpired={handleAuthExpired}
              />
            )}
          </main>
        </>
      )}

      {pendingExitTarget && (
        <PinModal
          targetLabel={
            pendingExitTarget === 'register'
              ? 'Registro de Personal'
              : pendingExitTarget === 'admin'
              ? 'Panel de Administración'
              : pendingExitTarget === 'logout'
              ? 'Cerrar Sesión y Salir del Escáner'
              : 'Salir del Modo Escáner'
          }
          isDefaultPin={isDefaultPin}
          onSuccess={handlePinSuccess}
          onCancel={() => setPendingExitTarget(null)}
        />
      )}
    </div>
  );
}
