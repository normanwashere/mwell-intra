/**
 * Offline outbox for floor operations.
 *
 * When a queued mutation can't reach the backend (offline or a network error)
 * the store enqueues a serializable intent here and applies an optimistic
 * overlay to the cached read model so the user sees their change immediately.
 * On reconnect (or app start) the queue replays in FIFO order against the live
 * repo; the v2 delta/guard RPCs make replay order-safe, and a true conflict
 * (e.g. issuing an allocation someone else already issued) surfaces as a
 * conflict the user can retry or discard.
 *
 * Persistence: IndexedDB (single object store `outbox`, keyPath `id`). Falls
 * back to an in-memory array when IndexedDB is unavailable (SSR / very old
 * browsers / tests) so the queue still works within a session.
 *
 * Step 1d note: ported verbatim from the warehouse app. It was already
 * runtime-agnostic (feature-detects `indexedDB`), so it runs unchanged under
 * Next.js — the in-memory fallback kicks in during SSR / Node, and IndexedDB is
 * used in the browser. This is the highest-risk offline invariant (spec §12
 * step 4) and is preserved faithfully.
 */

export type QueueableMethod =
  | 'receiveStock'
  | 'recordCycleCount'
  | 'recordReturn'
  | 'issue'
  | 'transfer'
  | 'relocate';

export interface OutboxEntry {
  id: string;
  method: QueueableMethod;
  input: Record<string, unknown>;
  /** optimistic client-side patch to apply to the cached read model */
  overlay?: WarehousePatch;
  createdAt: string;
  status: 'pending' | 'conflict';
  /** last replay error message, surfaced when status === 'conflict' */
  error?: string;
}

/**
 * A declarative patch the store applies to its cached WarehouseData to reflect a
 * queued mutation optimistically. Kept intentionally minimal: stock deltas,
 * appended movements/units/lots, and appended document rows. The store merges
 * this onto a deep-cloned snapshot.
 */
export type WarehousePatch = {
  stockDeltas?: {
    productId: string;
    locationId: string;
    lotId?: string;
    binId?: string;
    delta: number;
  }[];
  appendMovements?: Record<string, unknown>[];
  appendUnits?: Record<string, unknown>[];
  appendLots?: Record<string, unknown>[];
  appendReceipts?: Record<string, unknown>[];
  appendReturns?: Record<string, unknown>[];
  appendCycleCounts?: Record<string, unknown>[];
  setAllocationStatus?: { allocationId: string; status: string }[];
};

const DB_NAME = 'mwell-intra-warehouse';
const STORE = 'outbox';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

// In-memory fallback so the queue works in jsdom tests / SSR.
const memoryQueue: OutboxEntry[] = [];

async function tx(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => void,
): Promise<void> {
  const db = await openDb();
  if (!db) {
    fn(memoryStore);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    fn(store);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

// A minimal stand-in for IDBObjectStore used by the memory fallback.
const memoryStore = {
  add(entry: OutboxEntry) {
    memoryQueue.push(entry);
  },
  put(entry: OutboxEntry) {
    const i = memoryQueue.findIndex((e) => e.id === entry.id);
    if (i >= 0) memoryQueue[i] = entry;
    else memoryQueue.push(entry);
  },
  delete(id: string) {
    const i = memoryQueue.findIndex((e) => e.id === id);
    if (i >= 0) memoryQueue.splice(i, 1);
  },
  getAll(): OutboxEntry[] {
    return [...memoryQueue];
  },
} as unknown as IDBObjectStore;

function uid(): string {
  return `oq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function enqueue(
  method: QueueableMethod,
  input: Record<string, unknown>,
  overlay?: WarehousePatch,
): Promise<OutboxEntry> {
  const entry: OutboxEntry = {
    id: uid(),
    method,
    input,
    overlay,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
  await tx('readwrite', (store) => store.add(entry));
  return entry;
}

export async function allPending(): Promise<OutboxEntry[]> {
  const db = await openDb();
  if (!db) {
    return memoryQueue
      .filter((e) => e.status === 'pending')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readonly');
    const req = t.objectStore(STORE).getAll();
    req.onsuccess = () =>
      resolve(
        (req.result as OutboxEntry[])
          .filter((e) => e.status === 'pending')
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      );
    req.onerror = () => reject(req.error);
  });
}

export async function markConflict(id: string, error: string): Promise<void> {
  await updateEntry(id, (e) => {
    e.status = 'conflict';
    e.error = error;
  });
}

export async function removeEntry(id: string): Promise<void> {
  await tx('readwrite', (store) => store.delete(id));
}

export async function updateEntry(
  id: string,
  patch: (e: OutboxEntry) => void,
): Promise<void> {
  const db = await openDb();
  if (!db) {
    const e = memoryQueue.find((x) => x.id === id);
    if (e) patch(e);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    const store = t.objectStore(STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const e = getReq.result as OutboxEntry | undefined;
      if (e) {
        patch(e);
        store.put(e);
      }
    };
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function allConflicts(): Promise<OutboxEntry[]> {
  const db = await openDb();
  const all = db
    ? await new Promise<OutboxEntry[]>((resolve, reject) => {
        const t = db.transaction(STORE, 'readonly');
        const req = t.objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result as OutboxEntry[]);
        req.onerror = () => reject(req.error);
      })
    : [...memoryQueue];
  return all.filter((e) => e.status === 'conflict');
}

export async function pendingCount(): Promise<number> {
  return (await allPending()).length;
}

/** For tests: wipe the in-memory fallback queue. */
export function _resetMemoryQueue(): void {
  memoryQueue.length = 0;
}
