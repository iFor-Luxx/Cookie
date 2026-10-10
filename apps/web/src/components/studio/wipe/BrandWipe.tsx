import { useEffect, useRef } from "react";
import { WipeCanvas, type WipeCanvasHandle } from "./WipeCanvas";
import { WipeCanvas2d, type WipeCanvas2dHandle } from "./WipeCanvas2d";
import {
  BRAND_WIPE,
  easeInOutCubic,
  inverseEaseInOutCubic,
  sweptPolygonPoints,
  type WipeParams,
  wipeEdgeAt,
} from "./wipe-math";

/** Recorta la capa `to` a la región ya barrida (vacía al inicio). */
function applySweptClip(
  el: HTMLElement,
  eased: number,
  params: WipeParams,
): void {
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
  // La pantalla actual la sigue pintando el padre; aquí solo la capa
  // `to` recortada + la cinta.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const paramsRef = useRef(params);
  paramsRef.current = params;

  useEffect(() => {
    let raf = 0;
    let cancelled = false;
    // Generación del bucle: solo el bucle vigente pinta; al cambiar de
    // modo los ticks viejos se retiran sin programar más.
    let gen = 0;
    // Modo vigente del bucle. Arranca en 2D para pintar el primer frame
    // en el mismo commit (sin esperar al device WebGPU); si la GPU
    // llega a tiempo se mejora a GPU retomando el progreso actual.
    let mode: "2d" | "gpu" = "2d";
    const finish = (): void => {
      if (!cancelled) onDoneRef.current();
    };

    const paint = (eased: number, wparams: WipeParams): void => {
      const el = toRef.current;
      if (el) applySweptClip(el, eased, wparams);
    };

    const startLoop = (frame: (eased: number) => void, fromEased = 0): void => {
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

    const toDom = (fromEased?: number): void => {
      if (cancelled) return;
      mode = "2d";
      const wparams = paramsRef.current;
      const from = fromEased ?? easedRef.current;
      try {
        canvas2dRef.current?.draw(wparams, from);
      } catch {
        // El bucle reintenta; si el 2D falla de forma persistente el
        // tick cae de nuevo aquí sin congelar la pantalla base.
      }
      startLoop((eased) => canvas2dRef.current?.draw(wparams, eased), from);
    };

    const toGpu = (): void => {
      if (cancelled || mode === "gpu") return;
      const wparams = paramsRef.current;
      try {
        paint(easedRef.current, wparams);
        canvasRef.current?.draw(wparams, easedRef.current);
      } catch {
        return;
      }
      mode = "gpu";
      canvasRef.current?.watchLost(() => {
        toDom();
      });
      startLoop(
        (eased) => canvasRef.current?.draw(wparams, eased),
        easedRef.current,
      );
    };

    // Primer frame inmediato en 2D: el overlay ya sale animando en el
    // mismo commit del clic, sin esperar al device WebGPU.
    toDom(0);

    const upgrade = async (): Promise<void> => {
      // Solo compensa cambiar a GPU si llega pronto y vamos al inicio;
      // más tarde el cambio se notaría como un salto de cinta.
      const UPGRADE_WINDOW_MS = 300;
      const UPGRADE_EASED_MAX = 0.35;
      const timeout = new Promise<{ readonly type: "timeout" }>((resolve) =>
        window.setTimeout(
          () => resolve({ type: "timeout" }),
          UPGRADE_WINDOW_MS,
        ),
      );
      let winner:
        | { readonly type: "gpu"; readonly ok: boolean }
        | { readonly type: "timeout" }
        | undefined;
      try {
        winner = await Promise.race([
          canvasRef.current
            ?.prepare()
            .then((ok) => ({ type: "gpu", ok }) as const)
            .catch(() => ({ type: "gpu", ok: false }) as const) ??
            Promise.resolve({ type: "gpu", ok: false } as const),
          timeout,
        ]);
      } catch {
        return;
      }
      if (cancelled || mode !== "2d") return;
      const ok = winner?.type === "gpu" && winner.ok;
      // La promesa tardía de prepare se ignora: seguir en 2D evita el
      // salto visual a mitad del barrido.
      if (ok && easedRef.current <= UPGRADE_EASED_MAX) toGpu();
    };
    void upgrade();
    return () => {
      cancelled = true;
      gen++;
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div aria-hidden className="fixed inset-0 z-50">
      <div
        ref={(el) => {
          toRef.current = el;
          // Colapsada desde el commit: el primer paint ya sale oculta.
          if (el) el.style.clipPath = "polygon(0% 0%, 0% 0%, 0% 0%)";
        }}
        className="absolute inset-0 overflow-hidden"
      >
        {to}
      </div>
      {/* Ambos canvas siempre montados: el fallback de mitad de vuelo
        necesita el 2D listo, y si el WebGPU se desmontara al cambiar
        de modo el device se perdería. Sin pintar son transparentes. */}
      <WipeCanvas2d ref={canvas2dRef} className="absolute inset-0" />
      <WipeCanvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
}
