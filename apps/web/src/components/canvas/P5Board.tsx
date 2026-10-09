import {
  type BrushConfig,
  type DrawingEngine,
  parseDocument,
} from "@cookie/drawing";
import type { DraftStore } from "@cookie/platform-web";
import { useEffect, useRef, useState } from "react";
import {
  type PxPoint,
  p5ScaleForBacking,
  registerCookieBrushes,
  renderDocumentP5,
  supportsWebGL2,
} from "@/lib/p5brush";
import type { SaveState } from "./CanvasBoard";
import { CanvasBoard } from "./CanvasBoard";
import { attachPointerInput } from "./pointer-input";

const AUTOSAVE_DEBOUNCE_MS = 800;
const MAX_DPR = 2;
const DOC_FALLBACK_SIZE = 1024;

interface P5BoardProps {
  engine: DrawingEngine;
  brush: BrushConfig;
  draftStore: DraftStore;
  draftId: string;
  onSaveState: (s: SaveState) => void;
  onStrokesVersion: () => void;
}

/**
 * Lienzo con textura real (p5.brush, WebGL2). Sin WebGL2 o ante cualquier
 * fallo, cae al lienzo 2D sin romper nada.
 */
export function P5Board(props: P5BoardProps): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  if (failed) return <CanvasBoard {...props} />;
  return <P5BoardInner {...props} onFail={() => setFailed(true)} />;
}

function P5BoardInner({
  engine,
  brush,
  draftStore,
  draftId,
  onSaveState,
  onStrokesVersion,
  onFail,
}: P5BoardProps & { onFail: () => void }): React.JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const brushRef = useRef(brush);
  brushRef.current = brush;
  const callbacksRef = useRef({ onSaveState, onStrokesVersion });
  callbacksRef.current = { onSaveState, onStrokesVersion };
  const onFailRef = useRef(onFail);
  onFailRef.current = onFail;
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const host = hostRef.current;
    if (!wrap || !host) return;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let detachPointer: (() => void) | null = null;
    let gl: HTMLCanvasElement | null = null;

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

    void (async () => {
      try {
        if (!supportsWebGL2()) throw new Error("sin webgl2");
        // Chunk diferido: sin WebGL2 ni se descarga p5.brush.
        const mod = await import("p5.brush/standalone");
        if (cancelled) return;
        const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        const rect = wrap.getBoundingClientRect();
        const cssSize = Math.min(rect.width, 640);
        const backing = Math.max(1, Math.round(cssSize * dpr));
        const scale = p5ScaleForBacking(backing);
        const el = document.createElement("canvas");
        el.width = backing;
        el.height = backing;
        el.style.width = `${cssSize}px`;
        el.style.height = `${cssSize}px`;
        el.style.display = "block";
        host.appendChild(el);
        gl = el;
        mod.load(el);

        const draw = (): void => {
          if (cancelled || !gl) return;
          // Reafirmar objetivo y escala en cada dibujo: otra vista (preview)
          // usa el mismo singleton global, y scaleBrushes acumula si no hay
          // register fresco previo. Ver disciplina en p5brush.ts.
          mod.load(gl);
          registerCookieBrushes(mod);
          mod.scaleBrushes(scale);
          const view = engine.exportDocument();
          const docW = view.canvas.width || DOC_FALLBACK_SIZE;
          const k = backing / docW;
          const toPx = (x: number, y: number): PxPoint => ({
            x: x * backing,
            y: y * backing,
          });
          const strokes = view.strokes.map((s) => ({ ...s, size: s.size * k }));
          const peek = engine.peekActive();
          const active =
            peek && peek.points.length > 0
              ? [
                  {
                    tool: brushRef.current.tool,
                    color: brushRef.current.color,
                    size: brushRef.current.size * k,
                    seed: peek.seed,
                    points: [...peek.points],
                  },
                ]
              : [];
          renderDocumentP5(
            mod,
            { canvas: view.canvas, strokes: [...strokes, ...active] },
            toPx,
            scale,
          );
        };

        try {
          const raw = await draftStore.loadDraft(draftId);
          if (!cancelled && raw) engine.loadDocument(parseDocument(raw));
        } catch {
          // Borrador corrupto: empezar en blanco.
        }
        if (cancelled) return;
        unsubscribe = engine.subscribe((e) => {
          draw();
          if (e === "strokes") {
            scheduleSave();
            callbacksRef.current.onStrokesVersion();
          }
        });
        detachPointer = attachPointerInput(
          wrap,
          engine,
          () => brushRef.current,
          el,
        );
        draw();
      } catch {
        if (!cancelled) onFailRef.current();
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
      detachPointer?.();
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      gl?.remove();
      gl = null;
    };
    // engine/draftStore/draftId estables por sesión; resto via ref.
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
        <div ref={hostRef} />
      </div>
    </div>
  );
}
