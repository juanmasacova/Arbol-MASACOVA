/**
 * Local persistence in the browser's IndexedDB. Data never leaves this device unless the user turns on
 * sync to their own private repository.
 */
const DB_NAME = 'arbol-masacova';
const KV = 'kv';
const FILES = 'files';

export interface StoredFile {
  bytes: ArrayBuffer;
  type: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(KV);
      request.result.createObjectStore(FILES);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('Could not open local storage.'));
    };
  });
  return dbPromise;
}

async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error ?? new Error('Local storage failed.'));
    tx.onabort = () => reject(tx.error ?? new Error('Local storage was interrupted.'));
  });
}

export const loadLocalTree = async (): Promise<unknown> => (await run(KV, 'readonly', (s) => s.get('tree'))) ?? null;
export const saveLocalTree = async (tree: unknown): Promise<void> => {
  await run(KV, 'readwrite', (s) => s.put(tree, 'tree'));
};

export const putFile = async (id: string, bytes: Uint8Array, type: string): Promise<void> => {
  const value: StoredFile = { bytes: bytes.slice().buffer, type };
  await run(FILES, 'readwrite', (s) => s.put(value, id));
};
export const getFile = async (id: string): Promise<StoredFile | null> =>
  ((await run(FILES, 'readonly', (s) => s.get(id))) as StoredFile | undefined) ?? null;
export const deleteFile = async (id: string): Promise<void> => {
  await run(FILES, 'readwrite', (s) => s.delete(id));
};

export const listFileIds = async (): Promise<string[]> =>
  ((await run(FILES, 'readonly', (s) => s.getAllKeys())) as IDBValidKey[]).map(String);

export async function wipeLocal(): Promise<void> {
  await run(KV, 'readwrite', (s) => s.clear());
  await run(FILES, 'readwrite', (s) => s.clear());
}
