import { describe, expect, it } from "vitest";
import {
  backoffMs,
  type PublishTransport,
  SyncEngine,
  TransportError,
} from "./engine";
import { kvOutboxBackend, memoryOutboxBackend } from "./outbox";
import { memoryCursorBackend, reconcile } from "./reconcile";

function deps() {
  let now = 1_000_000;
  let n = 0;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    newMutationId: () => `op-${++n}`,
    random: () => 0.5, // jitter determinista: delay == backoff
  };
}

function okTransport(
  hooks: { publishedKeys?: string[] } = {},
): PublishTransport & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    uploadDocument: async (drawingId) => void calls.push(`doc:${drawingId}`),
    uploadPreview: async (drawingId) => void calls.push(`prev:${drawingId}`),
    publishDrawing: async (drawingId, _h, _w, _hh, key) => {
      calls.push(`pub:${drawingId}:${key}`);
      hooks.publishedKeys?.push(key);
      return { eventSeq: 7 };
    },
    renderPreview: async () => ({
      bytes: new Uint8Array([1]),
      contentType: "image/png",
    }),
    sha256Hex: async () => "ab".repeat(32),
  };
}

describe("backoff", () => {
  it("exponencial con tope 30s", () => {
    expect([1, 2, 3, 4, 5, 6, 10].map(backoffMs)).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ]);
  });
});

describe("SyncEngine", () => {
  it("encola durable y publica con la mutationId como idempotency key", async () => {
    const d = deps();
    const t = okTransport();
    const engine = new SyncEngine(memoryOutboxBackend(), t, d);
    const op = await engine.enqueue(`{"a":1}`, 100, 100);
    expect(op.state).toBe("queued");
    const status = await engine.pump();
    expect(status.pending).toBe(0);
    expect(t.calls).toEqual([
      `doc:${op.drawingId}`,
      `prev:${op.drawingId}`,
      `pub:${op.drawingId}:${op.mutationId}`,
    ]);
    expect(status.lastSyncedAt).toBe(d.now());
  });

  it("reintenta con backoff ante fallo transitorio y no duplica al tener éxito", async () => {
    const d = deps();
    const publishedKeys: string[] = [];
    let failures = 2;
    const t = okTransport({ publishedKeys });
    const flaky: PublishTransport = {
      ...t,
      publishDrawing: async (...args) => {
        if (failures-- > 0) throw new TransportError("timeout", true);
        return t.publishDrawing(...args);
      },
    };
    const backend = memoryOutboxBackend();
    const engine = new SyncEngine(backend, flaky, d);
    await engine.enqueue(`{"a":1}`, 10, 10);
    await engine.pump(); // intento 1 falla → nextAttemptAt = now+1000
    const ops = await backend.list();
    expect(ops[0]?.attempts).toBe(1);
    expect(ops[0]?.nextAttemptAt).toBe(d.now() + 1000);
    await engine.pump(); // aún no vencido → skip
    expect((await backend.list())[0]?.attempts).toBe(1);
    d.advance(1000);
    await engine.pump(); // intento 2 falla → backoff 2000
    expect((await backend.list())[0]?.nextAttemptAt).toBe(d.now() + 2000);
    d.advance(2000);
    const st = await engine.pump(); // intento 3 ok
    expect(st.pending).toBe(0);
    expect(publishedKeys).toEqual([ops[0]?.mutationId]);
  });

  it("error no transitorio marca failed y retry manual lo reencola", async () => {
    const d = deps();
    const t = okTransport();
    const backend = memoryOutboxBackend();
    const engine = new SyncEngine(
      backend,
      {
        ...t,
        publishDrawing: async () =>
          Promise.reject(
            new TransportError(
              "mismo key, distinto hash",
              false,
              "IDEMPOTENCY_CONFLICT",
            ),
          ),
      },
      d,
    );
    const op = await engine.enqueue(`{"a":1}`, 10, 10);
    await engine.pump();
    expect((await backend.list())[0]?.state).toBe("failed");
    expect((await engine.status()).failed).toBe(1);
    await engine.retry(op.mutationId);
    expect((await backend.list())[0]?.state).toBe("queued");
    await engine.discard(op.mutationId);
    expect(await backend.list()).toEqual([]);
  });

  it("kv backend persiste ops como JSON con índice", async () => {
    const map = new Map<string, string>();
    const kv = {
      get: async (k: string) => map.get(k) ?? null,
      set: async (k: string, v: string) => void map.set(k, v),
      del: async (k: string) => void map.delete(k),
    };
    const backend = kvOutboxBackend(kv);
    const d = deps();
    const engine = new SyncEngine(backend, okTransport(), d);
    await engine.enqueue(`{"x":1}`, 5, 5);
    expect(await backend.list()).toHaveLength(1);
    // Nueva instancia sobre el mismo kv ve la op (durable).
    const engine2 = new SyncEngine(backend, okTransport(), d);
    expect((await engine2.status()).pending).toBe(1);
  });
});

describe("reconcile", () => {
  const ev = (seq: number, id: string) => ({
    seq,
    eventId: id,
    type: "drawing.created",
    entityId: `d${seq}`,
  });

  it("aplica en orden e ignora duplicados", async () => {
    const cursor = memoryCursorBackend(0);
    const page1 = {
      events: [ev(1, "e1"), ev(2, "e2")],
      currentSeq: 2,
      snapshotRequired: false,
    };
    const r1 = await reconcile(cursor, async () => page1);
    expect(r1.applied.map((e) => e.seq)).toEqual([1, 2]);
    expect(r1.snapshot).toBe(false);
    const r2 = await reconcile(cursor, async () => page1);
    expect(r2.applied).toEqual([]);
  });

  it("hueco en el lote pide snapshot", async () => {
    const cursor = memoryCursorBackend(5);
    const page = {
      events: [ev(7, "e7")],
      currentSeq: 7,
      snapshotRequired: false,
    };
    const r = await reconcile(cursor, async () => page);
    expect(r.snapshot).toBe(true);
    expect(r.applied).toEqual([]);
  });

  it("snapshotRequired del servidor se propaga", async () => {
    const cursor = memoryCursorBackend(3);
    const r = await reconcile(cursor, async () => ({
      events: [],
      currentSeq: 40,
      snapshotRequired: true,
    }));
    expect(r).toEqual({ applied: [], snapshot: true, currentSeq: 40 });
  });
});
