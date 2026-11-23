// 极简 IndexedDB 封装:单库多 store,支持对象/数组存取与二进制 STL
import type { DBSchema, StoreName } from '../types';

const DB_NAME = 'tower-fixture-db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const stores: StoreName[] = ['components', 'tools', 'workpieces', 'features', 'setups', 'matrices', 'cards', 'stlBlobs', 'meta'];
      for (const name of stores) {
        if (!db.objectStoreNames.contains(name)) {
          const keyPath = name === 'stlBlobs' ? 'key' : name === 'meta' ? 'key' : 'id';
          db.createObjectStore(name, { keyPath });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function getAll<T extends StoreName>(store: T): Promise<DBSchema[T]> {
  return tx(store, 'readonly', (s) => s.getAll() as IDBRequest<DBSchema[T]>);
}

export async function putAll<T extends StoreName>(store: T, items: DBSchema[T]): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    const s = t.objectStore(store);
    for (const item of items) s.put(item);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function putOne<T extends StoreName>(store: T, item: unknown): Promise<void> {
  await tx(store, 'readwrite', (s) => s.put(item));
}

export async function deleteOne(store: StoreName, id: string): Promise<void> {
  await tx(store, 'readwrite', (s) => s.delete(id));
}

export async function clearStore(store: StoreName): Promise<void> {
  await tx(store, 'readwrite', (s) => s.clear());
}

export async function clearAll(): Promise<void> {
  const stores: StoreName[] = ['components', 'tools', 'workpieces', 'features', 'setups', 'matrices', 'cards', 'stlBlobs', 'meta'];
  for (const s of stores) await clearStore(s);
}

export async function getBlob(key: string): Promise<ArrayBuffer | null> {
  const row = await tx('stlBlobs', 'readonly', (s) => s.get(key));
  return (row as { data: ArrayBuffer } | undefined)?.data ?? null;
}

export async function putBlob(key: string, data: ArrayBuffer): Promise<void> {
  await putOne('stlBlobs', { key, data });
}

export async function getMeta<T>(key: string): Promise<T | null> {
  const row = await tx('meta', 'readonly', (s) => s.get(key));
  return (row as { value: T } | undefined)?.value ?? null;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await putOne('meta', { key, value });
}
