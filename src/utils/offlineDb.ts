import type {
  CachedScannerPerson,
  MovementType,
  PendingOfflineScan,
  ScanResponse,
  ScannerBootstrapResponse,
} from '../types';

const DB_NAME = 'controlqr-offline-db';
const DB_VERSION = 1;
const STORE_PERSONNEL = 'personnel_cache';
const STORE_PENDING_SCANS = 'pending_scans';
const STORE_META = 'terminal_meta';

interface TerminalMetaRecord {
  key: string;
  value: string | number | null;
}

export interface CachedTerminalMeta {
  cooldownSeconds: number;
  organizationName: string;
  lastDirectorySyncAt: string | null;
  cachedCount: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openOfflineDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB no está disponible en este navegador.'));
  }

  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PERSONNEL)) {
        db.createObjectStore(STORE_PERSONNEL, { keyPath: 'qr_token' });
      }
      if (!db.objectStoreNames.contains(STORE_PENDING_SCANS)) {
        const pendingStore = db.createObjectStore(STORE_PENDING_SCANS, {
          keyPath: 'clientScanId',
        });
        pendingStore.createIndex('scannedAt', 'scannedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };

    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };

    req.onerror = () => {
      dbPromise = null;
      reject(req.error || new Error('No se pudo abrir IndexedDB.'));
    };
  });

  return dbPromise;
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function generateClientScanId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `OFF-${crypto.randomUUID()}`;
  }
  return `OFF-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function getPendingScans(): Promise<PendingOfflineScan[]> {
  try {
    const db = await openOfflineDb();
    const tx = db.transaction(STORE_PENDING_SCANS, 'readonly');
    const store = tx.objectStore(STORE_PENDING_SCANS);
    const all = await requestToPromise(store.getAll() as IDBRequest<PendingOfflineScan[]>);
    return (all || []).sort((a, b) => Date.parse(a.scannedAt) - Date.parse(b.scannedAt));
  } catch {
    return [];
  }
}

export async function getPendingScanCount(): Promise<number> {
  try {
    const db = await openOfflineDb();
    const tx = db.transaction(STORE_PENDING_SCANS, 'readonly');
    const store = tx.objectStore(STORE_PENDING_SCANS);
    return await requestToPromise(store.count());
  } catch {
    return 0;
  }
}

export async function getCachedTerminalMeta(): Promise<CachedTerminalMeta> {
  try {
    const db = await openOfflineDb();
    const tx = db.transaction([STORE_META, STORE_PERSONNEL], 'readonly');
    const metaStore = tx.objectStore(STORE_META);
    const personStore = tx.objectStore(STORE_PERSONNEL);

    const [cooldownRec, orgRec, syncRec, cachedCount] = await Promise.all([
      requestToPromise(metaStore.get('cooldownSeconds') as IDBRequest<TerminalMetaRecord | undefined>),
      requestToPromise(metaStore.get('organizationName') as IDBRequest<TerminalMetaRecord | undefined>),
      requestToPromise(
        metaStore.get('lastDirectorySyncAt') as IDBRequest<TerminalMetaRecord | undefined>
      ),
      requestToPromise(personStore.count()),
    ]);

    return {
      cooldownSeconds:
        typeof cooldownRec?.value === 'number' && cooldownRec.value >= 5
          ? cooldownRec.value
          : 15,
      organizationName:
        typeof orgRec?.value === 'string' && orgRec.value
          ? orgRec.value
          : 'ControlQR Corporativo',
      lastDirectorySyncAt: typeof syncRec?.value === 'string' ? syncRec.value : null,
      cachedCount: cachedCount || 0,
    };
  } catch {
    return {
      cooldownSeconds: 15,
      organizationName: 'ControlQR Corporativo',
      lastDirectorySyncAt: null,
      cachedCount: 0,
    };
  }
}

export async function saveScannerBootstrap(snapshot: ScannerBootstrapResponse): Promise<void> {
  const db = await openOfflineDb();
  const pending = await getPendingScans();

  // Preserve the latest pending local movement per token so cached state stays accurate
  const latestPendingByToken = new Map<string, PendingOfflineScan>();
  for (const item of pending) {
    const prev = latestPendingByToken.get(item.qrToken);
    if (!prev || Date.parse(item.scannedAt) > Date.parse(prev.scannedAt)) {
      latestPendingByToken.set(item.qrToken, item);
    }
  }

  const tx = db.transaction([STORE_PERSONNEL, STORE_META], 'readwrite');
  const personStore = tx.objectStore(STORE_PERSONNEL);
  const metaStore = tx.objectStore(STORE_META);

  personStore.clear();

  for (const p of snapshot.personnel) {
    const pendingOverlay = latestPendingByToken.get(p.qr_token);
    const serverMs = p.last_scanned_at ? Date.parse(p.last_scanned_at) : 0;
    const pendingMs = pendingOverlay ? Date.parse(pendingOverlay.scannedAt) : 0;
    const usePending = Boolean(pendingOverlay && pendingMs >= serverMs);

    const cachedPerson: CachedScannerPerson = {
      id: p.id,
      qr_token: p.qr_token,
      full_name: p.full_name,
      document_id: p.document_id,
      role_department: p.role_department,
      photo_data: p.photo_data,
      is_active: p.is_active,
      last_movement_today: usePending
        ? pendingOverlay!.movementType
        : p.last_movement_today,
      last_movement_date: usePending
        ? pendingOverlay!.localDate
        : p.last_movement_today
        ? snapshot.serverDate
        : null,
      last_scanned_at: usePending ? pendingOverlay!.scannedAt : p.last_scanned_at,
    };

    personStore.put(cachedPerson);
  }

  metaStore.put({ key: 'cooldownSeconds', value: snapshot.cooldownSeconds });
  metaStore.put({ key: 'organizationName', value: snapshot.organizationName });
  metaStore.put({ key: 'lastDirectorySyncAt', value: snapshot.syncedAt });

  await transactionDone(tx);
}

export async function updateCachedPersonMovement(
  qrToken: string,
  movementType: MovementType,
  localDate: string,
  scannedAt: string
): Promise<void> {
  try {
    const db = await openOfflineDb();
    const tx = db.transaction(STORE_PERSONNEL, 'readwrite');
    const store = tx.objectStore(STORE_PERSONNEL);
    const existing = await requestToPromise(
      store.get(qrToken) as IDBRequest<CachedScannerPerson | undefined>
    );
    if (existing) {
      store.put({
        ...existing,
        last_movement_today: movementType,
        last_movement_date: localDate,
        last_scanned_at: scannedAt,
      });
    }
    await transactionDone(tx);
  } catch {
    // Non-critical local cache update
  }
}

export async function recordOfflineScanInIdb(
  qrToken: string,
  localDate: string,
  localTime: string
): Promise<ScanResponse> {
  const db = await openOfflineDb();
  const meta = await getCachedTerminalMeta();

  const readTx = db.transaction(STORE_PERSONNEL, 'readonly');
  const personStore = readTx.objectStore(STORE_PERSONNEL);
  const person = await requestToPromise(
    personStore.get(qrToken) as IDBRequest<CachedScannerPerson | undefined>
  );

  if (!person) {
    return {
      status: 'invalid',
      offlineQueued: false,
      message:
        meta.cachedCount === 0
          ? 'Sin conexión y sin directorio local cargado. Conéctese una vez para descargar el padrón de personal.'
          : 'Código QR no encontrado en la caché local sin conexión.',
    };
  }

  const publicPerson = {
    id: person.id,
    full_name: person.full_name,
    document_id: person.document_id,
    role_department: person.role_department,
    photo_data: person.photo_data,
    is_active: person.is_active,
  };

  if (person.is_active === 0) {
    return {
      status: 'inactive',
      offlineQueued: false,
      message: 'Carnet desactivado. Acceso denegado.',
      person: publicPerson,
    };
  }

  const cooldownSeconds = meta.cooldownSeconds;
  if (person.last_scanned_at) {
    const elapsedMs = Date.now() - Date.parse(person.last_scanned_at);
    const cooldownMs = cooldownSeconds * 1000;
    if (elapsedMs >= 0 && elapsedMs < cooldownMs) {
      const remainingSeconds = Math.ceil((cooldownMs - elapsedMs) / 1000);
      return {
        status: 'cooldown',
        remainingSeconds,
        cooldownSeconds,
        lastMovement: person.last_movement_today || undefined,
        offlineQueued: false,
        message: `Lectura duplicada bloqueada. Espere ${remainingSeconds}s antes de volver a escanear.`,
        person: publicPerson,
      };
    }
  }

  const lastMovementOnSameDay =
    person.last_movement_date === localDate ? person.last_movement_today : null;
  const movementType: MovementType =
    !lastMovementOnSameDay || lastMovementOnSameDay === 'Salida' ? 'Entrada' : 'Salida';

  const scannedAt = new Date().toISOString();
  const pendingItem: PendingOfflineScan = {
    clientScanId: generateClientScanId(),
    qrToken,
    personId: person.id,
    fullName: person.full_name,
    documentId: person.document_id,
    roleDepartment: person.role_department,
    movementType,
    scannedAt,
    localDate,
    localTime,
    attempts: 0,
  };

  const writeTx = db.transaction([STORE_PENDING_SCANS, STORE_PERSONNEL], 'readwrite');
  writeTx.objectStore(STORE_PENDING_SCANS).put(pendingItem);
  writeTx.objectStore(STORE_PERSONNEL).put({
    ...person,
    last_movement_today: movementType,
    last_movement_date: localDate,
    last_scanned_at: scannedAt,
  });
  await transactionDone(writeTx);

  return {
    status: 'success',
    movementType,
    scannedAt,
    localDate,
    localTime,
    cooldownSeconds,
    offlineQueued: true,
    message: `${movementType} guardada localmente. Se sincronizará al recuperar conexión.`,
    person: publicPerson,
  };
}

export async function removePendingScans(clientScanIds: string[]): Promise<void> {
  if (clientScanIds.length === 0) return;
  const db = await openOfflineDb();
  const tx = db.transaction(STORE_PENDING_SCANS, 'readwrite');
  const store = tx.objectStore(STORE_PENDING_SCANS);
  for (const id of clientScanIds) {
    store.delete(id);
  }
  await transactionDone(tx);
}

export async function markPendingScansRetryError(
  clientScanIds: string[],
  errorMessage: string
): Promise<void> {
  if (clientScanIds.length === 0) return;
  const db = await openOfflineDb();
  const tx = db.transaction(STORE_PENDING_SCANS, 'readwrite');
  const store = tx.objectStore(STORE_PENDING_SCANS);
  for (const id of clientScanIds) {
    const existing = await requestToPromise(
      store.get(id) as IDBRequest<PendingOfflineScan | undefined>
    );
    if (existing) {
      store.put({
        ...existing,
        attempts: (existing.attempts || 0) + 1,
        lastError: errorMessage,
      });
    }
  }
  await transactionDone(tx);
}
