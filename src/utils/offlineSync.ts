import { useCallback, useEffect, useState } from 'react';
import type {
  ScanResponse,
  ScannerBootstrapResponse,
  SyncBatchResponse,
} from '../types';
import { getLocalDateString, getLocalTimeString } from './api';
import {
  getCachedTerminalMeta,
  getPendingScanCount,
  getPendingScans,
  markPendingScansRetryError,
  recordOfflineScanInIdb,
  removePendingScans,
  saveScannerBootstrap,
  updateCachedPersonMovement,
} from './offlineDb';

export interface OfflineSyncSnapshot {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  cachedPersonnelCount: number;
  lastDirectorySyncAt: string | null;
  lastSyncMessage: string | null;
  lastSyncedAt: string | null;
}

const listeners = new Set<(state: OfflineSyncSnapshot) => void>();

let currentState: OfflineSyncSnapshot = {
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  isSyncing: false,
  pendingCount: 0,
  cachedPersonnelCount: 0,
  lastDirectorySyncAt: null,
  lastSyncMessage: null,
  lastSyncedAt: null,
};

let activeSyncPromise: Promise<SyncBatchResponse | null> | null = null;
let initializedGlobalListeners = false;

function emitState(patch: Partial<OfflineSyncSnapshot>) {
  currentState = { ...currentState, ...patch };
  for (const listener of listeners) {
    listener(currentState);
  }
}

export async function refreshOfflineCounters(): Promise<void> {
  const [pendingCount, meta] = await Promise.all([
    getPendingScanCount(),
    getCachedTerminalMeta(),
  ]);
  emitState({
    pendingCount,
    cachedPersonnelCount: meta.cachedCount,
    lastDirectorySyncAt: meta.lastDirectorySyncAt,
  });
}

export async function refreshOfflineDirectory(): Promise<ScannerBootstrapResponse | null> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    await refreshOfflineCounters();
    return null;
  }

  try {
    const today = getLocalDateString();
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`/api/scanner/bootstrap?date=${encodeURIComponent(today)}`, {
      cache: 'no-store',
      signal: controller.signal,
    }).finally(() => window.clearTimeout(timer));

    if (!res.ok) {
      return null;
    }

    const snapshot = (await res.json()) as ScannerBootstrapResponse;
    await saveScannerBootstrap(snapshot);
    await refreshOfflineCounters();
    emitState({ isOnline: true });
    return snapshot;
  } catch {
    await refreshOfflineCounters();
    return null;
  }
}

export async function syncPendingScans(): Promise<SyncBatchResponse | null> {
  if (activeSyncPromise) return activeSyncPromise;

  activeSyncPromise = (async () => {
    const pending = await getPendingScans();
    if (pending.length === 0) {
      await refreshOfflineCounters();
      return null;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      emitState({ isOnline: false, pendingCount: pending.length });
      return null;
    }

    emitState({ isSyncing: true });

    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 10000);

      const res = await fetch('/api/scan/sync-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scans: pending.map((p) => ({
            clientScanId: p.clientScanId,
            qrToken: p.qrToken,
            scannedAt: p.scannedAt,
            localDate: p.localDate,
            localTime: p.localTime,
          })),
        }),
        signal: controller.signal,
      }).finally(() => window.clearTimeout(timer));

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const msg = errBody.error || `Error HTTP ${res.status}`;
        await markPendingScansRetryError(
          pending.map((p) => p.clientScanId),
          msg
        );
        emitState({ isSyncing: false, lastSyncMessage: msg });
        return null;
      }

      const data = (await res.json()) as SyncBatchResponse;
      const handledIds = data.results.map((r) => r.clientScanId);
      await removePendingScans(handledIds);

      const remaining = await getPendingScanCount();
      const syncedNow = data.syncedCount + data.duplicateCount;
      const msg =
        data.rejectedCount > 0
          ? `Sincronizadas ${syncedNow} lecturas (${data.rejectedCount} rechazadas).`
          : `Sincronización completa (${syncedNow} ${syncedNow === 1 ? 'registro' : 'registros'}).`;

      emitState({
        isOnline: true,
        isSyncing: false,
        pendingCount: remaining,
        lastSyncMessage: msg,
        lastSyncedAt: new Date().toISOString(),
      });

      await refreshOfflineDirectory();
      return data;
    } catch (err) {
      const isOfflineErr = err instanceof TypeError || (err instanceof Error && err.name === 'AbortError');
      if (isOfflineErr) {
        emitState({ isOnline: false });
      }
      emitState({
        isSyncing: false,
        lastSyncMessage: isOfflineErr
          ? 'Red no disponible. Los registros siguen guardados en este dispositivo.'
          : 'No se pudo completar la sincronización.',
      });
      return null;
    } finally {
      activeSyncPromise = null;
    }
  })();

  return activeSyncPromise;
}

export async function submitQrScanWithOfflineFallback(
  qrToken: string
): Promise<ScanResponse> {
  const now = new Date();
  const localDate = getLocalDateString(now);
  const localTime = getLocalTimeString(now);

  // If browser already knows it is offline, go straight to IndexedDB without waiting
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    emitState({ isOnline: false });
    const offlineRes = await recordOfflineScanInIdb(qrToken, localDate, localTime);
    await refreshOfflineCounters();
    return offlineRes;
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 4500);

  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        qrToken,
        localDate,
        localTime,
      }),
      signal: controller.signal,
    }).finally(() => window.clearTimeout(timer));

    // Gateway / proxy / offline errors fallback to local IndexedDB queue
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      emitState({ isOnline: false });
      const offlineRes = await recordOfflineScanInIdb(qrToken, localDate, localTime);
      await refreshOfflineCounters();
      return offlineRes;
    }

    const payload = (await res.json()) as ScanResponse;
    emitState({ isOnline: true });

    if (payload.status === 'success' && payload.movementType && payload.scannedAt) {
      await updateCachedPersonMovement(
        qrToken,
        payload.movementType,
        payload.localDate || localDate,
        payload.scannedAt
      );
    }

    return payload;
  } catch {
    // Network disconnected or server timed out -> store securely in IndexedDB
    emitState({ isOnline: false });
    const offlineRes = await recordOfflineScanInIdb(qrToken, localDate, localTime);
    await refreshOfflineCounters();
    return offlineRes;
  }
}

function ensureGlobalConnectivityWatchers() {
  if (initializedGlobalListeners || typeof window === 'undefined') return;
  initializedGlobalListeners = true;

  const onOnline = () => {
    emitState({ isOnline: true });
    void syncPendingScans();
    void refreshOfflineDirectory();
  };

  const onOffline = () => {
    emitState({ isOnline: false });
  };

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  // Periodic reachability & auto-sync check when pending items exist
  window.setInterval(async () => {
    const count = await getPendingScanCount();
    if (count > 0 && navigator.onLine) {
      void syncPendingScans();
    } else if (!currentState.isOnline && navigator.onLine) {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        if (res.ok) {
          emitState({ isOnline: true });
          void syncPendingScans();
          void refreshOfflineDirectory();
        }
      } catch {
        // Still unreachable
      }
    }
  }, 15000);
}

export function useOfflineSyncStatus() {
  const [state, setState] = useState<OfflineSyncSnapshot>(currentState);

  useEffect(() => {
    ensureGlobalConnectivityWatchers();
    listeners.add(setState);
    void refreshOfflineCounters();
    if (navigator.onLine) {
      void syncPendingScans();
    }
    return () => {
      listeners.delete(setState);
    };
  }, []);

  const triggerSync = useCallback(() => {
    return syncPendingScans();
  }, []);

  const refreshCache = useCallback(() => {
    return refreshOfflineDirectory();
  }, []);

  return {
    ...state,
    triggerSync,
    refreshCache,
  };
}
