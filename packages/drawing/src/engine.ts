// @cookie/drawing — DrawingEngine: input local, undo como acciones, sin DOM.
import {
  type BrushConfig,
  type DrawingPoint,
  MAX_POINTS_PER_STROKE,
  MAX_STROKES_PER_DOCUMENT,
  type PointerSample,
  type Stroke,
  type VersionedDrawingDocument,
} from "./model";

export interface EngineIds {
  newStrokeId(): string;
  newSeed(): number;
}

function defaultIds(): EngineIds {
  return {
    newStrokeId: () => crypto.randomUUID(),
    newSeed: () => (Math.random() * 2 ** 31) | 0,
  };
}

export type EngineEvent = "strokes" | "active";

export interface ActiveStrokePeek {
  readonly brush: BrushConfig;
  readonly seed: number;
  readonly points: readonly DrawingPoint[];
}

export interface DrawingEngine {
  beginStroke(input: PointerSample, tool: BrushConfig): void;
  appendSamples(samples: readonly PointerSample[]): void;
  endStroke(): string | null;
  cancelStroke(): void;
  /** Trazo en curso para preview (overlay). Null si no hay. */
  peekActive(): ActiveStrokePeek | null;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  loadDocument(doc: VersionedDrawingDocument): void;
  exportDocument(): VersionedDrawingDocument;
  activePointCount(): number;
  subscribe(listener: (e: EngineEvent) => void): () => void;
  dispose(): void;
}

function toPoint(s: PointerSample): DrawingPoint {
  const clamp01 = (n: number) =>
    Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
  return [
    clamp01(s.x),
    clamp01(s.y),
    clamp01(s.pressure),
    Number.isFinite(s.tilt) ? s.tilt : 0,
  ];
}

export function createDrawingEngine(
  canvas: { width: number; height: number; background: string },
  ids: EngineIds = defaultIds(),
): DrawingEngine {
  let strokes: Stroke[] = [];
  let redoStack: Stroke[] = [];
  let active: {
    brush: BrushConfig;
    id: string;
    seed: number;
    points: DrawingPoint[];
  } | null = null;
  const listeners = new Set<(e: EngineEvent) => void>();
  let disposed = false;

  const emit = (e: EngineEvent): void => {
    for (const l of listeners) l(e);
  };

  return {
    beginStroke(input: PointerSample, tool: BrushConfig): void {
      if (disposed || strokes.length >= MAX_STROKES_PER_DOCUMENT) return;
      active = {
        brush: tool,
        id: ids.newStrokeId(),
        seed: ids.newSeed(),
        points: [toPoint(input)],
      };
      redoStack = [];
      emit("active");
    },
    appendSamples(samples: readonly PointerSample[]): void {
      if (disposed || !active) return;
      for (const s of samples) {
        if (active.points.length >= MAX_POINTS_PER_STROKE) break;
        const last = active.points[active.points.length - 1];
        const p = toPoint(s);
        // Descarta duplicados exactos consecutivos (ruido de coalesced).
        if (last && last[0] === p[0] && last[1] === p[1]) continue;
        active.points.push(p);
      }
      emit("active");
    },
    endStroke(): string | null {
      if (disposed || !active) return null;
      const finished = active;
      active = null;
      if (finished.points.length === 0) {
        emit("active");
        return null;
      }
      const stroke: Stroke = {
        id: finished.id,
        tool: finished.brush.tool,
        color: finished.brush.color,
        size: finished.brush.size,
        opacity: finished.brush.opacity,
        seed: finished.seed,
        points: finished.points,
      };
      strokes.push(stroke);
      emit("strokes");
      emit("active");
      return stroke.id;
    },
    cancelStroke(): void {
      if (disposed || !active) return;
      active = null;
      emit("active");
    },
    undo(): boolean {
      const s = strokes.pop();
      if (!s) return false;
      redoStack.push(s);
      emit("strokes");
      return true;
    },
    redo(): boolean {
      const s = redoStack.pop();
      if (!s) return false;
      strokes.push(s);
      emit("strokes");
      return true;
    },
    canUndo: () => strokes.length > 0,
    canRedo: () => redoStack.length > 0,
    loadDocument(doc: VersionedDrawingDocument): void {
      strokes = [...doc.strokes];
      redoStack = [];
      active = null;
      emit("strokes");
    },
    exportDocument(): VersionedDrawingDocument {
      return {
        schemaVersion: 1,
        canvas: { ...canvas },
        strokes: [...strokes],
      };
    },
    activePointCount: () => active?.points.length ?? 0,
    peekActive: () =>
      active
        ? { brush: active.brush, seed: active.seed, points: [...active.points] }
        : null,
    subscribe(listener: (e: EngineEvent) => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    dispose(): void {
      disposed = true;
      listeners.clear();
      strokes = [];
      redoStack = [];
      active = null;
    },
  };
}
