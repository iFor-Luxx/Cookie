// H5 web — motor de sync (outbox durable) + realtime (WS con polling fallback).

import {
  canvas2dTarget,
  parseDocument,
  renderDocument,
  type VersionedDrawingDocument,
} from "@cookie/drawing";
import { indexedDbBackend } from "@cookie/platform-web";
import {
  backoffMs,
  type CursorBackend,
  kvOutboxBackend,
  type PublishTransport,
  reconcile,
  SyncEngine,
  TransportError,
} from "@cookie/sync";
import { ApiError, api } from "./api";
import {
  glTopLeftMapper,
  p5ScaleForBacking,
  registerCookieBrushes,
  renderDocumentP5,
  supportsWebGL2,
} from "./p5brush";

const PREVIEW_BUDGET_BYTES = 16 * 1024;

/** Miniatura dentro del presupuesto: pinta cada intento y codifica WebP. */
async function encodeWithinBudget(
  paint: (size: number) => Promise<HTMLCanvasElement> | HTMLCanvasElement,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  // Thumbnail para Historia únicamente: encajar en un presupuesto fijo para
  // que el historial crezca sin coste (R2 10GB, historial intocable).
  const attempts: ReadonlyArray<readonly [number, number]> = [
    [256, 0.6],
    [256, 0.45],
    [256, 0.32],
    [192, 0.45],
    [128, 0.45],
  ];
  let last: { bytes: Uint8Array; contentType: string } | null = null;
  for (const [size, quality] of attempts) {
    const canvas = await paint(size);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", quality),
    );
    if (!blob) throw new TransportError("Sin preview", false);
    const type = blob.type === "image/webp" ? "image/webp" : "image/png";
    last = {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      contentType: type,
    };
    if (last.bytes.length <= PREVIEW_BUDGET_BYTES) break;
  }
  if (!last) throw new TransportError("Sin preview", false);
  return last;
}

function paintPreview2d(
  doc: VersionedDrawingDocument,
  size: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new TransportError("Sin contexto 2d", false);
  renderDocument(canvas2dTarget(ctx, size, size), doc);
  return canvas;
}

/**
 * Miniatura con textura real (p5.brush, WebGL2). El canvas GL se vuelca a 2D
 * en la misma tarea (readback válido sin preserveDrawingBuffer).
 */
async function paintPreviewP5(
  doc: VersionedDrawingDocument,
  size: number,
): Promise<HTMLCanvasElement> {
  const brush = await import("p5.brush/standalone");
  const gl = document.createElement("canvas");
  gl.width = size;
  gl.height = size;
  brush.load(gl);
  try {
    // Orden estricto: register (copias frescas) y UN solo scale por dibujo.
    registerCookieBrushes(brush);
    const scale = p5ScaleForBacking(size);
    brush.scaleBrushes(scale);
    const docW = doc.canvas.width || 1024;
    const k = size / docW;
    const toPx = glTopLeftMapper(size);
    renderDocumentP5(
      brush,
      {
        canvas: doc.canvas,
        strokes: doc.strokes.map((s) => ({ ...s, size: s.size * k })),
      },
      toPx,
      scale,
    );
  } finally {
    try {
      brush.load();
    } catch {
      // Sin canvas principal: ignorar.
    }
  }
  const out = document.createElement("canvas");
  out.width = size;
  out.height = size;
  const ctx = out.getContext("2d");
  if (!ctx) throw new TransportError("Sin contexto 2d", false);
  ctx.drawImage(gl, 0, 0);
  return out;
}

function toTransportError(e: unknown): TransportError {
  if (e instanceof ApiError) {
    const retryable = e.status === 429 || e.status >= 500;
    return new TransportError(e.message, retryable, e.code);
  }
  if (e instanceof TypeError) return new TransportError("Sin conexión", true);
  return new TransportError(e instanceof Error ? e.message : "Error", true);
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const transport: PublishTransport = {
  uploadDocument: async (drawingId, bytes, hash) => {
    try {
      const intent = await api.uploadIntent({
        drawingId,
        purpose: "drawing-doc",
        contentHash: hash,
        byteSize: bytes.length,
        contentType: "application/json",
      });
      await api.uploadPut(intent.uploadId, bytes, "application/json");
    } catch (e) {
      throw toTransportError(e);
    }
  },
  uploadPreview: async (drawingId, bytes, hash, contentType) => {
    try {
      const intent = await api.uploadIntent({
        drawingId,
        purpose: "drawing-preview",
        contentHash: hash,
        byteSize: bytes.length,
        contentType,
      });
      await api.uploadPut(intent.uploadId, bytes, contentType);
    } catch (e) {
      throw toTransportError(e);
    }
  },
  publishDrawing: async (drawingId, hash, width, height, key) => {
    try {
      const spaceId = currentSpaceId();
      if (!spaceId) throw new TransportError("Sin espacio", false);
      const res = await api.publish(
        spaceId,
        drawingId,
        hash,
        width,
        height,
        key,
      );
      return { eventSeq: res.drawing.eventSeq };
    } catch (e) {
      throw e instanceof TransportError ? e : toTransportError(e);
    }
  },
  renderPreview: async (docJson) => {
    const doc = parseDocument(JSON.parse(docJson));
    if (supportsWebGL2()) {
      try {
        return await encodeWithinBudget((size) => paintPreviewP5(doc, size));
      } catch {
        // Caída al renderer 2D (miniatura plana pero válida).
      }
    }
    return encodeWithinBudget((size) => paintPreview2d(doc, size));
  },
  sha256Hex,
};

let spaceIdHolder: string | null = null;
function currentSpaceId(): string | null {
  return spaceIdHolder;
}
export function setSyncSpace(spaceId: string | null): void {
  spaceIdHolder = spaceId;
}

const syncKv = indexedDbBackend("cookie", "sync");

export const syncEngine = new SyncEngine(
  kvOutboxBackend(syncKv, "outbox:"),
  transport,
  {
    newMutationId: () => crypto.randomUUID(),
    now: () => Date.now(),
    random: () => Math.random(),
  },
);

export function cursorBackend(spaceId: string): CursorBackend {
  const key = `cursor:${spaceId}`;
  return {
    load: async () => {
      try {
        const raw = await syncKv.get(key);
        if (typeof raw !== "string") return { lastSeq: 0, appliedIds: [] };
        const parsed = JSON.parse(raw) as {
          lastSeq?: number;
          appliedIds?: string[];
        };
        return {
          lastSeq: typeof parsed.lastSeq === "number" ? parsed.lastSeq : 0,
          appliedIds: Array.isArray(parsed.appliedIds) ? parsed.appliedIds : [],
        };
      } catch {
        return { lastSeq: 0, appliedIds: [] };
      }
    },
    save: async (s) => {
      await syncKv.set(key, JSON.stringify(s));
    },
  };
}

export async function reconcileSpace(spaceId: string): Promise<{
  applied: Array<{ seq: number; type: string }>;
  snapshot: boolean;
}> {
  const res = await reconcile(cursorBackend(spaceId), async (afterSeq) => {
    const page = await api.events(spaceId, afterSeq);
    return {
      events: page.events.map((e) => ({
        seq: e.seq,
        eventId: e.eventId ?? `${e.seq}`,
        type: e.type,
        entityId: e.entityId,
      })),
      currentSeq: page.currentSeq,
      snapshotRequired: page.snapshotRequired,
    };
  });
  return { applied: res.applied, snapshot: res.snapshot };
}

// ---- Realtime: WS si hay URL configurada, si no polling ----

const WS_ENV = import.meta.env["VITE_WS_URL"] as string | undefined;

function wsBase(): string | null {
  if (WS_ENV) return WS_ENV.replace(/\/$/, "");
  return null;
}

export interface RealtimeHandlers {
  onRemoteEvents(events: Array<{ seq: number; type: string }>): void;
  onSnapshot(): void;
}

const POLL_MS = 15_000;
const PING_MS = 25_000;

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private stopped = false;
  private attempt = 0;
  private reconnectTimer: number | null = null;
  private pollTimer: number | null = null;
  private pingTimer: number | null = null;

  constructor(
    private readonly spaceId: string,
    private readonly handlers: RealtimeHandlers,
  ) {}

  start(): void {
    this.stopped = false;
    if (wsBase()) void this.connectWs();
    else this.startPolling();
  }

  stop(): void {
    this.stopped = true;
    this.ws?.close();
    this.ws = null;
    for (const t of [this.reconnectTimer, this.pollTimer, this.pingTimer]) {
      if (t !== null) window.clearTimeout(t);
      if (t !== null) window.clearInterval(t);
    }
    this.reconnectTimer = this.pollTimer = this.pingTimer = null;
  }

  /** Llamar al volver a foreground / online. */
  async refresh(): Promise<void> {
    try {
      const res = await reconcileSpace(this.spaceId);
      if (res.snapshot) this.handlers.onSnapshot();
      else if (res.applied.length > 0)
        this.handlers.onRemoteEvents(res.applied);
    } catch {
      // Sin red: el próximo ciclo lo intentará.
    }
  }

  private startPolling(): void {
    void this.refresh();
    this.pollTimer = window.setInterval(() => void this.refresh(), POLL_MS);
  }

  private async connectWs(): Promise<void> {
    if (this.stopped) return;
    const base = wsBase();
    if (!base) return;
    try {
      const installationId = api.sessionInfo()?.installationId;
      if (!installationId) return;
      const { ticket } = await api.realtimeTicket(this.spaceId);
      const cursor = await cursorBackend(this.spaceId).load();
      const ws = new WebSocket(
        `${base}/v1/pair-spaces/${this.spaceId}/realtime-socket?ticket=${encodeURIComponent(ticket)}`,
        "pair.v1",
      );
      this.ws = ws;
      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: "hello",
            protocol: 1,
            lastEventSeq: cursor.lastSeq,
            installationId,
          }),
        );
        this.pingTimer = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type: "ping" }));
        }, PING_MS);
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data !== "string") return;
        let msg: { type?: string };
        try {
          msg = JSON.parse(ev.data) as { type?: string };
        } catch {
          return;
        }
        if (msg.type === "ready") this.attempt = 0;
        if (
          msg.type === "drawing.created" ||
          msg.type === "drawing.deleted" ||
          msg.type === "sync.ack"
        ) {
          void this.refresh();
        }
      };
      ws.onclose = () => {
        this.ws = null;
        if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
        this.pingTimer = null;
        if (!this.stopped) this.scheduleReconnect();
      };
      ws.onerror = () => ws.close();
    } catch {
      if (!this.stopped) this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    this.attempt++;
    const delay = Math.floor(backoffMs(this.attempt) * (0.5 + Math.random()));
    this.reconnectTimer = window.setTimeout(() => void this.connectWs(), delay);
  }
}
