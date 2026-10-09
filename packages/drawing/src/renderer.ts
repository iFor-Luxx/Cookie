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
): Px[] {
  const sx = target.width / canvas.width;
  const sy = target.height / canvas.height;
  return points.map(([x, y, pressure]) => ({
    x: x * canvas.width * sx,
    y: y * canvas.height * sy,
    w: Math.max(0.5, size * (0.25 + 0.75 * pressure) * ((sx + sy) / 2)),
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

export function renderStroke(
  target: RenderTarget,
  canvas: DrawingCanvas,
  stroke: Stroke,
  _opts: RenderOptions = {},
): void {
  if (stroke.points.length === 0) return;
  const pts = toPixels(stroke.points, canvas, stroke.size, target);
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

  // graphite: cuerpo por presión + grano determinista escaso.
  // pencil: doble pasada con jitter fibroso + cobertura parcial.
  const passes = stroke.tool === "pencil" ? 2 : 1;
  for (let p = 0; p < passes; p++) {
    for (const [a, b] of smoothedPath(pts)) {
      const pressureScale =
        0.35 + 0.65 * ((a.w + b.w) / 2 / Math.max(stroke.size, 0.5));
      target.segment(
        a.x,
        a.y,
        b.x,
        b.y,
        a.w * 0.9,
        b.w * 0.9,
        stroke.color,
        alphaFor(stroke, pressureScale) *
          (stroke.tool === "pencil" ? 0.55 : 0.9),
      );
    }
    // Grano: sellos pseudoaleatorios (seed) dentro de la banda del trazo.
    const grains = Math.min(pts.length * 3, 240);
    for (let g = 0; g < grains; g++) {
      const i = Math.floor(rand() * pts.length);
      const c = pts[i];
      if (!c) continue;
      const ang = rand() * Math.PI * 2;
      const dist = rand() * c.w * 0.45;
      const jr =
        stroke.tool === "pencil" ? 0.5 + rand() * 1.4 : 0.4 + rand() * 0.9;
      target.stamp(
        c.x + Math.cos(ang) * dist,
        c.y + Math.sin(ang) * dist,
        Math.max(0.4, c.w * 0.08 * jr),
        stroke.color,
        0.16 + rand() * 0.22,
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
