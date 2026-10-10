import { useEffect, useRef, useState } from "react";
import { WipeCanvas, type WipeCanvasHandle } from "./WipeCanvas";
import { WipeCanvas2d, type WipeCanvas2dHandle } from "./WipeCanvas2d";
import {
  BRAND_WIPE,
  easeInOutCubic,
  inverseEaseInOutCubic,
  sweptPolygonPoints,
  wipeEdgeAt,
  type WipeParams,
} from "./wipe-math";

/** Recorta la capa `to` a la región ya barrida (vacía al inicio). */
function applySweptClip(el: HTMLElement, eased: number, params: WipeParams): void {
  const pts = sweptPolygonPoints(wipeEdgeAt(eased, params), params.angleDeg);
  el.style.clipPath =
    pts.length < 3
      ? "polygon(0% 0%, 0% 0%, 0% 0%)"
      : `polygon(${pts.map(([x, y]) => `${x * 100}% ${y * 100}%`).join(", ")})`;
}

/**
 * Wipe verdadero entre dos pantallas, sin pantalla intermedia:
 * - debajo, la pantalla actual viva (la sigue pintando el padre);
 * - encima, la pantalla nueva recortada a lo ya barrido;
 * - arriba del todo, solo la cinta Sky (transparente en el resto).
 * Al pulsar todo se ve idéntico; el borde avanza trayendo la otra
 * pantalla detrás; al terminar se desmonta el andamiaje. El blanco
 * es imposible por construcción: nunca se pinta superficie.
 */
export function BrandWipe({
  to,
  onDone,
  params = BRAND_WIPE,
}: {
  to: React.ReactNode;
  onDone: () => void;
  params?: WipeParams;
}): React.JSX.Element {
  const canvasRef = useRef<WipeCanvasHandle>(null);
  const canvas2dRef = useRef<WipeCanvas2dHandle>(null);
  const toRef = useRef<HTMLDivElement>(null);
  const easedRef = useRef(0);
  // null = preparando (se ve la pantalla actual intacta).
  const [mode, setMode] = useState<"shader" | "dom" | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const paramsRef = useRef(params);
  paramsRef.current = params;

  useEffect(() => {
    let raf = 0;
    let cancelled = false;
    // Generación del bucle: solo el bucle vigente pinta; al cambiar a
    // fallback los ticks viejos se retiran sin programar más.
    let gen = 0;
    let dom = false;
    const finish = (): void => {
      if (!cancelled) onDoneRef.current();
    };

    const paint = (eased: number, wparams: WipeParams): void => {
      const el = toRef.current;
      if (el) applySweptClip(el, eased, wparams);
    };

    const startLoop = (
      frame: (eased: number) => void,
      fromEased = 0,
    ): void => {
      const wparams = paramsRef.current;
      const myGen = ++gen;
      const t0 =
        performance.now() -
        inverseEaseInOutCubic(fromEased) * wparams.durationMs;
      const tick = (now: number): void => {
        if (cancelled || myGen !== gen) return;
        const t = Math.min(1, (now - t0) / wparams.durationMs);
        const eased = easeInOutCubic(t);
        easedRef.current = eased;
        try {
          paint(eased, wparams);
          frame(eased);
        } catch {
          toDom();
          return;
        }
        if (t < 1) raf = requestAnimationFrame(tick);
        else finish();
      };
      raf = requestAnimationFrame(tick);
    };

    const toDom = (): void => {
      if (cancelled || dom) return;
      dom = true;
      setMode("dom");
      const wparams = paramsRef.current;
      canvas2dRef.current?.draw(wparams, easedRef.current);
      startLoop(
        (eased) => canvas2dRef.current?.draw(wparams, eased),
        easedRef.current,
      );
    };

    const run = async (): Promise<void> => {
      // Si el device tarda demasiado (GPU ocupada/colgada), se cae al
      // fallback 2D en vez de dejar la marca congelada. La promesa
      // tardía de prepare se ignora sin efectos.
      const timeout = new Promise<{ readonly type: "timeout" }>((resolve) =>
        window.setTimeout(() => resolve({ type: "timeout" }), 2000),
      );
      const winner = await Promise.race([
        canvasRef.current
          ?.prepare()
          .then((ok) => ({ type: "gpu", ok }) as const),
        timeout,
      ]);
      if (cancelled) return;
      const ok = winner?.type === "gpu" && winner.ok;
      if (ok) {
        const wparams = paramsRef.current;
        try {
          paint(0, wparams);
          canvasRef.current?.draw(wparams, 0);
        } catch {
          toDom();
          return;
        }
        setMode("shader");
        canvasRef.current?.watchLost(toDom);
        startLoop((eased) => canvasRef.current?.draw(wparams, eased));
      } else {
        toDom();
      }
    };
    void run();
    return () => {
      cancelled = true;
      gen++;
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div aria-hidden className="fixed inset-0 z-50">
      <div ref={toRef} className="absolute inset-0 overflow-hidden">
        {to}
      </div>
      {mode === "dom" ? (
        <WipeCanvas2d ref={canvas2dRef} className="absolute inset-0" />
      ) : (
        /* Un solo canvas WebGPU siempre montado: si se desmontara al
          cambiar de modo, el device se perdería. */
        <WipeCanvas ref={canvasRef} className="absolute inset-0" />
      )}
    </div>
  );
}
