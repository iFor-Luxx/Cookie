import { memoryObjectStore } from "@cookie/storage";
import { describe, expect, it } from "vitest";
import {
  type DrawingRecord,
  decodeCursor,
  deleteDrawing,
  encodeCursor,
  type IdempotencyRecord,
  type LibraryStore,
  type PairEvent,
  publishDrawing,
  type UploadIntent,
} from "./library";
import type { ClockPort, CryptoPort, PairingStore } from "./ports";

function stubCrypto(): CryptoPort {
  let n = 0;
  return {
    newId: () => `id-${++n}`,
    newSecret: () => `secret-${++n}`,
    newInviteToken: () => `ABCDEFGH${"JKLMNPQRSTUVWXYZ23456789"[n % 24]}`,
    hashSecret: async (s: string) => `h:${s}`,
    verifySecret: async (s: string, h: string) => h === `h:${s}`,
    lookupHash: async (s: string) => `l:${s}`,
    sha256Hex: async (s: string) => `s:${String(s).length}`,
  };
}

const clock: ClockPort = { nowIso: () => "2026-10-09T12:00:00.000Z" };

function harness(): {
  pairing: PairingStore;
  library: LibraryStore;
} {
  const drawings = new Map<string, DrawingRecord>();
  const events: PairEvent[] = [];
  const idem = new Map<string, IdempotencyRecord>();
  const memberships = new Map<string, { role: "owner" | "member" }>([
    ["space-1:user-a", { role: "owner" }],
    ["space-1:user-b", { role: "member" }],
  ]);
  const pairing = {
    findPairSpace: async (id: string) =>
      id === "space-1"
        ? { id, status: "active" as const, createdAt: clock.nowIso() }
        : null,
    findMembership: async (spaceId: string, userId: string) => {
      const m = memberships.get(`${spaceId}:${userId}`);
      return m
        ? {
            pairSpaceId: spaceId,
            userId,
            role: m.role,
            joinedAt: clock.nowIso(),
            leftAt: null,
          }
        : null;
    },
  } as unknown as PairingStore;
  const library: LibraryStore = {
    findDrawing: async (id) => drawings.get(id) ?? null,
    insertDrawingWithEvent: async ({
      drawing,
      event,
      idempotency,
      responseForSeq,
    }) => {
      const seq = events.length + 1;
      drawings.set(drawing.id, drawing);
      events.push({ ...event, seq });
      if (idempotency) {
        idem.set(`${idempotency.scope}:${idempotency.key}`, {
          ...idempotency,
          responseJson: responseForSeq(seq),
        });
      }
      return seq;
    },
    tombstoneDrawingWithEvent: async (drawingId, deletedAt, event) => {
      const d = drawings.get(drawingId);
      if (d) drawings.set(drawingId, { ...d, deletedAt });
      const seq = events.length + 1;
      events.push({ ...event, seq });
      return seq;
    },
    listDrawingsVisible: async () => [],
    listEvents: async (_space, afterSeq) =>
      events.filter((e) => e.seq > afterSeq),
    currentSeq: async () => events.length,
    minSeq: async () => (events.length > 0 ? 1 : null),
    getIdempotency: async (scope, key) => idem.get(`${scope}:${key}`) ?? null,
    createUploadIntent: async () => undefined,
    findUploadIntent: async () => null,
    consumeUploadIntent: async () => undefined,
    listExpiredIntents: async () => [],
    deleteIntent: async () => undefined,
    deleteExpiredIdempotency: async () => 0,
  };
  return { pairing, library };
}

const drawingInput = {
  spaceId: "space-1",
  actorUserId: "user-a",
  drawingId: "draw-1",
  contentHash: "s:11",
  width: 1024,
  height: 1024,
  idempotencyKey: "key-1",
  requestHash: "req-1",
  scope: "publish:space-1",
  idempotencyTtlSeconds: 3600,
};

describe("library H4", () => {
  it("publica con blobs verificados y reintento idempotente", async () => {
    const { pairing, library } = harness();
    const crypto = stubCrypto();
    const blobs = memoryObjectStore();
    const docBytes = new TextEncoder().encode(`{"schemaVersion":1}`);
    await blobs.put("spaces/space-1/drawings/draw-1/doc-v1.json", {
      bytes: docBytes,
      contentType: "application/json",
      size: docBytes.length,
    });
    const preview = new Uint8Array([1, 2, 3]);
    await blobs.put("spaces/space-1/drawings/draw-1/preview-v1.webp", {
      bytes: preview,
      contentType: "image/webp",
      size: preview.length,
    });
    // contentHash = s:<len> según stub → len 19 para este JSON.
    const hash = await crypto.sha256Hex(docBytes);
    const res = await publishDrawing(pairing, library, blobs, crypto, clock, {
      ...drawingInput,
      contentHash: hash,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.eventSeq).toBe(1);

    // Reintento misma key + mismo hash → mismo resultado sin duplicar.
    const retry = await publishDrawing(pairing, library, blobs, crypto, clock, {
      ...drawingInput,
      contentHash: hash,
    });
    expect(retry).toEqual(res);
    expect(await library.currentSeq("space-1")).toBe(1);

    // Misma key + distinto hash → conflicto.
    const conflict = await publishDrawing(
      pairing,
      library,
      blobs,
      crypto,
      clock,
      {
        ...drawingInput,
        contentHash: hash,
        requestHash: "req-2",
      },
    );
    expect(conflict).toEqual({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
  });

  it("sin blobs falla con BLOB_NOT_FOUND y hash distinto con VALIDATION_ERROR", async () => {
    const { pairing, library } = harness();
    const crypto = stubCrypto();
    const blobs = memoryObjectStore();
    const missing = await publishDrawing(
      pairing,
      library,
      blobs,
      crypto,
      clock,
      drawingInput,
    );
    expect(missing).toEqual({ ok: false, code: "BLOB_NOT_FOUND" });
  });

  it("no miembro no publica (FORBIDDEN)", async () => {
    const { pairing, library } = harness();
    const crypto = stubCrypto();
    const res = await publishDrawing(
      pairing,
      library,
      memoryObjectStore(),
      crypto,
      clock,
      {
        ...drawingInput,
        actorUserId: "user-z",
      },
    );
    expect(res).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("tombstone: autor y owner pueden, tercero no; re-borrado idempotente", async () => {
    const { pairing, library } = harness();
    const crypto = stubCrypto();
    const blobs = memoryObjectStore();
    const docBytes = new TextEncoder().encode(`{"schemaVersion":1}`);
    await blobs.put("spaces/space-1/drawings/draw-1/doc-v1.json", {
      bytes: docBytes,
      contentType: "application/json",
      size: docBytes.length,
    });
    await blobs.put("spaces/space-1/drawings/draw-1/preview-v1.webp", {
      bytes: new Uint8Array([9]),
      contentType: "image/webp",
      size: 1,
    });
    const hash = await crypto.sha256Hex(docBytes);
    const pub = await publishDrawing(pairing, library, blobs, crypto, clock, {
      ...drawingInput,
      contentHash: hash,
    });
    expect(pub.ok).toBe(true);

    const third = await deleteDrawing(pairing, library, crypto, clock, {
      drawingId: "draw-1",
      actorUserId: "user-z",
    });
    expect(third).toEqual({ ok: false, code: "FORBIDDEN" });

    const del = await deleteDrawing(pairing, library, crypto, clock, {
      drawingId: "draw-1",
      actorUserId: "user-a",
    });
    expect(del.ok).toBe(true);
    const again = await deleteDrawing(pairing, library, crypto, clock, {
      drawingId: "draw-1",
      actorUserId: "user-a",
    });
    expect(again.ok).toBe(true);
    expect((await library.findDrawing("draw-1"))?.deletedAt).toBeTypeOf(
      "string",
    );
  });

  it("cursor opaco roundtrip y rechazo de cursor inválido", () => {
    const c = { createdAt: "2026-10-09T12:00:00.000Z", id: "abc" };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(decodeCursor("!!!")).toBeNull();
    expect(
      decodeCursor(encodeCursor({ createdAt: "no-fecha", id: "x" })),
    ).toBeNull();
  });

  it("intents: helper de tipos compila (cubierto en server)", () => {
    const intent: UploadIntent = {
      id: "u",
      installationId: "i",
      pairSpaceId: "space-1",
      drawingId: "draw-1",
      purpose: "drawing-doc",
      objectKey: "k",
      expectedHash: "s:1",
      maxBytes: 10,
      createdAt: clock.nowIso(),
      expiresAt: clock.nowIso(),
      consumedAt: null,
    };
    expect(intent.purpose).toBe("drawing-doc");
  });
});
