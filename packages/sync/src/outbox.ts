// @cookie/sync — outbox durable de publicación. Estados SDD §6.4.
// Determinista: backend, reloj y transporte inyectados.
export type OpState = "queued" | "uploading" | "syncing" | "failed" | "synced";

export interface PublishOp {
  /** También es Idempotency-Key y deriva el drawingId. Una sola vez. */
  readonly mutationId: string;
  readonly drawingId: string;
  /** Snapshot del documento (JSON) al encolar. Inmutable. */
  readonly docJson: string;
  readonly width: number;
  readonly height: number;
  readonly state: OpState;
  readonly attempts: number;
  readonly nextAttemptAt: number;
  readonly lastError: string | null;
  readonly createdAt: number;
  readonly eventSeq: number | null;
}

export interface OutboxBackend {
  list(): Promise<PublishOp[]>;
  put(op: PublishOp): Promise<void>;
  del(mutationId: string): Promise<void>;
}

export function memoryOutboxBackend(): OutboxBackend {
  const map = new Map<string, PublishOp>();
  return {
    list: async () =>
      [...map.values()].sort((a, b) => a.createdAt - b.createdAt),
    put: async (op) => void map.set(op.mutationId, op),
    del: async (id) => void map.delete(id),
  };
}

/** Backend mínimo string (p.ej. KeyValueBackend de platform-web con prefijo). */
export interface KvLike {
  get(key: string): Promise<unknown>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

export function kvOutboxBackend(kv: KvLike, prefix = "outbox:"): OutboxBackend {
  const keyOf = (id: string): string => `${prefix}${id}`;
  const indexKey = `${prefix}$index`;
  async function index(): Promise<string[]> {
    const raw = await kv.get(indexKey);
    if (typeof raw !== "string") return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((x): x is string => typeof x === "string")
        : [];
    } catch {
      return [];
    }
  }
  return {
    list: async () => {
      const ids = await index();
      const ops: PublishOp[] = [];
      for (const id of ids) {
        const raw = await kv.get(keyOf(id));
        if (typeof raw !== "string") continue;
        try {
          ops.push(JSON.parse(raw) as PublishOp);
        } catch {
          // Registro corrupto: se ignora, no rompe el resto.
        }
      }
      return ops.sort((a, b) => a.createdAt - b.createdAt);
    },
    put: async (op) => {
      await kv.set(keyOf(op.mutationId), JSON.stringify(op));
      const ids = await index();
      if (!ids.includes(op.mutationId)) {
        await kv.set(indexKey, JSON.stringify([...ids, op.mutationId]));
      }
    },
    del: async (id) => {
      await kv.del(keyOf(id));
      const ids = await index();
      await kv.set(indexKey, JSON.stringify(ids.filter((x) => x !== id)));
    },
  };
}
