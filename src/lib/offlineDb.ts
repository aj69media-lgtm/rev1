export interface QueuedMutation {
  id?: number;
  method: string;
  url: string;
  body: Record<string, unknown>;
  label: string;
  clientIdempotencyKey: string;
  createdAt: string;
}

const DB_NAME = 'buildcore_cbms_offline';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('snapshots')) {
        db.createObjectStore('snapshots', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('mutationQueue')) {
        db.createObjectStore('mutationQueue', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveOfflineSnapshot(key: string, data: unknown): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('snapshots', 'readwrite');
      tx.objectStore('snapshots').put({ key, data, updatedAt: new Date().toISOString() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore storage quota / SSR errors
  }
}

export async function loadOfflineSnapshot<T = any>(key: string): Promise<{ data: T; updatedAt: string } | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('snapshots', 'readonly');
      const req = tx.objectStore('snapshots').get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function enqueueOfflineMutation(
  mutation: Omit<QueuedMutation, 'id' | 'createdAt'>
): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('mutationQueue', 'readwrite');
    const req = tx.objectStore('mutationQueue').add({
      ...mutation,
      createdAt: new Date().toISOString(),
    });
    req.onsuccess = () => resolve(Number(req.result));
    req.onerror = () => reject(req.error);
  });
}

export async function getQueuedMutations(): Promise<QueuedMutation[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('mutationQueue', 'readonly');
      const req = tx.objectStore('mutationQueue').getAll();
      req.onsuccess = () => resolve((req.result || []) as QueuedMutation[]);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function removeQueuedMutation(id: number): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('mutationQueue', 'readwrite');
    tx.objectStore('mutationQueue').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
