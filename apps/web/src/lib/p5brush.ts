// Adaptador p5.brush standalone (Fase 1, H10). El motor, el JSON y el sync
// NO cambian: solo se añade un backend de render con textura real.
// - Nuestra identidad: ToolId propios (protocolo intacto, schemaVersion 1).
// - Pinceles propios vía brush.add() (no dependemos del set built-in, que
//   cambió entre versiones 2.0.x → 2.2.3). Versión pineada en package.json.
// - Determinismo: seed por trazo antes de pintar (verificado en el spike).
// - Sin WebGL2 → fallback al renderer Canvas2D (widget incluido).
import type { ToolId } from "@cookie/drawing";
import type { BrushAddParams } from "p5.brush/standalone";

/** Subconjunto mínimo usado por Cookie (inyectable: fake en tests). */
export interface P5StrokeApi {
  add(name: string, params: BrushAddParams): void;
  set(name: string, color: string, weight: number): void;
  seed(n: number): void;
  beginStroke(mode: "curve", x: number, y: number): void;
  move(angle: number, length: number, pressure: number): void;
  endStroke(angle: number, pressure: number): void;
  load(target?: HTMLCanvasElement | null): void;
  clear(color?: string): void;
  render(): void;
}

export interface CookieBrushDef {
  /** Nombre registrado vía add() (namespaced, ajeno a built-ins). */
  readonly brushName: string;
  readonly params: BrushAddParams;
}

/**
 * Tabla tool → pincel propio. Opacity = default del modelo ×255 (el slider
 * de la UI no la toca hoy; si se añade, recalibrar). noise: 0 hasta verificar
 * que va bajo seed en calibración (Fase 2). pressure: sin envolvente (la
 * presión grabada manda; revisar taper doble en calibración).
 */
export const TOOL_P5_MAP: Record<ToolId, CookieBrushDef> = {
  graphite: {
    brushName: "cookie-graphite",
    params: {
      type: "default",
      weight: 1,
      scatter: 0.15,
      sharpness: 0.5,
      grain: 8,
      opacity: 209,
      spacing: 0.15,
      rotate: "none",
      noise: 0,
    },
  },
  pencil: {
    brushName: "cookie-pencil",
    params: {
      type: "default",
      weight: 1,
      scatter: 0.25,
      sharpness: 0.4,
      grain: 6,
      opacity: 179,
      spacing: 0.12,
      rotate: "none",
      noise: 0,
    },
  },
  marker: {
    brushName: "cookie-marker",
    params: {
      type: "marker",
      weight: 1,
      scatter: 0.12,
      sharpness: 0.5,
      grain: 8,
      opacity: 140,
      spacing: 0.2,
      rotate: "none",
      noise: 0,
    },
  },
  "2b": {
    brushName: "cookie-2b",
    params: {
      type: "default",
      weight: 1,
      scatter: 0.2,
      sharpness: 0.35,
      grain: 12,
      opacity: 230,
      spacing: 0.1,
      rotate: "none",
      noise: 0,
    },
  },
  "2h": {
    brushName: "cookie-2h",
    params: {
      type: "default",
      weight: 1,
      scatter: 0.05,
      sharpness: 0.7,
      grain: 4,
      opacity: 153,
      spacing: 0.2,
      rotate: "none",
      noise: 0,
    },
  },
  cpencil: {
    brushName: "cookie-fiber",
    params: {
      type: "default",
      weight: 1,
      scatter: 0.35,
      sharpness: 0.3,
      grain: 5,
      opacity: 166,
      spacing: 0.1,
      rotate: "none",
      noise: 0,
    },
  },
  pen: {
    brushName: "cookie-pen",
    params: {
      type: "default",
      weight: 1,
      scatter: 0.02,
      sharpness: 0.8,
      grain: 2,
      opacity: 242,
      spacing: 0.1,
      rotate: "none",
      noise: 0,
    },
  },
  rotring: {
    brushName: "cookie-technical",
    params: {
      type: "default",
      weight: 1,
      scatter: 0,
      sharpness: 0.9,
      grain: 1,
      opacity: 242,
      spacing: 0.08,
      rotate: "none",
      noise: 0,
    },
  },
  spray: {
    brushName: "cookie-spray",
    params: {
      type: "spray",
      weight: 6,
      scatter: 2,
      sharpness: 0.5,
      grain: 40,
      opacity: 128,
      spacing: 0.6,
      rotate: "random",
      noise: 0,
    },
  },
  marker2: {
    brushName: "cookie-chisel",
    params: {
      type: "marker",
      weight: 1,
      scatter: 0.3,
      sharpness: 0.5,
      grain: 8,
      opacity: 128,
      spacing: 0.15,
      rotate: "natural",
      noise: 0,
    },
  },
  charcoal: {
    brushName: "cookie-charcoal",
    params: {
      type: "default",
      weight: 1,
      scatter: 0.45,
      sharpness: 0.25,
      grain: 14,
      opacity: 191,
      spacing: 0.08,
      rotate: "none",
      noise: 0,
    },
  },
  hatch: {
    brushName: "cookie-hatch",
    params: {
      type: "default",
      weight: 1,
      scatter: 0.1,
      sharpness: 0.6,
      grain: 3,
      opacity: 204,
      spacing: 0.25,
      rotate: "none",
      noise: 0,
    },
  },
};

/** Envolvente neutra: manda la presión grabada punto a punto. */
const NEUTRAL_PRESSURE: [number, number] = [1, 1];

/** Registra los 12 pinceles propios (re-registrar con mismos params es inocuo). */
export function registerCookieBrushes(api: P5StrokeApi): void {
  for (const def of Object.values(TOOL_P5_MAP)) {
    // pressure explícita y neutra: omitirla rompe el normalizador de la lib.
    api.add(def.brushName, { ...def.params, pressure: NEUTRAL_PRESSURE });
  }
}

/**
 * Escala global p5 para un backing de N px. OJO: scaleBrushes() MULTIPLICA
 * los params registrados de forma acumulativa. Disciplina obligatoria en
 * cada dibujo: register (copias frescas) → scale UNA vez → pintar.
 * Jamás scale sin register previo ni dos scale seguidos. Calibración visual
 * pendiente (dispositivo real, Fase 2): si todo se ve fino/grueso, tocar aquí.
 */
export function p5ScaleForBacking(backingPx: number): number {
  return Math.max(1, backingPx / 200);
}

/**
 * Peso p5 para un tamaño en px, dada la escala global del canvas.
 * Calibración visual pendiente (Fase 2, dispositivo real).
 */
export function p5WeightForSize(sizePx: number, scale: number): number {
  return sizePx / scale;
}

export interface PxPoint {
  readonly x: number;
  readonly y: number;
}

export interface P5FrameApi extends P5StrokeApi {
  clear(color?: string): void;
  render(): void;
}

export interface P5DocumentView {
  readonly canvas: { readonly background: string };
  readonly strokes: ReadonlyArray<P5StrokeInput>;
}

/**
 * Pinta un documento completo (comprometidos + activo como uno más).
 * La opacidad por trazo se ignora a propósito: va horneada en cada pincel
 * (la UI no la varía hoy; ver TOOL_P5_MAP).
 */
export function renderDocumentP5(
  api: P5FrameApi,
  doc: P5DocumentView,
  toPx: (x: number, y: number) => PxPoint,
  scale: number,
): void {
  api.clear(doc.canvas.background);
  for (const s of doc.strokes) renderStrokeP5(api, s, toPx, scale);
  api.render();
}

export interface StrokeMove {
  /** Radianes (el build standalone usa radianes por defecto, sin angleMode). */
  readonly angleRad: number;
  readonly length: number;
  readonly pressure: number;
}

/** Convierte puntos [x, y, pressure, tilt] a movimientos ángulo/longitud. */
export function strokeToMoves(
  points: ReadonlyArray<readonly [number, number, number, number]>,
  toPx: (x: number, y: number) => PxPoint,
): { start: PxPoint; moves: StrokeMove[]; endAngleRad: number } {
  const first = points[0];
  const p0 = first ? toPx(first[0], first[1]) : { x: 0, y: 0 };
  const moves: StrokeMove[] = [];
  let px = p0.x;
  let py = p0.y;
  let endAngleRad = 0;
  for (const q of points.slice(1)) {
    const c = toPx(q[0], q[1]);
    const dx = c.x - px;
    const dy = c.y - py;
    const angleRad = Math.atan2(dy, dx);
    moves.push({
      angleRad,
      length: Math.hypot(dx, dy),
      pressure: q[2],
    });
    endAngleRad = angleRad;
    px = c.x;
    py = c.y;
  }
  return { start: p0, moves, endAngleRad };
}

export interface P5StrokeInput {
  readonly tool: ToolId;
  readonly color: string;
  readonly size: number;
  readonly seed: number;
  readonly points: ReadonlyArray<readonly [number, number, number, number]>;
}

/** Pinta UN trazo con textura real. Determinista: misma entrada, mismas llamadas. */
export function renderStrokeP5(
  api: P5StrokeApi,
  stroke: P5StrokeInput,
  toPx: (x: number, y: number) => PxPoint,
  scale: number,
): void {
  if (stroke.points.length === 0) return;
  const def = TOOL_P5_MAP[stroke.tool];
  api.seed(stroke.seed);
  api.set(def.brushName, stroke.color, p5WeightForSize(stroke.size, scale));
  const { start, moves, endAngleRad } = strokeToMoves(stroke.points, toPx);
  api.beginStroke("curve", start.x, start.y);
  for (const m of moves) api.move(m.angleRad, m.length, m.pressure);
  const last = stroke.points[stroke.points.length - 1];
  api.endStroke(endAngleRad, last ? last[2] : 0.5);
}

let webgl2cache: boolean | null = null;

/** ¿Hay WebGL2? Sin él (o sin DOM), se usa el renderer Canvas2D. */
export function supportsWebGL2(): boolean {
  if (webgl2cache !== null) return webgl2cache;
  try {
    if (typeof document === "undefined") {
      webgl2cache = false;
      return false;
    }
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    webgl2cache = gl !== null;
    return webgl2cache;
  } catch {
    webgl2cache = false;
    return false;
  }
}
