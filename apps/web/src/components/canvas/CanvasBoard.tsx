import {
  type BrushConfig,
  canvas2dTarget,
  type DrawingEngine,
  type PointerSample,
  parseDocument,
  renderDocument,
  renderStroke,
  type VersionedDrawingDocument,
} from "@cookie/drawing";
import type { DraftStore } from "@cookie/platform-web";
import { useEffect, useRef, useState } from "react";

const DOC_SIZE = 1024;
const AUTOSAVE_DEBOUNCE_MS = 800;
const MAX_DPR = 2;

export type SaveState = "saved" | "saving" | "local";

export type CanvasMode = "draw" | "pan";

interface CanvasBoardProps {
  engine: DrawingEngine;
  brush: BrushConfig;
  draftStore: DraftStore;
  draftId: string;
  onSaveState: (s: SaveState) => void;
  onStrokesVersion: () => void;
  /** Notifica la escala actual (para mostrar el % de zoom). */
  onZoom?: (scale: number) => void;
  /** Marco punteado en lugar del borde sólido. */
  dashed?: boolean;
  /** Mover: los dedos mueven la vista, no dibujan. Pintar: lo contrario. */
  mode?: CanvasMode;
  /** Al cambiar, la vista vuelve al centro (1x). */
  resetViewSignal?: number;
}

/** Lienzo: input por Pointer Events fuera del estado React, capas base+overlay. */
export function CanvasBoard({
  engine,
  brush,
  draftStore,
  draftId,
  onSaveState,
  onStrokesVersion,
  dashed = false,
  mode = "draw",
  resetViewSignal = 0,
  onZoom,
}: CanvasBoardProps): React.JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  // Zoom de vista (pellizco / Ctrl+rueda). Las muestras van normalizadas
  // 0..1 con getBoundingClientRect (que incluye el transform), así el
  // trazo sigue mapeando exacto con cualquier escala.
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const brushRef = useRef(brush);
  brushRef.current = brush;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const callbacksRef = useRef({ onSaveState, onStrokesVersion, onZoom });
  callbacksRef.current = { onSaveState, onStrokesVersion, onZoom };
  const drawingRef = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const lastZoomRef = useRef(1);

  // Botón Centrar: vuelve al 1x en el centro.
  const lastResetRef = useRef(resetViewSignal);
  useEffect(() => {
    if (lastResetRef.current === resetViewSignal) return;
    lastResetRef.current = resetViewSignal;
    const next = { scale: 1, x: 0, y: 0 };
    viewRef.current = next;
    setView(next);
    if (lastZoomRef.current !== 1) {
      lastZoomRef.current = 1;
      callbacksRef.current.onZoom?.(1);
    }
  }, [resetViewSignal]);

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

    const toSample = (e: PointerEvent): PointerSample => {      const r = base.getBoundingClientRect();
      // Tilt del stylus 0..1 (0 = perpendicular). Ratón = 0.
      const tilt =
        e.pointerType === "mouse"
          ? 0
          : Math.min(
              1,
              Math.max(Math.abs(e.tiltX ?? 0), Math.abs(e.tiltY ?? 0)) / 60,
            );
      return {
        x: (e.clientX - r.left) / r.width,
        y: (e.clientY - r.top) / r.height,
        pressure:
          e.pointerType === "mouse" ? 0.6 : e.pressure > 0 ? e.pressure : 0.5,
        tilt,
      };
    };

    // Dedos activos y estado del pellizco (zoom con 2 dedos).
    const pointers = new Map<number, { x: number; y: number }>();
    const panRef: { current: { id: number; x: number; y: number } | null } = {
      current: null,
    };
    const pinchRef: {
      current: {
        dist: number;
        midX: number;
        midY: number;
        // Origen layout del wrap (sin transform) en coords cliente.
        ox: number;
        oy: number;
        scale: number;
        x: number;
        y: number;
      } | null;
    } = { current: null };

    const clampView = (v: {
      scale: number;
      x: number;
      y: number;
    }): { scale: number; x: number; y: number } => {
      const r = base.getBoundingClientRect();
      const m = Math.max(r.width, r.height) * 2;
      return {
        scale: v.scale,
        x: Math.min(m, Math.max(-m, v.x)),
        y: Math.min(m, Math.max(-m, v.y)),
      };
    };
    const applyView = (v: { scale: number; x: number; y: number }): void => {
      const next = clampView(v);
      viewRef.current = next;
      setView(next);
      if (next.scale !== lastZoomRef.current) {
        lastZoomRef.current = next.scale;
        callbacksRef.current.onZoom?.(next.scale);
      }
    };

    const onPointerDown = (e: PointerEvent): void => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // Segundo dedo: pellizco para zoom, nunca dibujo.
      if (pointers.size === 2) {
        panRef.current = null;
        if (drawingRef.current) {
          drawingRef.current = false;
          engine.cancelStroke();
        }
        const pts = [...pointers.values()];
        const a = pts[0];
        const b = pts[1];
        if (a && b) {
          const v = viewRef.current;
          // rect incluye el transform actual: el origen layout es
          // rect menos la traslación vigente.
          const r0 = wrap.getBoundingClientRect();
          pinchRef.current = {
            dist: Math.hypot(a.x - b.x, a.y - b.y),
            midX: (a.x + b.x) / 2,
            midY: (a.y + b.y) / 2,
            ox: r0.left - v.x,
            oy: r0.top - v.y,
            scale: v.scale,
            x: v.x,
            y: v.y,
          };
        }
        try {
          wrap.setPointerCapture(e.pointerId);
        } catch {
          // Sin captura: el gesto sigue por coordenadas.
        }
        e.preventDefault();
        return;
      }
      if (pointers.size > 2) {
        e.preventDefault();
        return;
      }
      // Modo Mover: un dedo mueve la vista, jamás dibuja.
      if (modeRef.current === "pan") {
        if (e.button !== 0 && e.pointerType === "mouse") return;
        e.preventDefault();
        panRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
        try {
          wrap.setPointerCapture(e.pointerId);
        } catch {
          // Sin captura: el gesto sigue por coordenadas.
        }
        return;
      }
      if (e.button !== 0 && e.pointerType === "mouse") return;
      e.preventDefault();
      try {
        wrap.setPointerCapture(e.pointerId);
      } catch {
        // Sin captura activa: nada que liberar.
      }
      drawingRef.current = true;
      engine.beginStroke(toSample(e), brushRef.current);
    };
    const onPointerMove = (e: PointerEvent): void => {
      if (pointers.has(e.pointerId)) {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      // Gesto de pellizco activo: mover la vista, no dibujar.
      const pinch = pinchRef.current;
      if (pinch && pointers.size >= 2) {
        e.preventDefault();
        const pts = [...pointers.values()];
        const a = pts[0];
        const b = pts[1];
        if (a && b && pinch.dist > 0) {
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          const midX = (a.x + b.x) / 2;
          const midY = (a.y + b.y) / 2;
          const raw = pinch.scale * (dist / pinch.dist);
          // Al volver a ~1x se encaja exacto a la vista normal.
          const scale = raw < 1.06 ? 1 : Math.min(8, raw);
          // El punto bajo el punto medio inicial se queda bajo el
          // punto medio actual (coords relativas al origen layout).
          const k = scale / pinch.scale;
          const next =
            scale === 1
              ? { scale: 1, x: 0, y: 0 }
              : {
                  scale,
                  x: midX - pinch.ox - (pinch.midX - pinch.ox - pinch.x) * k,
                  y: midY - pinch.oy - (pinch.midY - pinch.oy - pinch.y) * k,
                };
          // Limita el paneo para no perder el lienzo de vista.
          applyView(next);
        }
        return;
      }
      // Paneo con un dedo en modo Mover.
      const pan = panRef.current;
      if (pan && pan.id === e.pointerId && pointers.size === 1) {
        e.preventDefault();
        const dx = e.clientX - pan.x;
        const dy = e.clientY - pan.y;
        pan.x = e.clientX;
        pan.y = e.clientY;
        const v = viewRef.current;
        applyView({ scale: v.scale, x: v.x + dx, y: v.y + dy });
        return;
      }
      if (!drawingRef.current) return;
      e.preventDefault();
      // getCoalescedEvents() puede venir VACÍA (sin nada que coalescer):
      // el evento actual siempre cuenta, o el trazo queda en un punto.
      // Duplicados exactos consecutivos los filtra el engine.
      const coalesced =
        typeof e.getCoalescedEvents === "function"
          ? e.getCoalescedEvents()
          : [];
      engine.appendSamples([...coalesced.map(toSample), toSample(e)]);
    };
    const endStroke = (e: PointerEvent): void => {
      pointers.delete(e.pointerId);
      if (pinchRef.current && pointers.size < 2) pinchRef.current = null;
      if (panRef.current && panRef.current.id === e.pointerId) {
        panRef.current = null;
      }
      if (!drawingRef.current) return;
      drawingRef.current = false;
      try {
        wrap.releasePointerCapture(e.pointerId);
      } catch {
        // Sin captura activa: nada que liberar.
      }
      engine.endStroke();
    };

    // Rueda: con Ctrl zoom de escritorio; en modo Mover mueve la vista.
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) {
        if (modeRef.current !== "pan") return;
        e.preventDefault();
        const v = viewRef.current;
        applyView({ scale: v.scale, x: v.x - e.deltaX, y: v.y - e.deltaY });
        return;
      }
      e.preventDefault();
      const v = viewRef.current;
      const r = base.getBoundingClientRect();
      const raw = v.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15);
      const scale = raw < 1.06 ? 1 : Math.min(8, raw);
      // Zoom anclado al cursor (origen layout descontado).
      const ox = r.left - v.x;
      const oy = r.top - v.y;
      const k = scale / v.scale;
      const cx = e.clientX - ox;
      const cy = e.clientY - oy;
      const next =
        scale === 1
          ? { scale: 1, x: 0, y: 0 }
          : {
              scale,
              x: cx - (cx - v.x) * k,
              y: cy - (cy - v.y) * k,
            };
      applyView(next);
    };

    wrap.addEventListener("pointerdown", onPointerDown);
    wrap.addEventListener("pointermove", onPointerMove);
    wrap.addEventListener("pointerup", endStroke);
    wrap.addEventListener("pointercancel", endStroke);
    wrap.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelled = true;
      unsubscribe();
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      wrap.removeEventListener("pointerdown", onPointerDown);
      wrap.removeEventListener("pointermove", onPointerMove);
      wrap.removeEventListener("pointerup", endStroke);
      wrap.removeEventListener("pointercancel", endStroke);
      wrap.removeEventListener("wheel", onWheel);
    };
    // engine/draftStore/draftId estables por sesión; brush y callbacks via ref.
  }, [engine, draftStore, draftId]);

  return (
    <div className="flex justify-center">
      <div
        ref={wrapRef}
        className={
          dashed
            ? "relative touch-none overflow-hidden rounded-lg border-2 border-dashed border-muted-foreground/60 bg-white select-none"
            : "relative touch-none overflow-hidden rounded-lg border bg-white shadow select-none"
        }
        style={{
          touchAction: "none",
          transformOrigin: "0 0",
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
        }}
        aria-label="Lienzo de dibujo. Pellizca con dos dedos para zoom"
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
