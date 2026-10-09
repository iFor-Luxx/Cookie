// @cookie/platform-web — borrador local en IndexedDB (web). El backend
// mínimo inyectable permite tests sin navegador.
import type { VersionedDrawingDocument } from "@cookie/drawing";

export interface DraftRecord {
  readonly id: string;
  readonly document: VersionedDrawingDocument;
  readonly updatedAt: string;
}

export interface KeyValueBackend {
  get(key: string): Promise<unknown>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

export function memoryBackend(): KeyValueBackend {
  const map = new Map<string, string>();
  return {
    get: async (k: string) => map.get(k) ?? null,
    set: async (k: string, v: string) => void map.set(k, v),
    del: async (k: string) => void map.delete(k),
  };
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB error"));
  });
}

function openDb(name: string, store: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(store)) {
        req.result.createObjectStore(store);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open error"));
  });
}

/** Backend IndexedDB real (navegador). Fuera del navegador usar memoryBackend. */
export function indexedDbBackend(
  dbName = "cookie",
  storeName = "drafts",
): KeyValueBackend {
  const withStore = async <T>(
    mode: IDBTransactionMode,
    fn: (s: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const db = await openDb(dbName, storeName);
    try {
      const tx = db.transaction(storeName, mode);
      const result = await idbRequest(fn(tx.objectStore(storeName)));
      db.close();
      return result;
    } catch (e) {
      db.close();
      throw e;
    }
  };
  return {
    get: (k) => withStore("readonly", (s) => s.get(k)) as Promise<unknown>,
    set: (k, v) =>
      withStore("readwrite", (s) => s.put(v, k)).then(() => undefined),
    del: (k) =>
      withStore("readwrite", (s) => s.delete(k)).then(() => undefined),
  };
}

export interface DraftStore {
  saveDraft(id: string, doc: VersionedDrawingDocument): Promise<void>;
  loadDraft(id: string): Promise<VersionedDrawingDocument | null>;
  clearDraft(id: string): Promise<void>;
}

export function createDraftStore(backend: KeyValueBackend): DraftStore {
  return {
    saveDraft: async (id, doc) => {
      const record: DraftRecord = {
        id,
        document: doc,
        updatedAt: new Date().toISOString(),
      };
      await backend.set(`draft:${id}`, JSON.stringify(record));
    },
    loadDraft: async (id) => {
      const raw = await backend.get(`draft:${id}`);
      if (typeof raw !== "string") return null;
      try {
        const record = JSON.parse(raw) as DraftRecord;
        if (!record || typeof record !== "object" || !("document" in record))
          return null;
        return record.document;
      } catch {
        return null;
      }
    },
    clearDraft: async (id) => {
      await backend.del(`draft:${id}`);
    },
  };
}
