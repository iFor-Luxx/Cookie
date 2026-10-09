// @cookie/storage — puerto de blobs. R2 en prod, memoria en tests.
// Claves siempre server-generated; nunca base64 en SQL/WS/logs/push.
export interface StoredObject {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly size: number;
}

export interface ObjectStore {
  put(key: string, object: StoredObject): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

export function memoryObjectStore(): ObjectStore & { keys(): string[] } {
  const map = new Map<string, StoredObject>();
  return {
    put: async (key, object) => void map.set(key, object),
    get: async (key) => map.get(key) ?? null,
    delete: async (key) => void map.delete(key),
    keys: () => [...map.keys()],
  };
}

/** Límites MVP (SDD §4.7). */
export const LIMITS = {
  drawingDocBytes: 2 * 1024 * 1024,
  previewBytes: 512 * 1024,
  renderBytes: 4 * 1024 * 1024,
  apiJsonBytes: 256 * 1024,
  timelinePage: 50,
  eventBatch: 100,
} as const;
