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

/** Versión del esquema: subirla ejecuta onupgradeneeded y crea el almacén. */
const DB_VERSION = 2;

function openDb(name: string, store: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(store)) {
        req.result.createObjectStore(store);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open error"));
    // Otra pestaña con conexión vieja: no colgar el lienzo, degradar a local.
    req.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
}

function deleteDb(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
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
    const runOnce = async (): Promise<T> => {
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
    try {
      return await runOnce();
    } catch (e) {
      // Base obsoleta sin el almacén (v1 de iteraciones viejas): recrearla
      // y reintentar una vez. El borrador es efímero; el dibujo nunca se
      // bloquea por esto (arriba se degrada a modo local).
      if (e instanceof DOMException && e.name === "NotFoundError") {
        await deleteDb(dbName);
        return await runOnce();
      }
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
