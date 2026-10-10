import { sweepAxis, type WipeParams, wipeEdgeAt } from "./wipe-math";

export type Pt = readonly [number, number];

export interface RibbonStrip {
  /** Borde ondulado del lado revelado (de esquina a esquina). */
  readonly near: readonly Pt[];
  /** Borde del lado superficie (paralelo, una cinta más allá). */
  readonly far: readonly Pt[];
  /** Longitud en px de 1 unidad de barrido a lo largo del gradiente. */
  readonly spanPx: number;
}

const SEGMENTS = 64;

/** Hash 1D determinista → [0,1). */
export function hash1(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

function vnoise1(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash1(i) * (1 - u) + hash1(i + 1) * u;
}

/** Ruido 1D de 2 octavas, ~[0,1], determinista. */
export function fbm1(x: number): number {
  return (vnoise1(x) + 0.5 * vnoise1(x * 2.13 + 17.3)) / 1.5;
}

type Rgb = readonly [number, number, number];

function hexToRgb255(hex: string): Rgb {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? Number.parseInt(m[1] ?? "000000", 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(c: Rgb, alpha: number): string {
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

/**
 * Rampa de 4 paradas como el `rampColor` del shader: espejo JS para el
 * mármol por rebanadas del fallback 2D.
 */
export function sampleRamp(
  colors: readonly [string, string, string, string],
  t: number,
): Rgb {
  const stops = [
    hexToRgb255(colors[0] ?? "#000000"),
    hexToRgb255(colors[1] ?? "#000000"),
    hexToRgb255(colors[2] ?? "#000000"),
    hexToRgb255(colors[3] ?? "#000000"),
  ];
  const x = Math.min(1, Math.max(0, t)) * 3;
  const i = Math.min(Math.floor(x), 2);
  let f = x - i;
  f = f * f * (3 - 2 * f);
  const a = stops[i] ?? [0, 0, 0];
  const b = stops[i + 1] ?? [0, 0, 0];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

/**
 * Cinta del barrido en píxeles para un progreso con easing 0..1: el
 * borde recto se dobla con fbm 1D animado por el progreso (gesto
 * orgánico determinista, como el `bend` del shader).
 */
export function ribbonStrip(
  w: number,
  h: number,
  params: WipeParams,
  eased: number,
): RibbonStrip {
  const { dir, bias } = sweepAxis(params.angleDeg);
  // Gradiente en píxeles (uv con origen arriba = canvas 2D).
  const gx = dir[0] / Math.max(1, w);
  const gy = dir[1] / Math.max(1, h);
  const gLen = Math.hypot(gx, gy) || 1;
  const nx = gx / gLen;
  const ny = gy / gLen;
  // Tangente del borde en píxeles.
  const tx = -ny;
  const ty = nx;
  const cx = w / 2;
  const cy = h / 2;
  const dc = cx * gx + cy * gy;
  const edge = wipeEdgeAt(eased, params);
  // px por unidad de barrido a lo largo del gradiente.
  const spanPx = 1 / gLen;
  const bandPx = params.band * spanPx;
  const featherPx = params.feather * spanPx;
  // El borde revelado arranca un feather antes: el fundido del
  // gradiente lo disuelve en vez de cortarlo en seco.
  const sNear = (edge - bias - dc) / gLen - featherPx;
  const diag = Math.hypot(w, h);
  const amp = params.turbulence * Math.min(w, h) * 0.6;
  const phase = (params.angleDeg * Math.PI) / 180;
  const near: Pt[] = [];
  const far: Pt[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const u = -diag / 2 + (i / SEGMENTS) * diag;
    const px = cx + tx * u;
    const py = cy + ty * u;
    const wob = (fbm1(u * 0.02 + eased * 0.9 + phase) - 0.5) * 2 * amp;
    near.push([px + nx * (sNear + wob), py + ny * (sNear + wob)]);
    far.push([
      px + nx * (sNear + featherPx + bandPx + wob * 0.3),
      py + ny * (sNear + featherPx + bandPx + wob * 0.3),
    ]);
  }
  return { near, far, spanPx };
}

/**
 * Un fotograma de la cinta en canvas 2D: franja Sky con borde de fbm
 * y mármol por rebanadas. No pinta superficie ni grano suelto: fuera
 * de la franja queda transparente y se ven las pantallas de detrás.
 */
export function drawRibbonFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  params: WipeParams,
  eased: number,
): void {
  ctx.clearRect(0, 0, w, h);

  // Cinta por rebanadas: cada una lleva su propio gradiente con las
  // paradas desplazadas por un segundo campo de ruido, de modo que
  // los colores se mezclan a lo largo (mármol, no rayas).
  const { near, far } = ribbonStrip(w, h, params, eased);
  const slices = near.length - 1;
  for (let i = 0; i < slices; i++) {
    const a = near[i];
    const b = near[i + 1];
    const c = far[i + 1];
    const d = far[i];
    if (!a || !b || !c || !d) continue;
    const uMid = (i + 0.5) / Math.max(1, slices);
    const shift =
      (fbm1(uMid * 6 + eased * 0.7 + 99.1) - 0.5) * params.swirl * 1.4;
    const at = (base: number): number =>
      Math.min(0.98, Math.max(0.02, base + shift));
    const grad = ctx.createLinearGradient(
      (a[0] + b[0]) / 2,
      (a[1] + b[1]) / 2,
      (c[0] + d[0]) / 2,
      (c[1] + d[1]) / 2,
    );
    grad.addColorStop(0, rgba(sampleRamp(params.colors, 0), 0));
    grad.addColorStop(at(0.12), rgba(sampleRamp(params.colors, at(0.12)), 1));
    grad.addColorStop(at(0.4), rgba(sampleRamp(params.colors, at(0.4)), 1));
    grad.addColorStop(at(0.68), rgba(sampleRamp(params.colors, at(0.68)), 1));
    grad.addColorStop(at(0.9), rgba(sampleRamp(params.colors, at(0.9)), 1));
    grad.addColorStop(1, rgba(sampleRamp(params.colors, 1), 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.lineTo(c[0], c[1]);
    ctx.lineTo(d[0], d[1]);
    ctx.closePath();
    ctx.fill();
  }
}
