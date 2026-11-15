import { useCallback, useEffect, useState } from 'react';
import { fetchDatabaseStatus } from '../utils/api';

export interface DatabaseStatusState {
  status: 'checking' | 'active' | 'inactive';
  provider: 'sqlite' | 'supabase';
  label: string;
}

const listeners = new Set<(state: DatabaseStatusState) => void>();

let currentState: DatabaseStatusState = {
  status: 'checking',
  provider: 'sqlite',
  label: 'Verificando BD...',
};

let initializedWatcher = false;

function emit(next: DatabaseStatusState) {
  currentState = next;
  for (const listener of listeners) {
    listener(next);
  }
}

export async function refreshDatabaseStatus(): Promise<DatabaseStatusState> {
  try {
    const res = await fetchDatabaseStatus();
    const next: DatabaseStatusState = {
      status: res.dbActive ? 'active' : 'inactive',
      provider: res.provider,
      label: res.label,
    };
    emit(next);
    return next;
  } catch {
    const next: DatabaseStatusState = {
      status: 'inactive',
      provider: currentState.provider,
      label: 'Sin conexión con la base de datos',
    };
    emit(next);
    return next;
  }
}

export function useDatabaseStatus() {
  const [state, setState] = useState<DatabaseStatusState>(currentState);

  useEffect(() => {
    listeners.add(setState);

    if (!initializedWatcher) {
      initializedWatcher = true;
      void refreshDatabaseStatus();
      window.addEventListener('online', () => {
        void refreshDatabaseStatus();
      });
      window.addEventListener('offline', () => {
        emit({
          status: 'inactive',
          provider: currentState.provider,
          label: 'Sin conexión a la base de datos',
        });
      });
      window.setInterval(() => {
        void refreshDatabaseStatus();
      }, 30000);
    } else {
      setState(currentState);
    }

    return () => {
      listeners.delete(setState);
    };
  }, []);

  const refresh = useCallback(() => {
    return refreshDatabaseStatus();
  }, []);

  return {
    ...state,
    refresh,
  };
}
