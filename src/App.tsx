import { useCallback, useEffect, useState } from 'react';
import type { ModuleView } from './types';
import { fetchAuthStatus, logoutAdmin } from './utils/api';
import { HomeAccessView } from './components/HomeAccessView';
import { ModuleHeader } from './components/ModuleHeader';
import { ScannerModule } from './components/ScannerModule';
import { RegisterModule } from './components/RegisterModule';
import { AdminModule } from './components/AdminModule';
import { PinModal } from './components/PinModal';

export default function App() {
  const [activeView, setActiveView] = useState<ModuleView>('home');
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [isDefaultPin, setIsDefaultPin] = useState(true);
  const [organizationName, setOrganizationName] = useState('ControlQR Corporativo');
  const [pendingProtectedTarget, setPendingProtectedTarget] = useState<
    'register' | 'admin' | null
  >(null);

  const syncAuthStatus = useCallback(async () => {
    try {
      const status = await fetchAuthStatus();
      setIsAdminAuthenticated(status.authenticated);
      setIsDefaultPin(status.isDefaultPin);
      setOrganizationName(status.organizationName || 'ControlQR Corporativo');
    } catch {
      setIsAdminAuthenticated(false);
    }
  }, []);

  useEffect(() => {
    syncAuthStatus();
  }, [syncAuthStatus]);

  function handleNavigate(target: ModuleView) {
    if (target === 'home' || target === 'scanner') {
      setActiveView(target);
      return;
    }

    // Protected modules: Registro de Personal & Panel de Administración
    if (isAdminAuthenticated) {
      setActiveView(target);
    } else {
      setPendingProtectedTarget(target);
    }
  }

  async function handlePinSuccess() {
    const target = pendingProtectedTarget;
    setPendingProtectedTarget(null);
    setIsAdminAuthenticated(true);
    await syncAuthStatus();
    if (target) {
      setActiveView(target);
    }
  }

  async function handleLockSession() {
    await logoutAdmin();
    setIsAdminAuthenticated(false);
    if (activeView === 'register' || activeView === 'admin') {
      setActiveView('home');
    }
  }

  function handleAuthExpired() {
    setIsAdminAuthenticated(false);
    setPendingProtectedTarget(activeView === 'register' ? 'register' : 'admin');
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

      {pendingProtectedTarget && (
        <PinModal
          targetLabel={
            pendingProtectedTarget === 'register'
              ? 'Registro de Personal'
              : 'Panel de Administración'
          }
          isDefaultPin={isDefaultPin}
          onSuccess={handlePinSuccess}
          onCancel={() => setPendingProtectedTarget(null)}
        />
      )}
    </div>
  );
}
