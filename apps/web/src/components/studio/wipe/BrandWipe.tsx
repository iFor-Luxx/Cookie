import { useEffect, useRef, useState } from "react";
import { WipeCanvas, type WipeCanvasHandle } from "./WipeCanvas";
import { WipeCanvas2d, type WipeCanvas2dHandle } from "./WipeCanvas2d";
import { BRAND_WIPE, easeInOutCubic, inverseEaseInOutCubic } from "./wipe-math";

/**
 * Color de superficie del tema tal cual (`oklch(...)` incluido): el
 * canvas 2D lo interpreta al asignarlo a `fillStyle`.
 */
function resolveSurfaceCss(): string {
  const css = getComputedStyle(document.documentElement)
    .getPropertyValue("--background")
    .trim();
  return css || "#ffffff";
}

/** El mismo color de superficie en rgb 0..1 para el uniforme del shader. */
function surfaceCssToRgb(css: string): [number, number, number] {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) return [1, 1, 1];
  ctx.fillStyle = "#ffffff";
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [(d[0] ?? 255) / 255, (d[1] ?? 255) / 255, (d[2] ?? 255) / 255];
}

/**
 * Transición de marca tras "Comenzar": la pantalla actual sigue visible
 * mientras se prepara el device; al estar listo se pinta el primer
 * fotograma opaco, se monta el formulario detrás (`onReveal`) y el
 * barrido Sky lo revela. Sin WebGPU —o si el device falla a mitad de
 * vuelo— el mismo barrido continúa en canvas 2D desde el progreso
 * exacto donde iba, sin parpadeo.
 */
export function BrandWipe({
  onReveal,
  onDone,
}: {
  onReveal: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const canvasRef = useRef<WipeCanvasHandle>(null);
  const canvas2dRef = useRef<WipeCanvas2dHandle>(null);
  const easedRef = useRef(0);
  // null = preparando (se ve la pantalla actual); "shader" | "dom" = barriendo.
  const [mode, setMode] = useState<"shader" | "dom" | null>(null);
  const callbacksRef = useRef({ onReveal, onDone });
  callbacksRef.current = { onReveal, onDone };

  useEffect(() => {
    let raf = 0;
    let cancelled = false;
    // Generación del bucle: solo el bucle vigente pinta; al cambiar a
    // fallback los ticks viejos se retiran sin programar más.
    let gen = 0;
    let revealed = false;
    let dom = false;
    const reveal = (): void => {
      if (!revealed) {
        revealed = true;
        callbacksRef.current.onReveal();
      }
    };
    const finish = (): void => {
      if (!cancelled) callbacksRef.current.onDone();
    };

    const startLoop = (frame: (eased: number) => void, fromEased = 0): void => {
      const myGen = ++gen;
      const t0 =
        performance.now() -
        inverseEaseInOutCubic(fromEased) * BRAND_WIPE.durationMs;
      const tick = (now: number): void => {
        if (cancelled || myGen !== gen) return;
        const t = Math.min(1, (now - t0) / BRAND_WIPE.durationMs);
        const eased = easeInOutCubic(t);
        easedRef.current = eased;
        try {
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
      reveal();
      const surfaceCss = resolveSurfaceCss();
      // Primer fotograma 2D antes del paint: sin fotograma opaco.
      canvas2dRef.current?.draw(BRAND_WIPE, easedRef.current, surfaceCss);
      startLoop(
        (eased) => canvas2dRef.current?.draw(BRAND_WIPE, eased, surfaceCss),
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
        // Primer fotograma opaco antes de mostrar nada: el cambio de
        // pantalla ocurre bajo una superficie ya pintada, sin flash.
        const surface = surfaceCssToRgb(resolveSurfaceCss());
        try {
          canvasRef.current?.draw(BRAND_WIPE, 0, surface);
        } catch {
          toDom();
          return;
        }
        setMode("shader");
        reveal();
        canvasRef.current?.watchLost(toDom);
        startLoop((eased) =>
          canvasRef.current?.draw(BRAND_WIPE, eased, surface),
        );
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
      {mode === "dom" && (
        <WipeCanvas2d ref={canvas2dRef} className="absolute inset-0" />
      )}
      {/* Un solo canvas WebGPU siempre montado: si se desmontara al
        cambiar de modo, el device se perdería y el barrido no se vería. */}
      <WipeCanvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
}
