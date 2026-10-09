import {
  type BrushConfig,
  canvas2dTarget,
  type DrawingEngine,
  parseDocument,
  renderDocument,
  renderStroke,
  type VersionedDrawingDocument,
} from "@cookie/drawing";
import type { DraftStore } from "@cookie/platform-web";
import { useEffect, useRef } from "react";
import { attachPointerInput } from "./pointer-input";

const DOC_SIZE = 1024;
const AUTOSAVE_DEBOUNCE_MS = 800;
const MAX_DPR = 2;

export type SaveState = "saved" | "saving" | "local";

interface CanvasBoardProps {
  engine: DrawingEngine;
  brush: BrushConfig;
  draftStore: DraftStore;
  draftId: string;
  onSaveState: (s: SaveState) => void;
  onStrokesVersion: () => void;
}

/** Lienzo: input por Pointer Events fuera del estado React, capas base+overlay. */
export function CanvasBoard({
  engine,
  brush,
  draftStore,
  draftId,
  onSaveState,
  onStrokesVersion,
}: CanvasBoardProps): React.JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const brushRef = useRef(brush);
  brushRef.current = brush;
  const callbacksRef = useRef({ onSaveState, onStrokesVersion });
  callbacksRef.current = { onSaveState, onStrokesVersion };
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const base = baseRef.current;
    const overlay = overlayRef.current;
    if (!wrap || !base || !overlay) return;

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const rect = wrap.getBoundingClientRect();
    const cssSize = Math.min(rect.width, 640);
    for (const c of [base, overlay]) {
      c.width = Math.round(cssSize * dpr);
      c.height = Math.round(cssSize * dpr);
      c.style.width = `${cssSize}px`;
      c.style.height = `${cssSize}px`;
    }
    const baseCtx = base.getContext("2d");
    const overlayCtx = overlay.getContext("2d");
    if (!baseCtx || !overlayCtx) return;

    const drawBase = (): void => {
      const target = canvas2dTarget(baseCtx, base.width, base.height);
      renderDocument(target, engine.exportDocument());
    };
    const drawOverlay = (): void => {
      overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
      const peek = engine.peekActive();
      if (!peek || peek.points.length === 0) return;
      const target = canvas2dTarget(overlayCtx, overlay.width, overlay.height);
      renderStroke(
        target,
        { width: DOC_SIZE, height: DOC_SIZE, background: "#FFFFFF" },
        {
          id: "active",
          tool: peek.brush.tool,
          color: peek.brush.color,
          size: peek.brush.size,
          opacity: peek.brush.opacity,
          seed: peek.seed,
          points: [...peek.points],
        },
      );
    };

    let cancelled = false;
    void (async () => {
      try {
        const raw = await draftStore.loadDraft(draftId);
        if (cancelled || !raw) {
          drawBase();
          return;
        }
        engine.loadDocument(parseDocument(raw));
      } catch {
        // Borrador corrupto: empezar en blanco.
      }
      if (!cancelled) drawBase();
    })();

    const scheduleSave = (): void => {
      callbacksRef.current.onSaveState("saving");
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        void draftStore
          .saveDraft(draftId, engine.exportDocument())
          .then(() => callbacksRef.current.onSaveState("saved"))
          .catch(() => callbacksRef.current.onSaveState("local"));
      }, AUTOSAVE_DEBOUNCE_MS);
    };

    const unsubscribe = engine.subscribe((e) => {
      if (e === "strokes") {
        drawBase();
        scheduleSave();
        callbacksRef.current.onStrokesVersion();
      } else {
        drawOverlay();
      }
    });

    const detachPointer = attachPointerInput(
      wrap,
      engine,
      () => brushRef.current,
      base,
    );

    return () => {
      cancelled = true;
      unsubscribe();
      detachPointer();
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
    // engine/draftStore/draftId estables por sesión; brush y callbacks via ref.
  }, [engine, draftStore, draftId]);

  return (
    <div className="flex justify-center">
      <div
        ref={wrapRef}
        className="relative touch-none overflow-hidden rounded-lg border bg-white shadow select-none"
        style={{ touchAction: "none" }}
        aria-label="Lienzo de dibujo"
        role="application"
      >
        <canvas ref={baseRef} className="block" />
        <canvas
          ref={overlayRef}
          className="pointer-events-none absolute inset-0 block"
        />
      </div>
    </div>
  );
}

export type { VersionedDrawingDocument };
