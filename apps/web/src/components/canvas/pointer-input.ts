import type {
  BrushConfig,
  DrawingEngine,
  PointerSample,
} from "@cookie/drawing";

/**
 * Entrada por Pointer Events fuera del estado React. Compartido por el
 * lienzo 2D (CanvasBoard) y el lienzo p5 (P5Board): idéntica captura,
 * idéntico motor. Solo cambia dónde se mide y dónde se pinta.
 */
export function attachPointerInput(
  wrap: HTMLDivElement,
  engine: DrawingEngine,
  getBrush: () => BrushConfig,
  measureEl: Element,
): () => void {
  let drawing = false;

  const toSample = (e: PointerEvent): PointerSample => {
    const r = measureEl.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width,
      y: (e.clientY - r.top) / r.height,
      pressure:
        e.pointerType === "mouse" ? 0.6 : e.pressure > 0 ? e.pressure : 0.5,
      tilt: 0,
    };
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    wrap.setPointerCapture(e.pointerId);
    drawing = true;
    engine.beginStroke(toSample(e), getBrush());
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (!drawing) return;
    e.preventDefault();
    const coalesced =
      typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [e];
    engine.appendSamples(coalesced.map(toSample));
  };
  const endStroke = (e: PointerEvent): void => {
    if (!drawing) return;
    drawing = false;
    try {
      wrap.releasePointerCapture(e.pointerId);
    } catch {
      // Sin captura activa: nada que liberar.
    }
    engine.endStroke();
  };

  wrap.addEventListener("pointerdown", onPointerDown);
  wrap.addEventListener("pointermove", onPointerMove);
  wrap.addEventListener("pointerup", endStroke);
  wrap.addEventListener("pointercancel", endStroke);
  return () => {
    wrap.removeEventListener("pointerdown", onPointerDown);
    wrap.removeEventListener("pointermove", onPointerMove);
    wrap.removeEventListener("pointerup", endStroke);
    wrap.removeEventListener("pointercancel", endStroke);
  };
}
