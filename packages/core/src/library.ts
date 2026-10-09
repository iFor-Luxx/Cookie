// @cookie/core — biblioteca H4: publicación idempotente, timeline, eventos.
import type { ObjectStore } from "@cookie/storage";
import type {
  ClockPort,
  CryptoPort,
  DomainErrorCode,
  PairingStore,
  Result,
} from "./ports";

export type DrawingEventType =
  | "drawing.created"
  | "drawing.deleted"
  | "profile.updated";

export interface DrawingRecord {
  readonly id: string;
  readonly pairSpaceId: string;
  readonly authorUserId: string;
  readonly createdAt: string;
  readonly documentKey: string;
  readonly previewKey: string;
  readonly width: number;
  readonly height: number;
  readonly contentHash: string;
  readonly deletedAt: string | null;
}

export interface PairEvent {
  readonly seq: number;
  readonly eventId: string;
  readonly type: DrawingEventType;
  readonly actorUserId: string;
  readonly entityId: string;
  readonly createdAt: string;
}

export interface IdempotencyRecord {
  readonly scope: string;
  readonly key: string;
  readonly requestHash: string;
  readonly responseJson: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface UploadIntent {
  readonly id: string;
  readonly installationId: string;
  readonly pairSpaceId: string;
  readonly drawingId: string;
  readonly purpose: "drawing-doc" | "drawing-preview";
  readonly objectKey: string;
  readonly expectedHash: string;
  readonly maxBytes: number;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
}

export interface TimelineCursor {
  readonly createdAt: string;
  readonly id: string;
}

export interface LibraryStore {
  findDrawing(id: string): Promise<DrawingRecord | null>;
  /**
   * Txn atómica: inserta Drawing + Evento (seq asignado dentro) + idempotencia
   * con el response final (construido con el seq real). Devuelve seq.
   */
  insertDrawingWithEvent(args: {
    drawing: DrawingRecord;
    event: Omit<PairEvent, "seq">;
    idempotency: Omit<IdempotencyRecord, "responseJson"> | null;
    responseForSeq: (seq: number) => string;
  }): Promise<number>;
  tombstoneDrawingWithEvent(
    drawingId: string,
    deletedAt: string,
    event: Omit<PairEvent, "seq">,
  ): Promise<number>;
  listDrawingsVisible(
    spaceId: string,
    after: TimelineCursor | null,
    limit: number,
  ): Promise<Array<{ drawing: DrawingRecord; eventSeq: number }>>;
  listEvents(
    spaceId: string,
    afterSeq: number,
    limit: number,
  ): Promise<PairEvent[]>;
  currentSeq(spaceId: string): Promise<number>;
  minSeq(spaceId: string): Promise<number | null>;
  getIdempotency(scope: string, key: string): Promise<IdempotencyRecord | null>;
  createUploadIntent(intent: UploadIntent): Promise<void>;
  findUploadIntent(id: string): Promise<UploadIntent | null>;
  consumeUploadIntent(id: string, consumedAt: string): Promise<void>;
  /** Intents vencidos sin consumir (GC). Acotado. */
  listExpiredIntents(nowIso: string, limit: number): Promise<UploadIntent[]>;
  deleteIntent(id: string): Promise<void>;
  /** Borra idempotencia vencida. Devuelve filas. */
  deleteExpiredIdempotency(nowIso: string): Promise<number>;
}

export type LibraryErrorCode =
  | DomainErrorCode
  | "BLOB_NOT_FOUND"
  | "IDEMPOTENCY_CONFLICT"
  | "UPLOAD_EXPIRED"
  | "CURSOR_EXPIRED";

export function encodeCursor(c: TimelineCursor): string {
  const raw = `${c.createdAt}|${c.id}`;
  const bytes = new TextEncoder().encode(raw);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeCursor(cursor: string): TimelineCursor | null {
  try {
    const b64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const raw = new TextDecoder().decode(bytes);
    const sep = raw.indexOf("|");
    if (sep < 0) return null;
    const createdAt = raw.slice(0, sep);
    const id = raw.slice(sep + 1);
    if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export interface PublishedDrawing {
  readonly drawing: DrawingRecord;
  readonly eventSeq: number;
}

export async function publishDrawing(
  pairing: PairingStore,
  library: LibraryStore,
  blobs: ObjectStore,
  crypto: CryptoPort,
  clock: ClockPort,
  input: {
    spaceId: string;
    actorUserId: string;
    drawingId: string;
    contentHash: string;
    width: number;
    height: number;
    idempotencyKey: string;
    requestHash: string;
    scope: string;
    idempotencyTtlSeconds: number;
  },
): Promise<Result<PublishedDrawing, LibraryErrorCode>> {
  const space = await pairing.findPairSpace(input.spaceId);
  if (!space || space.status !== "active")
    return { ok: false, code: "NOT_FOUND" };
  const membership = await pairing.findMembership(
    input.spaceId,
    input.actorUserId,
  );
  if (!membership || membership.leftAt !== null)
    return { ok: false, code: "FORBIDDEN" };
  if (
    input.width <= 0 ||
    input.height <= 0 ||
    input.width > 4096 ||
    input.height > 4096
  ) {
    return { ok: false, code: "VALIDATION_ERROR" };
  }

  const existing = await library.getIdempotency(
    input.scope,
    input.idempotencyKey,
  );
  if (existing) {
    if (existing.requestHash !== input.requestHash) {
      return { ok: false, code: "IDEMPOTENCY_CONFLICT" };
    }
    return {
      ok: true,
      value: JSON.parse(existing.responseJson) as PublishedDrawing,
    };
  }
  const dupe = await library.findDrawing(input.drawingId);
  if (dupe && dupe.pairSpaceId === input.spaceId) {
    if (dupe.contentHash === input.contentHash) {
      const seq = await library.currentSeq(input.spaceId);
      return { ok: true, value: { drawing: dupe, eventSeq: seq } };
    }
    return { ok: false, code: "IDEMPOTENCY_CONFLICT" };
  }

  const now = clock.nowIso();
  const docKey = `spaces/${input.spaceId}/drawings/${input.drawingId}/doc-v1.json`;
  const previewKey = `spaces/${input.spaceId}/drawings/${input.drawingId}/preview-v1.webp`;
  const doc = await blobs.get(docKey);
  const preview = await blobs.get(previewKey);
  if (!doc || !preview) return { ok: false, code: "BLOB_NOT_FOUND" };
  if ((await crypto.sha256Hex(doc.bytes)) !== input.contentHash) {
    return { ok: false, code: "VALIDATION_ERROR" };
  }

  const drawing: DrawingRecord = {
    id: input.drawingId,
    pairSpaceId: input.spaceId,
    authorUserId: input.actorUserId,
    createdAt: now,
    documentKey: docKey,
    previewKey,
    width: input.width,
    height: input.height,
    contentHash: input.contentHash,
    deletedAt: null,
  };
  const responseForSeq = (seq: number): string =>
    JSON.stringify({ drawing, eventSeq: seq } satisfies PublishedDrawing);
  const seq = await library.insertDrawingWithEvent({
    drawing,
    event: {
      eventId: crypto.newId(),
      type: "drawing.created",
      actorUserId: input.actorUserId,
      entityId: input.drawingId,
      createdAt: now,
    },
    idempotency: {
      scope: input.scope,
      key: input.idempotencyKey,
      requestHash: input.requestHash,
      createdAt: now,
      expiresAt: new Date(
        new Date(now).getTime() + input.idempotencyTtlSeconds * 1000,
      ).toISOString(),
    },
    responseForSeq,
  });
  return { ok: true, value: { drawing, eventSeq: seq } };
}

export async function deleteDrawing(
  pairing: PairingStore,
  library: LibraryStore,
  crypto: CryptoPort,
  clock: ClockPort,
  input: { drawingId: string; actorUserId: string },
): Promise<Result<{ eventSeq: number }, LibraryErrorCode>> {
  const drawing = await library.findDrawing(input.drawingId);
  if (!drawing) return { ok: false, code: "NOT_FOUND" };
  if (drawing.deletedAt !== null) {
    // Tombstone idempotente: borrar dos veces no es error.
    const seq = await library.currentSeq(drawing.pairSpaceId);
    return { ok: true, value: { eventSeq: seq } };
  }
  const membership = await pairing.findMembership(
    drawing.pairSpaceId,
    input.actorUserId,
  );
  if (!membership || membership.leftAt !== null)
    return { ok: false, code: "FORBIDDEN" };
  const canDelete =
    drawing.authorUserId === input.actorUserId || membership.role === "owner";
  if (!canDelete) return { ok: false, code: "FORBIDDEN" };
  const now = clock.nowIso();
  const seq = await library.tombstoneDrawingWithEvent(drawing.id, now, {
    eventId: crypto.newId(),
    type: "drawing.deleted",
    actorUserId: input.actorUserId,
    entityId: drawing.id,
    createdAt: now,
  });
  return { ok: true, value: { eventSeq: seq } };
}
