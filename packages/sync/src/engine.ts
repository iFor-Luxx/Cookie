// @cookie/sync — motor de reintentos con backoff/jitter. Sin red real.
import type { OutboxBackend, PublishOp } from "./outbox";

export const BACKOFF_BASE_MS = 1000 as const;
export const BACKOFF_MAX_MS = 30_000 as const;

/** Backoff exponencial puro: 1s, 2s, 4s… tope 30s. */
export function backoffMs(attempt: number): number {
  return Math.min(
    BACKOFF_MAX_MS,
    BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1),
  );
}

export class TransportError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly code?: string,
  ) {
    super(message);
  }
}

export interface PublishTransport {
  uploadDocument(
    drawingId: string,
    bytes: Uint8Array,
    contentHash: string,
  ): Promise<void>;
  uploadPreview(
    drawingId: string,
    bytes: Uint8Array,
    contentHash: string,
    contentType: string,
  ): Promise<void>;
  publishDrawing(
    drawingId: string,
    contentHash: string,
    width: number,
    height: number,
    idempotencyKey: string,
  ): Promise<{ eventSeq: number }>;
  /** Preview derivada del snapshot (offscreen en web, thumbnail en tests). */
  renderPreview(
    docJson: string,
  ): Promise<{ bytes: Uint8Array; contentType: string }>;
  sha256Hex(data: Uint8Array): Promise<string>;
}

export interface SyncEngineDeps {
  newMutationId(): string;
  now(): number;
  /** 0..1 para jitter. En tests, valor fijo. */
  random(): number;
}

export interface EngineStatus {
  readonly pending: number;
  readonly failed: number;
  readonly lastError: string | null;
  readonly lastSyncedAt: number | null;
}

export type EngineListener = (status: EngineStatus) => void;

export class SyncEngine {
  private lastSyncedAt: number | null = null;
  private lastError: string | null = null;
  private listeners = new Set<EngineListener>();

  constructor(
    private readonly backend: OutboxBackend,
    private readonly transport: PublishTransport,
    private readonly deps: SyncEngineDeps,
  ) {}

  subscribe(l: EngineListener): () => void {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }

  private async emit(): Promise<void> {
    const ops = await this.backend.list();
    const status: EngineStatus = {
      pending: ops.filter(
        (o) =>
          o.state === "queued" ||
          o.state === "uploading" ||
          o.state === "syncing",
      ).length,
      failed: ops.filter((o) => o.state === "failed").length,
      lastError: this.lastError,
      lastSyncedAt: this.lastSyncedAt,
    };
    for (const l of this.listeners) l(status);
  }

  async status(): Promise<EngineStatus> {
    const ops = await this.backend.list();
    return {
      pending: ops.filter((o) => o.state !== "failed" && o.state !== "synced")
        .length,
      failed: ops.filter((o) => o.state === "failed").length,
      lastError: this.lastError,
      lastSyncedAt: this.lastSyncedAt,
    };
  }

  async enqueue(
    docJson: string,
    width: number,
    height: number,
  ): Promise<PublishOp> {
    const mutationId = this.deps.newMutationId();
    const op: PublishOp = {
      mutationId,
      drawingId: mutationId,
      docJson,
      width,
      height,
      state: "queued",
      attempts: 0,
      nextAttemptAt: this.deps.now(),
      lastError: null,
      createdAt: this.deps.now(),
      eventSeq: null,
    };
    await this.backend.put(op);
    await this.emit();
    return op;
  }

  async retry(mutationId: string): Promise<void> {
    const ops = await this.backend.list();
    const op = ops.find((o) => o.mutationId === mutationId);
    if (!op || op.state !== "failed") return;
    await this.backend.put({
      ...op,
      state: "queued",
      nextAttemptAt: this.deps.now(),
      lastError: null,
    });
    await this.emit();
  }

  async retryAllFailed(): Promise<number> {
    const ops = await this.backend.list();
    let n = 0;
    for (const op of ops.filter((o) => o.state === "failed")) {
      await this.backend.put({
        ...op,
        state: "queued",
        nextAttemptAt: this.deps.now(),
        lastError: null,
      });
      n++;
    }
    if (n > 0) await this.pump();
    else await this.emit();
    return n;
  }

  async discard(mutationId: string): Promise<void> {
    await this.backend.del(mutationId);
    await this.emit();
  }

  /** Procesa una vez las ops vencidas. La UI lo llama al volver la red + timer. */
  async pump(): Promise<EngineStatus> {
    const now = this.deps.now();
    const ops = await this.backend.list();
    for (const op of ops.filter(
      (o) => o.state === "queued" && o.nextAttemptAt <= now,
    )) {
      await this.process(op);
    }
    const status = await this.status();
    for (const l of this.listeners) l(status);
    return status;
  }

  private async process(op: PublishOp): Promise<void> {
    const attempt = op.attempts + 1;
    try {
      await this.backend.put({ ...op, state: "uploading", attempts: attempt });
      const docBytes = new TextEncoder().encode(op.docJson);
      const docHash = await this.transport.sha256Hex(docBytes);
      await this.transport.uploadDocument(op.drawingId, docBytes, docHash);
      const preview = await this.transport.renderPreview(op.docJson);
      const previewHash = await this.transport.sha256Hex(preview.bytes);
      await this.backend.put({ ...op, state: "syncing", attempts: attempt });
      await this.transport.uploadPreview(
        op.drawingId,
        preview.bytes,
        previewHash,
        preview.contentType,
      );
      const res = await this.transport.publishDrawing(
        op.drawingId,
        docHash,
        op.width,
        op.height,
        op.mutationId,
      );
      // ACK durable: fuera del outbox.
      await this.backend.del(op.mutationId);
      this.lastSyncedAt = this.deps.now();
      this.lastError = null;
      void res;
    } catch (e) {
      const retryable = e instanceof TransportError ? e.retryable : true;
      const message = e instanceof Error ? e.message : "Error desconocido";
      this.lastError = message;
      if (!retryable) {
        await this.backend.put({
          ...op,
          state: "failed",
          attempts: attempt,
          lastError: message,
        });
        return;
      }
      const delay = Math.min(
        BACKOFF_MAX_MS,
        Math.floor(backoffMs(attempt) * (0.5 + this.deps.random())),
      );
      await this.backend.put({
        ...op,
        state: "queued",
        attempts: attempt,
        nextAttemptAt: this.deps.now() + delay,
        lastError: message,
      });
    }
  }
}
