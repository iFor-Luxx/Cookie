// @cookie/drawing — renderer contra RenderTarget abstracto (Canvas 2D en
// web; recording en tests para probar determinismo). Coordenadas en píxeles.

import type {
  DrawingCanvas,
  DrawingPoint,
  Stroke,
  VersionedDrawingDocument,
} from "./model";
import { mulberry32 } from "./rng";

export interface RenderTarget {
  readonly width: number;
  readonly height: number;
  clear(background: string): void;
  /** Segmento con ancho en cada extremo (taper por presión). */
  segment(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    w0: number,
    w1: number,
    color: string,
    alpha: number,
  ): void;
  /** Sello circular (grano/fibra). */
  stamp(x: number, y: number, r: number, color: string, alpha: number): void;
}

export interface RenderOptions {
  /** Versión del renderer para metadata de export (cambios visuales). */
  readonly rendererVersion?: number;
}

export const RENDERER_VERSION = 1 as const;

interface Px {
  x: number;
  y: number;
  w: number;
}

function toPixels(
  points: readonly DrawingPoint[],
  canvas: DrawingCanvas,
  size: number,
  target: RenderTarget,
  ignorePressure = false,
): Px[] {
  const sx = target.width / canvas.width;
  const sy = target.height / canvas.height;
  const avg = (sx + sy) / 2;
  return points.map(([x, y, pressure]) => ({
    x: x * canvas.width * sx,
    y: y * canvas.height * sy,
    w: ignorePressure
      ? Math.max(0.5, size * avg)
      : Math.max(0.5, size * (0.25 + 0.75 * pressure) * avg),
  }));
}

/** Suavizado por midpoint-quadratics evaluado en segmentos rectos. */
function smoothedPath(pts: Px[]): Array<[Px, Px]> {
  const first = pts[0];
  const second = pts[1];
  if (!first) return [];
  if (!second) return [[first, first]];
  const out: Array<[Px, Px]> = [];
  let prev = first;
  let cursor = midpoint(prev, second);
  out.push([prev, cursor]);
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (!a || !b) continue;
    cursor = midpoint(a, b);
    const lastSeg = out[out.length - 1];
    if (!lastSeg) continue;
    out.push([lastSeg[1], cursor]);
    prev = cursor;
  }
  const last = pts[pts.length - 1];
  if (last) out.push([prev, last]);
  return out;
}

function midpoint(a: Px, b: Px): Px {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, w: (a.w + b.w) / 2 };
}

function alphaFor(stroke: Stroke, pressureScale: number): number {
  return Math.min(1, stroke.opacity * pressureScale);
}

/**
 * Familia de grano (grafitos, lápices, carboncillo). Parámetros por
 * herramienta; el grano es procedural desde la semilla (cero bytes extra).
 * Inspirado en p5.brush (MIT): peso, dispersión, grano, opacidad (ver
 * llms.txt del proyecto). Receta propia, no código porteado.
 */
interface GrainParams {
  readonly passes: number;
  readonly widthFactor: number;
  readonly alphaFactor: number;
  readonly grainPerPoint: number;
  readonly grainCap: number;
  readonly spread: number;
  readonly jitterMin: number;
  readonly jitterSpan: number;
  readonly grainAlphaMin: number;
  readonly grainAlphaSpan: number;
  readonly radiusFactor: number;
}

const GRAPHITE_PARAMS: GrainParams = {
  passes: 1,
  widthFactor: 0.9,
  alphaFactor: 0.9,
  grainPerPoint: 3,
  grainCap: 240,
  spread: 0.45,
  jitterMin: 0.4,
  jitterSpan: 0.9,
  grainAlphaMin: 0.16,
  grainAlphaSpan: 0.22,
  radiusFactor: 0.08,
};

const GRAIN_TOOLS: Record<string, GrainParams> = {
  graphite: GRAPHITE_PARAMS,
  pencil: {
    passes: 2,
    widthFactor: 0.9,
    alphaFactor: 0.55,
    grainPerPoint: 3,
    grainCap: 240,
    spread: 0.45,
    jitterMin: 0.5,
    jitterSpan: 1.4,
    grainAlphaMin: 0.16,
    grainAlphaSpan: 0.22,
    radiusFactor: 0.08,
  },
  "2b": {
    passes: 1,
    widthFactor: 1.0,
    alphaFactor: 1.0,
    grainPerPoint: 5,
    grainCap: 320,
    spread: 0.55,
    jitterMin: 0.5,
    jitterSpan: 1.2,
    grainAlphaMin: 0.2,
    grainAlphaSpan: 0.25,
    radiusFactor: 0.1,
  },
  "2h": {
    passes: 1,
    widthFactor: 0.7,
    alphaFactor: 0.55,
    grainPerPoint: 1,
    grainCap: 60,
    spread: 0.35,
    jitterMin: 0.3,
    jitterSpan: 0.5,
    grainAlphaMin: 0.12,
    grainAlphaSpan: 0.15,
    radiusFactor: 0.06,
  },
  cpencil: {
    passes: 2,
    widthFactor: 0.95,
    alphaFactor: 0.7,
    grainPerPoint: 4,
    grainCap: 280,
    spread: 0.5,
    jitterMin: 0.8,
    jitterSpan: 1.8,
    grainAlphaMin: 0.14,
    grainAlphaSpan: 0.2,
    radiusFactor: 0.12,
  },
  charcoal: {
    passes: 1,
    widthFactor: 1.1,
    alphaFactor: 0.8,
    grainPerPoint: 6,
    grainCap: 400,
    spread: 0.6,
    jitterMin: 0.6,
    jitterSpan: 1.6,
    grainAlphaMin: 0.12,
    grainAlphaSpan: 0.25,
    radiusFactor: 0.1,
  },
};

function grainParamsFor(tool: string): GrainParams {
  return GRAIN_TOOLS[tool] ?? GRAPHITE_PARAMS;
}

export function renderStroke(
  target: RenderTarget,
  canvas: DrawingCanvas,
  stroke: Stroke,
  _opts: RenderOptions = {},
): void {
  if (stroke.points.length === 0) return;
  // rotring: ancho técnico constante (ignora la presión).
  const pts = toPixels(
    stroke.points,
    canvas,
    stroke.size,
    target,
    stroke.tool === "rotring",
  );
  const rand = mulberry32(stroke.seed);

  if (stroke.tool === "marker") {
    for (const [a, b] of smoothedPath(pts)) {
      target.segment(
        a.x,
        a.y,
        b.x,
        b.y,
        a.w,
        b.w,
        stroke.color,
        stroke.opacity,
      );
    }
    return;
  }

  // pen: tinta sólida uniforme (sin taper por presión ni grano).
  if (stroke.tool === "pen") {
    for (const [a, b] of smoothedPath(pts)) {
      const w = (a.w + b.w) / 2;
      target.segment(a.x, a.y, b.x, b.y, w, w, stroke.color, stroke.opacity);
    }
    return;
  }

  if (stroke.tool === "rotring") {
    for (const [a, b] of smoothedPath(pts)) {
      target.segment(
        a.x,
        a.y,
        b.x,
        b.y,
        a.w,
        b.w,
        stroke.color,
        stroke.opacity,
      );
    }
    return;
  }

  // spray: solo sellos dispersos en disco (sin cuerpo). Densidad ∝ trazo.
  if (stroke.tool === "spray") {
    const stamps = Math.min(pts.length * 6, 360);
    for (let s = 0; s < stamps; s++) {
      const i = Math.floor(rand() * pts.length);
      const c = pts[i];
      if (!c) continue;
      const ang = rand() * Math.PI * 2;
      const dist = Math.sqrt(rand()) * c.w * 1.2;
      target.stamp(
        c.x + Math.cos(ang) * dist,
        c.y + Math.sin(ang) * dist,
        Math.max(0.4, c.w * (0.06 + rand() * 0.12)),
        stroke.color,
        stroke.opacity * (0.1 + rand() * 0.3),
      );
    }
    return;
  }

  // marker2: bisel translúcido (dos pasadas anchas con jitter lateral).
  if (stroke.tool === "marker2") {
    for (let p = 0; p < 2; p++) {
      for (const [a, b] of smoothedPath(pts)) {
        const j = ((a.w + b.w) / 2) * 0.3;
        const jx = (rand() - 0.5) * j;
        const jy = (rand() - 0.5) * j;
        target.segment(
          a.x + jx,
          a.y + jy,
          b.x + jx,
          b.y + jy,
          a.w,
          b.w,
          stroke.color,
          stroke.opacity * 0.45,
        );
      }
    }
    return;
  }

  // hatch: línea tenue + ticks perpendiculares (sombreado técnico).
  if (stroke.tool === "hatch") {
    for (const [a, b] of smoothedPath(pts)) {
      target.segment(
        a.x,
        a.y,
        b.x,
        b.y,
        a.w * 0.5,
        b.w * 0.5,
        stroke.color,
        stroke.opacity * 0.35,
      );
      const w = (a.w + b.w) / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      for (let k = 0; k < 2; k++) {
        const t = rand();
        const cx = a.x + dx * t + (rand() - 0.5) * w * 0.4;
        const cy = a.y + dy * t + (rand() - 0.5) * w * 0.4;
        const L = w * (0.8 + rand() * 0.7);
        const tw = Math.max(0.5, w * 0.15);
        target.segment(
          cx - (nx * L) / 2,
          cy - (ny * L) / 2,
          cx + (nx * L) / 2,
          cy + (ny * L) / 2,
          tw,
          tw,
          stroke.color,
          stroke.opacity * 0.7,
        );
      }
    }
    return;
  }

  // Familia de grano (graphite, pencil, 2b, 2h, cpencil, charcoal).
  // Desconocido → grafito (compatibilidad hacia adelante).
  const p = grainParamsFor(stroke.tool);
  for (let pass = 0; pass < p.passes; pass++) {
    for (const [a, b] of smoothedPath(pts)) {
      const pressureScale =
        0.35 + 0.65 * ((a.w + b.w) / 2 / Math.max(stroke.size, 0.5));
      target.segment(
        a.x,
        a.y,
        b.x,
        b.y,
        a.w * p.widthFactor,
        b.w * p.widthFactor,
        stroke.color,
        alphaFor(stroke, pressureScale) * p.alphaFactor,
      );
    }
    // Grano: sellos pseudoaleatorios (seed) dentro de la banda del trazo.
    const grains = Math.min(pts.length * p.grainPerPoint, p.grainCap);
    for (let g = 0; g < grains; g++) {
      const i = Math.floor(rand() * pts.length);
      const c = pts[i];
      if (!c) continue;
      const ang = rand() * Math.PI * 2;
      const dist = rand() * c.w * p.spread;
      const jr = p.jitterMin + rand() * p.jitterSpan;
      target.stamp(
        c.x + Math.cos(ang) * dist,
        c.y + Math.sin(ang) * dist,
        Math.max(0.4, c.w * p.radiusFactor * jr),
        stroke.color,
        p.grainAlphaMin + rand() * p.grainAlphaSpan,
      );
    }
  }
}

export function renderDocument(
  target: RenderTarget,
  doc: VersionedDrawingDocument,
  opts: RenderOptions = {},
): void {
  target.clear(doc.canvas.background);
  for (const stroke of doc.strokes)
    renderStroke(target, doc.canvas, stroke, opts);
}
