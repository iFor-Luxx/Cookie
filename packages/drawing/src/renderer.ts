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
  /**
   * Sello elíptico orientado (trozos de carbón, punteado direccional).
   * `rot` en radianes, `rx`/`ry` radios en píxeles.
   */
  stampEllipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    rot: number,
    color: string,
    alpha: number,
  ): void;
  /** Línea fina de ancho exacto (técnico, cerdas de fibra, ticks). */
  hairline(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    w: number,
    color: string,
    alpha: number,
  ): void;
  /**
   * Difuminado real: arrastra pigmento YA pintado a lo largo del
   * segmento (mezcla real, no tono falso). Implementación Canvas2D:
   * copia desplazada + blur dentro del clip del trazo. En recording
   * solo se loguea (determinismo intacto).
   */
  smear(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    w: number,
    strength: number,
  ): void;
  /**
   * Banda plana de bordes rectos y extremos cuadrados (bisel: filo plano,
   * no redondo). Cuadrilátero entre anchos w0→w1.
   */
  band(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    w0: number,
    w1: number,
    color: string,
    alpha: number,
  ): void;
}

export interface RenderOptions {
  /** Versión del renderer para metadata de export (cambios visuales). */
  readonly rendererVersion?: number;
}

export const RENDERER_VERSION = 11 as const;

interface Px {
  x: number;
  y: number;
  w: number;
  /** Presión del puntero 0..1 (para densidad ligada a presión). */
  p: number;
  /** Inclinación del stylus 0..1 (0 = perpendicular; ratón = 0). */
  t: number;
}

function toPixels(
  points: readonly DrawingPoint[],
  canvas: DrawingCanvas,
  size: number,
  target: RenderTarget,
  ignorePressure = false,
  // D2: curva cuadrática para grano (p5.brush `drawDefault`), con suelo
  // alto: el lápiz real a toque leve deja marca CLARA pero con cuerpo
  // (la presión manda en densidad/oscuridad, no solo en ancho).
  // Los marcadores responden lineal.
  quad = false,
): Px[] {
  const sx = target.width / canvas.width;
  const sy = target.height / canvas.height;
  const avg = (sx + sy) / 2;
  return points.map(([x, y, pressure, tilt]) => ({
    x: x * canvas.width * sx,
    y: y * canvas.height * sy,
    w: ignorePressure
      ? Math.max(0.5, size * avg)
      : Math.max(
          0.5,
          size *
            (quad
              ? 0.45 + 0.55 * pressure * pressure
              : 0.25 + 0.75 * pressure) *
            avg,
        ),
    p: Math.min(1, Math.max(0, pressure)),
    t: Number.isFinite(tilt) ? Math.min(1, Math.max(0, tilt)) : 0,
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
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    w: (a.w + b.w) / 2,
    p: (a.p + b.p) / 2,
    t: (a.t + b.t) / 2,
  };
}

/**
 * Recetas visuales v5 (inspirado en p5.brush, receta propia): cada
 * herramienta tiene RÉGIMEN de cobertura y GEOMETRÍA de punta propios, no
 * solo parámetros distintos sobre la misma línea punteada. El grano y la
 * textura son procedurales desde la semilla (cero bytes extra) y el orden
 * de llamadas al RNG es fijo por herramienta (determinismo por seed).
 * v5: spray niebla (motas 1/60 de la nube), sharpness como concentración
 * de colocación, envolventes asimétricas, carbón denso, jitter de alfa
 * por mota y grafito polvoriento sin núcleo protagonista.
 * v6: papel físico real — el fondo asoma solo a toque leve y en mota
 * diminuta (nunca discos blancos); lifts de goma grandes y tenues en
 * carbón; bisel con cincel marcado; ticks de sombreado presentes.
 * v7: acuarela (wash + filo + granulación) y banda plana para el bisel.
 * v8: realismo por herramienta — stub horizontal con shading, chisel sin
 * presión, super brush con swell, técnico con gota, fibra con sangrado,
 * capas + burnish en lápiz, vine/compressed en carbón, tilt del stylus,
 * fade de gatillo en spray, crosshatch y blooms de backrun.
 * v9: difumino (tortillón sin tinta: lifts + tono arrastrado apagado);
 * grafito más polvoriento (más diente, filo más esponjoso, más vagueo de
 * mano); pluma con hambre de tinta en subidas leves. Nombres de
 * herramientas congelados (ver TOOL_NOTES en model.ts).
 * v10: port fiel p5.brush v1.1.4 (algoritmos+parámetros, adaptado a
 * Canvas2D determinista): medios secos SIN núcleo sólido — solo
 * estipulado con puerta de grano; presión Lorentz con aleatorios por
 * trazo; spray en disco uniforme; marker/bisel translúcidos por solape;
 * acuarela wash más fina; difumino sutil. Pluma, lápiz de color y fibra
 * se conservan intactos (sin quejas, recetas propias validadas).
 * v11: textura fotorealista sin subir caps (60fps): doble-tono por
 * mota en secos, grano de papel modulado, spray log-normal + spatter,
 * acuarela con filo irregular + floculación, carbón excéntrico con
 * polvo dual, 2H plateado con surco, hatch con 2 pesos, rotring con
 * sangrado por sellos, bisel con brillo alcohol, difumino con `smear`
 * real (arrastra píxeles ya pintados).
 */

/** Oscurece/aclara un `#rrggbb` por factor (bordes de dos tonos). */
function shade(hex: string, f: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = (s: number): number =>
    Math.min(255, Math.max(0, Math.round(((n >> s) & 255) * f)));
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}

/** Mezcla un `#rrggbb` hacia blanco en proporción f (brillo de burnish). */
function tint(hex: string, f: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = (s: number): number =>
    Math.min(
      255,
      Math.max(0, Math.round(((n >> s) & 255) + (255 - ((n >> s) & 255)) * f)),
    );
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}

/**
 * v11: doble-tono fotorealista por mota. 85% color base, 10% grano
 * oscuro (grafito denso), 5% brillo (reflejo metálico a presión).
 * Consume 1 llamada RNG al final del orden fijo por mota.
 */
function dualTone(
  rand: () => number,
  base: string,
  dark: string,
  light: string,
): string {
  const r = rand();
  if (r < 0.1) return dark;
  if (r < 0.15) return light;
  return base;
}

/**
 * v11: modulación de grano de papel (1 llamada RNG). Devuelve factor
 * 0.75..1.15 que simula valles/fibras sin textura externa.
 */
function paperGrainMod(rand: () => number): number {
  return 0.75 + rand() * 0.4;
}

/**
 * Ancho de cincel/pluma según dirección del trazo (p5.brush `rotate:
 * "natural"`): la marca respira con el giro, no con la presión.
 * `nib` en radianes; devuelve factor en [minF, minF+ampF].
 */
function chiselFactor(
  dir: number,
  nib: number,
  minF: number,
  ampF: number,
): number {
  return minF + ampF * Math.abs(Math.sin(dir - nib));
}

/**
 * Fila literal de p5.brush v1.1.4 (pesos pre-`scaleBrushes`; verificado
 * en `src/index.js` v.1.1.4). Solo medios con queja: pluma, lápiz de
 * color y fibra conservan recetas propias (sin equivalente/trouble).
 */
interface P5Row {
  readonly weight: number;
  readonly scatter: number;
  readonly sharp: number;
  readonly grain: number;
  readonly opacity: number;
  readonly spacing: number;
  readonly curve: readonly [number, number];
  readonly minmax: readonly [number, number];
}

const P5: Record<
  | "graphite"
  | "2b"
  | "2h"
  | "rotring"
  | "spray"
  | "marker"
  | "marker2"
  | "charcoal"
  | "hatch",
  P5Row
> = {
  graphite: {
    weight: 0.3,
    scatter: 0.5,
    sharp: 0.4,
    grain: 4,
    opacity: 180,
    spacing: 0.25,
    curve: [0.15, 0.2],
    minmax: [1.2, 0.9],
  },
  "2b": {
    weight: 0.35,
    scatter: 0.5,
    sharp: 0.1,
    grain: 8,
    opacity: 180,
    spacing: 0.2,
    curve: [0.15, 0.2],
    minmax: [1.3, 1],
  },
  "2h": {
    weight: 0.2,
    scatter: 0.4,
    sharp: 0.3,
    grain: 2,
    opacity: 150,
    spacing: 0.2,
    curve: [0.15, 0.2],
    minmax: [1.2, 0.9],
  },
  rotring: {
    weight: 0.2,
    scatter: 0.05,
    sharp: 1,
    grain: 3,
    opacity: 250,
    spacing: 0.15,
    curve: [0.05, 0.2],
    minmax: [1.7, 0.8],
  },
  spray: {
    weight: 0.3,
    scatter: 12,
    sharp: 15,
    grain: 40,
    opacity: 80,
    spacing: 0.65,
    curve: [0, 0.1],
    minmax: [0.15, 1.2],
  },
  marker: {
    weight: 2.5,
    scatter: 0.12,
    sharp: 1,
    grain: 1,
    opacity: 25,
    spacing: 0.4,
    curve: [0.35, 0.25],
    minmax: [1.5, 1],
  },
  marker2: {
    weight: 2.5,
    scatter: 0.12,
    sharp: 1,
    grain: 1,
    opacity: 25,
    spacing: 0.35,
    curve: [0.35, 0.25],
    minmax: [1.3, 0.95],
  },
  charcoal: {
    weight: 0.5,
    scatter: 2,
    sharp: 0.8,
    grain: 300,
    opacity: 110,
    spacing: 0.06,
    curve: [0.15, 0.2],
    minmax: [1.3, 0.8],
  },
  hatch: {
    weight: 0.2,
    scatter: 0.4,
    sharp: 0.3,
    grain: 2,
    opacity: 150,
    spacing: 0.15,
    curve: [0.5, 0.7],
    minmax: [1, 1.5],
  },
};

/**
 * Presión Lorentz de p5.brush (`gauss()` en fuente v1.1.4):
 * E(t)=1/(1+|(t−A)/(B/2)|^2C) mapeada a [min,max]. campana suave con
 * hinchazón/fade naturales; SUSTITUYE a la envolvente lineal en las
 * herramientas portadas. `a,b,cp` son aleatorios POR TRAZO derivados
 * de la semilla (orden fijo: a, b, cp) → replay determinista.
 */
interface LorentzParams {
  readonly curve: readonly [number, number];
  readonly min: number;
  readonly max: number;
  readonly a: number;
  readonly b: number;
  readonly cp: number;
}

function lorentzFor(rand: () => number, p: P5Row): LorentzParams {
  return {
    curve: p.curve,
    min: p.minmax[0],
    max: p.minmax[1],
    a: rand() * 2 - 1,
    b: 1 + rand() * 0.5,
    cp: 3 + rand() * 0.5,
  };
}

function lorentzEnvelope(t: number, l: LorentzParams): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  const A = 0.5 + l.curve[0] * l.a;
  const B = 1 - l.curve[1] * l.b;
  const half = B / 2 || 1e-6;
  const e = 1 / (1 + Math.abs((c - A) / half) ** (2 * l.cp));
  return l.min + (l.max - l.min) * Math.min(1, Math.max(0, e));
}

function lorentzAt(m: PathMetrics, d: number, l: LorentzParams): number {
  return lorentzEnvelope(m.total > 0 ? d / m.total : 0, l);
}

/**
 * R: lateral de la mina. Con el stylus inclinado el trazo se ensancha
 * (lápices y carbón pintan con el costado); a tilt 0 no cambia nada.
 */
function tiltW(tilt: number, amt: number): number {
  return 1 + Math.min(1, Math.max(0, tilt)) * amt;
}

interface PathMetrics {
  readonly total: number;
  readonly cum: number[];
  readonly avgW: number;
}

function pathMetrics(pts: Px[]): PathMetrics {
  const { total, cum } = cumulativeLengths(pts);
  const avgW = pts.reduce((s, q) => s + q.w, 0) / Math.max(1, pts.length);
  return { total, cum, avgW };
}

function envelopeAt(
  m: PathMetrics,
  d: number,
  env: readonly [number, number, number],
): number {
  return pressureEnvelope(m.total > 0 ? d / m.total : 0, env);
}

interface GrainFieldOpts {
  /** Espaciado: cada cuántos ×w sale una mota (chico=denso, grande=ralo). */
  readonly stepMul: number;
  /** Motas por paso de distancia. */
  readonly density: number;
  readonly cap: number;
  /** Radio base como factor ×w. */
  readonly radius: number;
  /** Span del jitter de radio. */
  readonly radiusJitter: number;
  readonly spread: number;
  readonly alphaMin: number;
  readonly alphaSpan: number;
  /** Probabilidad de saltar cada mota (parches secos). */
  readonly drySkip: number;
  /**
   * Diente de papel: probabilidad de mota color fondo. 0 = sin blanco
   * (tintas y marcadores nunca usan fondo).
   */
  readonly tooth: number;
  /** Probabilidad base de emisión (× presión local, D4). */
  readonly gate: number;
  /** R: ensanchado por tilt (lateral de la mina). 0 = inmune. */
  readonly tiltAmt: number;
  /**
   * S2: esponjosidad (p5.brush `sharpness` invertido). 0 = colocación
   * apretada y filo preciso; 1 = dispersión gaussiana ancha y borde
   * esponjoso. Controla la CALIDAD del filo, no el tamaño.
   */
  readonly fuzz: number;
  readonly pressure: readonly [number, number, number];
  /**
   * Port v10: envolvente Lorentz de p5.brush en vez de la lineal.
   * Presente en herramientas portadas; ausente en las conservadas.
   */
  readonly lorentz?: LorentzParams;
  /**
   * v11: textura fotorealista por mota (doble-tono + grano de papel).
   * No cambia el nº de motas ni el alfa (mismo presupuesto 60fps).
   */
  readonly texture?: boolean;
  readonly toneDark?: string;
  readonly toneLight?: string;
}

/**
 * Punteado por distancia a lo largo del recorrido.
 * D3: dispersión con sesgo perpendicular (longitudinal 0.3×, como las
 * cerdas de p5.brush). D4: la emisión se pondera por presión local
 * (toque leve = ralo). El papel asoma SOLO a toque leve (los valles se
 * cubren con presión) y en mota diminuta: nunca un disco blanco grande.
 * Orden fijo por mota: perp, long, jitter, descarte, puerta, papel,
 * alfa, diente.
 */
function grainField(
  target: RenderTarget,
  canvas: DrawingCanvas,
  wpts: Px[],
  m: PathMetrics,
  rand: () => number,
  color: string,
  strokeAlpha: number,
  o: GrainFieldOpts,
): void {
  const step = Math.max(1, m.avgW * o.stepMul);
  const byDistance = m.total > 0 ? Math.floor(m.total / step) : wpts.length;
  const grains = Math.min(
    o.cap,
    Math.max(wpts.length, Math.round(byDistance * o.density), 8),
  );
  for (let g = 0; g < grains; g++) {
    const d = m.total > 0 ? ((g + 0.5) / grains) * m.total : 0;
    const c = sampleAtDistance(wpts, m.cum, d);
    const envW =
      c.w *
      (o.lorentz ? lorentzAt(m, d, o.lorentz) : envelopeAt(m, d, o.pressure)) *
      tiltW(c.t, o.tiltAmt);
    const dir = dirAt(wpts, m.cum, d);
    const nx = -Math.sin(dir);
    const ny = Math.cos(dir);
    // S2: gaussiana aproximada con 3 llamadas (nítido↔esponjoso).
    const gauss = (rand() + rand() + rand() - 1.5) / 1.5;
    const offP = gauss * envW * o.spread * (0.35 + o.fuzz);
    const offA = (rand() * 2 - 1) * envW * o.spread * 0.3;
    const jr = 1 + rand() * o.radiusJitter;
    const skip = rand() < o.drySkip;
    // D4: puerta de presión (p5.brush `grain×pressure`).
    const gate = rand() >= Math.min(1, o.gate * (0.25 + 0.75 * c.p));
    // Papel: probabilidad inversa a la presión (a más presión, los
    // valles se cubren) y mota diminuta al 35% del radio.
    const paper = rand() < o.tooth * (1.3 - c.p);
    // S5: jitter de alfa por mota (p5.brush `rr(0.75,1.1)`).
    const alpha =
      (o.alphaMin + rand() * o.alphaSpan) *
      (0.6 + 0.4 * strokeAlpha) *
      (0.75 + rand() * 0.35);
    if (skip || gate) continue;
    const tooth = paper;
    // v11: doble-tono + grano de papel (2 llamadas fijas al final).
    let moteColor = tooth ? canvas.background : color;
    let grainMul = 1;
    if (o.texture && !tooth && o.toneDark && o.toneLight) {
      moteColor = dualTone(rand, color, o.toneDark, o.toneLight);
      grainMul = paperGrainMod(rand);
    }
    target.stamp(
      c.x + nx * offP + Math.cos(dir) * offA,
      c.y + ny * offP + Math.sin(dir) * offA,
      Math.max(0.3, envW * o.radius * jr * grainMul * (tooth ? 0.35 : 1)),
      moteColor,
      tooth ? alpha * 0.5 : alpha,
    );
  }
}

/**
 * Envolvente de presión por longitud del trazo (p5.brush `pressure`).
 * `t` en 0..1, `env` es [inicio, medio, fin] con pico en t=0.5.
 */
function pressureEnvelope(
  t: number,
  env: readonly [number, number, number],
): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c < 0.5
    ? env[0] + (env[1] - env[0]) * c * 2
    : env[1] + (env[2] - env[1]) * (c - 0.5) * 2;
}

/**
 * Variación de opacidad por trazo (p5.brush `noise`). Gaussiana aproximada
 * con 3 llamadas fijas al RNG: determinista por semilla y orden fijo.
 * Devuelve factor multiplicador en [1-noise, 1+noise].
 */
function strokeNoiseFactor(rand: () => number, amount: number): number {
  if (amount <= 0) return 1;
  const g = (rand() + rand() + rand() - 1.5) / 1.5;
  return Math.max(0, 1 + g * amount);
}

/** Longitud acumulada de la polilínea (para muestreo por distancia). */
function cumulativeLengths(pts: Px[]): { total: number; cum: number[] } {
  const cum: number[] = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (!a || !b) {
      cum.push(total);
      continue;
    }
    total += Math.hypot(b.x - a.x, b.y - a.y);
    cum.push(total);
  }
  return { total, cum };
}

/** Interpola posición+ancho a distancia `d` a lo largo de la polilínea. */
function sampleAtDistance(pts: Px[], cum: number[], d: number): Px {
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (!first || !last) return { x: 0, y: 0, w: 1, p: 0.5, t: 0 };
  if (d <= 0) return first;
  const total = cum[cum.length - 1] ?? 0;
  if (d >= total) return last;
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if ((cum[mid] ?? 0) <= d) lo = mid;
    else hi = mid;
  }
  const a = pts[lo];
  const b = pts[lo + 1];
  const c0 = cum[lo] ?? 0;
  const c1 = cum[lo + 1] ?? c0;
  if (!a || !b || c1 <= c0) return a ?? first;
  const t = (d - c0) / (c1 - c0);
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    w: a.w + (b.w - a.w) * t,
    p: a.p + (b.p - a.p) * t,
    t: a.t + (b.t - a.t) * t,
  };
}

/**
 * D5: curva de mano (p5.brush campo `hand`). Dobla la DIRECCIÓN del
 * recorrido con senos de baja frecuencia y fases de la semilla, en vez de
 * zigzaguear punto a punto. `amp` en fracción de w, `freq` en rad/px.
 * Extremos anclados. 2 llamadas fijas al RNG (fases).
 */
function handBend(
  pts: Px[],
  rand: () => number,
  amp: number,
  freq: number,
): Px[] {
  if (amp <= 0 || pts.length < 3) return pts;
  const { total, cum } = cumulativeLengths(pts);
  if (total <= 0) return pts;
  const p1 = rand() * Math.PI * 2;
  const p2 = rand() * Math.PI * 2;
  return pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return p;
    const prev = pts[i - 1];
    const next = pts[i + 1];
    if (!prev || !next) return p;
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const s = cum[i] ?? 0;
    const o =
      amp *
      p.w *
      (Math.sin(freq * s + p1) + 0.5 * Math.sin(freq * 2.7 * s + p2));
    // Normal perpendicular (-dy, dx)/len.
    return {
      x: p.x + (-dy / len) * o,
      y: p.y + (dx / len) * o,
      w: p.w,
      p: p.p,
      t: p.t,
    };
  });
}

/** Dirección del recorrido a distancia `d` (para dispersión sesgada). */
function dirAt(pts: Px[], cum: number[], d: number): number {
  const a = sampleAtDistance(pts, cum, Math.max(0, d - 1.5));
  const b = sampleAtDistance(pts, cum, d + 1.5);
  return Math.atan2(b.y - a.y, b.x - a.x);
}

export function renderStroke(
  target: RenderTarget,
  canvas: DrawingCanvas,
  stroke: Stroke,
  _opts: RenderOptions = {},
): void {
  if (stroke.points.length === 0) return;
  const ignorePressure = stroke.tool === "rotring";
  // rotring: ancho técnico constante (ignora la presión).
  const pts = toPixels(
    stroke.points,
    canvas,
    stroke.size,
    target,
    ignorePressure,
  );
  // D2: grano con respuesta cuadrática (p5.brush `drawDefault`); el resto
  // de regímenes usan la curva lineal de arriba.
  const ptsQ = toPixels(
    stroke.points,
    canvas,
    stroke.size,
    target,
    ignorePressure,
    true,
  );
  const rand = mulberry32(stroke.seed);

  // marker: ROTULADOR de punta bala (port fiel p5.brush `marker` v10).
  // Un sello sólido por paso, TRANSLÚCIDO: el cuerpo sale del SOLAPE
  // (alfa ~0.1 × solape ~8×), no de una pasada opaca. Sin bordes, sin
  // vetas, sin fugas, sin halo: el fieltro bueno es plano y jugoso.
  // Hinchazón en extremos por Lorentz [1.5,1] + bulbs concéntricos
  // solo en puntas (p5.brush `markerTip`).
  if (stroke.tool === "marker") {
    const P = P5.marker;
    const L = lorentzFor(rand, P);
    const mAlpha =
      (P.opacity / 255) *
      Math.min(1, stroke.opacity) *
      strokeNoiseFactor(rand, 0.3);
    const bent = handBend(pts, rand, 0.015, 0.08);
    const m = pathMetrics(bent);
    const step = Math.max(1.5, m.avgW * 0.12);
    const n = Math.min(
      1200,
      Math.max(8, m.total > 0 ? Math.ceil(m.total / step) : 1),
    );
    for (let s = 0; s < n; s++) {
      const d = m.total > 0 ? ((s + 0.5) / n) * m.total : 0;
      const c = sampleAtDistance(bent, m.cum, d);
      const p = lorentzAt(m, d, L);
      const r = Math.max(0.5, ((c.w * p) / 2) * (0.9 + rand() * 0.2));
      const jx = (rand() - 0.5) * c.w * 0.06;
      const jy = (rand() - 0.5) * c.w * 0.06;
      target.stamp(
        c.x + jx,
        c.y + jy,
        r,
        stroke.color,
        Math.min(1, mAlpha * Math.max(0.8, p)),
      );
    }
    // markerTip: 4 sellos concéntricos sin dispersión en cada extremo.
    const first = bent[0];
    const last = bent[bent.length - 1];
    for (const end of [first, last]) {
      if (!end) continue;
      for (let k = 1; k <= 4; k++) {
        target.stamp(
          end.x,
          end.y,
          Math.max(0.4, (end.w / 2) * (k / 4)),
          stroke.color,
          Math.min(1, mAlpha * 2),
        );
      }
    }
    return;
  }

  // pen: PLUMA de stub horizontal (grueso vertical, fino horizontal,
  // automático como un stub 1.1 de verdad) + SHADING de tinta (más
  // oscura en puntas y charcos por secado desigual) + gota al apoyar.
  // Sólida, sin blanco, sin grano.
  if (stroke.tool === "pen") {
    const NIB = 0;
    const PEN_ENV: readonly [number, number, number] = [0.5, 1.1, 0.5];
    const penAlpha = stroke.opacity * strokeNoiseFactor(rand, 0.08);
    const base = smoothedPath(handBend(pts, rand, 0.03, 0.09));
    const m = pathMetrics(pts);
    const dryPhase = rand() * Math.PI * 2;
    let acc = 0;
    for (let i = 0; i < base.length; i++) {
      const seg = base[i];
      if (!seg) continue;
      const [a, b] = seg;
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      // Hambre de tinta: en subida leve el plumín se queda seco y el
      // trazo se entrecorta (firma analógica, no vector). Solo a presión
      // baja: el trazo firme no consume RNG extra ni cambia.
      if (a.p < 0.2 && b.p < 0.2 && rand() < 0.35) {
        acc += segLen;
        continue;
      }
      const tMid = m.total > 0 ? (acc + segLen / 2) / m.total : 0;
      acc += segLen;
      const dir = Math.atan2(b.y - a.y, b.x - a.x);
      const w =
        ((a.w + b.w) / 2) *
        chiselFactor(dir, NIB, 0.35, 0.75) *
        pressureEnvelope(tMid, PEN_ENV);
      const endTaper = i === 0 || i === base.length - 1 ? 0.55 : 1;
      // Shading: la tinta se acumula en puntas y seca desigual.
      const endNear =
        m.total > 0
          ? Math.min(
              1,
              Math.min(acc, m.total - acc + segLen) / (0.12 * m.total),
            )
          : 1;
      const shadeF =
        (1.1 - 0.28 * endNear) *
        (0.92 + 0.08 * Math.sin(Math.PI * 2 * 3 * tMid + dryPhase));
      target.segment(
        a.x,
        a.y,
        b.x,
        b.y,
        w * endTaper,
        w * endTaper,
        stroke.color,
        Math.min(1, penAlpha * shadeF),
      );
    }
    // Gota al apoyar + bulbs de remate con rampa.
    const penFirst = pts[0];
    const penLast = pts[pts.length - 1];
    if (penFirst)
      target.stamp(
        penFirst.x,
        penFirst.y,
        Math.max(0.4, penFirst.w * 0.55),
        stroke.color,
        Math.min(1, penAlpha * 0.9),
      );
    for (const end of [penFirst, penLast]) {
      if (!end) continue;
      for (let k = 1; k <= 3; k++) {
        const f = k / 3;
        target.stamp(
          end.x,
          end.y,
          Math.max(0.4, end.w * 0.3 * f),
          stroke.color,
          penAlpha * 0.25,
        );
      }
    }
    return;
  }

  // rotring: TÉCNICO (port fiel p5.brush `rotring` v10). Estipulado
  // fino y denso, GRIS de tinta con grano — nunca negro sólido
  // vectorial: así deja de parecerse al rotulador. Ancho constante
  // (ignora la presión del puntero, como el rapidógrafo real); la
  // envolvente Lorentz es casi plana. Sin temblor. Gota al apoyar.
  if (stroke.tool === "rotring") {
    const P = P5.rotring;
    const L = lorentzFor(rand, P);
    const techAlpha = stroke.opacity * strokeNoiseFactor(rand, 0.3);
    const wpts = pts;
    const m = pathMetrics(wpts);
    const A = (P.opacity / 255) * techAlpha;
    grainField(target, canvas, wpts, m, rand, stroke.color, techAlpha, {
      stepMul: 0.13,
      density: 2,
      cap: 500,
      radius: 0.09,
      radiusJitter: 0.3,
      spread: 0.05,
      alphaMin: A * 0.85,
      alphaSpan: A * 0.3,
      drySkip: 0,
      tooth: 0,
      gate: Math.min(1, P.grain * 0.25),
      fuzz: 1 - P.sharp,
      tiltAmt: 0,
      pressure: [1.0, 1.0, 1.0],
      lorentz: L,
    });
    // Gota al apoyar: la aguja suelta tinta al pausar.
    const first = pts[0];
    if (first)
      target.stamp(
        first.x,
        first.y,
        Math.max(0.4, first.w * 0.62),
        stroke.color,
        Math.min(1, techAlpha),
      );
    // v11: sangrado micro en fibra del papel — sellos anchos tenues
    // (sigue siendo solo sellos: cero segmentos/hairlines).
    const bleedN = Math.min(
      60,
      Math.max(6, Math.floor(m.total / Math.max(1, m.avgW * 1.5))),
    );
    for (let s = 0; s < bleedN; s++) {
      const d = m.total > 0 ? ((s + 0.5) / bleedN) * m.total : 0;
      const c = sampleAtDistance(wpts, m.cum, d);
      target.stamp(
        c.x + (rand() - 0.5) * c.w * 0.2,
        c.y + (rand() - 0.5) * c.w * 0.2,
        Math.max(0.5, c.w * 0.9),
        stroke.color,
        Math.min(1, A * 0.06),
      );
    }
    return;
  }

  // spray: AERÓGRAFO (port fiel p5.brush `spray` v10). Nube en DISCO
  // UNIFORME por rechazo cartesiano (no concentrada al centro), motas
  // de tamaño fijo independiente de la presión e iteraciones =
  // grano/presión (capadas por rendimiento: 24/paso). Fade de gatillo
  // en extremos (aire antes y después que la pintura) + nube abierta
  // por tilt. Firma: solo sellos.
  if (stroke.tool === "spray") {
    const P = P5.spray;
    const L = lorentzFor(rand, P);
    const sprayAlpha = stroke.opacity * strokeNoiseFactor(rand, 0.3);
    const A = (P.opacity / 255) * sprayAlpha;
    const m = pathMetrics(pts);
    const step = Math.max(2, m.avgW * 0.3);
    const n = Math.min(
      500,
      Math.max(8, m.total > 0 ? Math.ceil(m.total / step) : 1),
    );
    for (let s = 0; s < n; s++) {
      const d = m.total > 0 ? ((s + 0.5) / n) * m.total : 0;
      const t = m.total > 0 ? d / m.total : 0;
      const c = sampleAtDistance(pts, m.cum, d);
      const p = lorentzAt(m, d, L);
      // Gatillo: el aire entra antes que la pintura y sale después.
      const fade = Math.min(1, Math.min(t, 1 - t) / 0.1);
      const R = Math.max(1, c.w * 2 * p * tiltW(c.t, 1.2));
      const iters = Math.min(24, Math.max(4, Math.ceil(P.grain * p)));
      for (let j = 0; j < iters; j++) {
        // Disco uniforme por rechazo cartesiano (p5 `drawSpray`) + v11:
        // caída de aire en anillo exterior, tamaño log-normal y spatter
        // escaso de boquilla (firma fotorealista, mismo nº de motas).
        const rX = (rand() * 2 - 1) * R;
        const edge = Math.sqrt(Math.max(0, R * R - rX * rX));
        const oy = (rand() * 2 - 1) * edge;
        const dist = Math.sqrt(rX * rX + oy * oy) / Math.max(1, R);
        const ringFade = 1 - 0.55 * Math.min(1, dist) * Math.min(1, dist);
        const gaussS = (rand() + rand() + rand() - 1.5) / 1.5;
        const logR = Math.exp(gaussS * 0.45);
        const spatter = j % 30 === 0 ? 2.4 : j % 8 === 0 ? 1.8 : 1;
        target.stamp(
          c.x + rX,
          c.y + oy,
          Math.max(0.3, m.avgW * 0.05 * logR * spatter),
          stroke.color,
          Math.min(
            1,
            A * (0.3 + rand() * 0.7) * (0.15 + 0.85 * fade) * ringFade,
          ),
        );
      }
    }
    return;
  }

  // marker2: BISEL de cincel plano a 70° (port fiel p5.brush `marker2`
  // v10). Micro-bandas densas y TRANSLÚCIDAS (el cuerpo sale del
  // solape, como la tinta de alcohol): el ancho lo manda la DIRECCIÓN
  // (3 anchos en uno), NUNCA la presión. Sin filos oscuros postizos;
  // solo vetas secas tenues del fieltro + bulbs de remate.
  if (stroke.tool === "marker2") {
    const CHISEL = 1.22;
    const P = P5.marker2;
    const biselAlpha =
      (P.opacity / 255) *
      Math.min(1, stroke.opacity) *
      strokeNoiseFactor(rand, 0.3);
    // Base de ancho constante: el cincel no flexa con la presión.
    const flat = toPixels(stroke.points, canvas, stroke.size, target, true);
    const bent = handBend(flat, rand, 0.02, 0.08);
    const m = pathMetrics(bent);
    const step = Math.max(1.5, m.avgW * 0.13);
    const n = Math.min(
      1200,
      Math.max(8, m.total > 0 ? Math.ceil(m.total / step) : 1),
    );
    for (let s = 0; s < n; s++) {
      const d = m.total > 0 ? ((s + 0.5) / n) * m.total : 0;
      const c = sampleAtDistance(bent, m.cum, d);
      const dir = dirAt(bent, m.cum, d);
      const f = chiselFactor(dir, CHISEL, 0.55, 0.45);
      const a = sampleAtDistance(bent, m.cum, Math.max(0, d - step / 2));
      const b = sampleAtDistance(bent, m.cum, d + step / 2);
      target.band(
        a.x,
        a.y,
        b.x,
        b.y,
        Math.max(0.5, c.w * f),
        Math.max(0.5, c.w * f),
        stroke.color,
        Math.min(1, biselAlpha),
      );
      // v11: brillo alcohol (solape translúcido, sin blanco):
      // velo claro del mismo ancho, alfa mínima — no altera el ancho.
      if (s % 3 === 0) {
        target.band(
          a.x,
          a.y,
          b.x,
          b.y,
          Math.max(0.5, c.w * f),
          Math.max(0.5, c.w * f),
          tint(stroke.color, 0.45),
          Math.min(1, biselAlpha * 0.15),
        );
      }
      // Veta seca: el fieltro firme deja rieles pálidos longitudinales.
      if (rand() < 0.3) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const o = (rand() - 0.5) * c.w * f * 0.3;
        const tw = Math.max(0.5, c.w * f * 0.08);
        target.hairline(
          a.x + nx * o,
          a.y + ny * o,
          b.x + nx * o,
          b.y + ny * o,
          tw,
          canvas.background,
          biselAlpha * 1.2,
        );
      }
    }
    const first = bent[0];
    const last = bent[bent.length - 1];
    for (const end of [first, last]) {
      if (!end) continue;
      for (let k = 1; k <= 3; k++) {
        const f = k / 3;
        target.stamp(
          end.x,
          end.y,
          Math.max(0.4, end.w * 0.42 * f),
          stroke.color,
          Math.min(1, biselAlpha * 3),
        );
      }
    }
    return;
  }

  // hatch: SOMBREADO técnico (port fiel p5.brush `hatch_brush` v10).
  // La línea guía es estipulado limpio y ralo (no un segmento tenue
  // vectorial); encima, ticks perpendiculares densos e irregulares con
  // algún cruzado: el tono sale del PATRÓN de marcas, no de opacidad.
  if (stroke.tool === "hatch") {
    const P = P5.hatch;
    const L = lorentzFor(rand, P);
    const hatchAlpha = stroke.opacity * strokeNoiseFactor(rand, 0.3);
    const wpts = handBend(pts, rand, 0.05, 0.08);
    const m = pathMetrics(wpts);
    const A = (P.opacity / 255) * hatchAlpha;
    grainField(target, canvas, wpts, m, rand, stroke.color, hatchAlpha, {
      stepMul: 0.13,
      density: 1,
      cap: 300,
      radius: 0.09,
      radiusJitter: 0.3,
      spread: 0.4,
      alphaMin: A * 0.85,
      alphaSpan: A * 0.3,
      drySkip: 0,
      tooth: 0,
      gate: Math.min(1, P.grain * 0.25),
      fuzz: 1 - P.sharp,
      tiltAmt: 0,
      pressure: [1.0, 1.0, 1.0],
      lorentz: L,
    });
    for (const [a, b] of smoothedPath(wpts)) {
      const w = (a.w + b.w) / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const tilt = (rand() - 0.5) * 0.6;
      for (let k = 0; k < 3; k++) {
        const t = rand();
        const cx = a.x + dx * t + (rand() - 0.5) * w * 0.6;
        const cy = a.y + dy * t + (rand() - 0.5) * w * 0.6;
        // Ticks presentes e irregulares (0.5–2.2w) con 2 pesos
        // (v11: 20% gruesos de acento, resto finos; taper por presión).
        const Lh = w * (0.5 + rand() * 1.7);
        // 20%: tick cruzado en segundo ángulo (crosshatch).
        const cross = rand() < 0.2;
        const accent = rand() < 0.2;
        const s = Math.sin(tilt) * (cross ? -1 : 1);
        const qx = (-dy / len) * Math.cos(tilt) - (dx / len) * s;
        const qy = (-dy / len) * s + (dx / len) * Math.cos(tilt);
        const pSeg = (a.p + b.p) / 2;
        target.hairline(
          cx - (qx * Lh) / 2,
          cy - (qy * Lh) / 2,
          cx + (qx * Lh) / 2,
          cy + (qy * Lh) / 2,
          Math.max(0.5, w * (accent ? 0.2 : 0.12) * (0.7 + 0.5 * pSeg)),
          stroke.color,
          stroke.opacity * (0.5 + rand() * 0.4),
        );
      }
    }
    return;
  }

  // smudge: DIFUMINO (v11 mezcla real). `smear` arrastra píxeles YA
  // pintados (sobre papel vacío casi no se ve: es lo correcto); el halo
  // + tono apagado + fibra se mantienen como base determinista.
  // Orden fijo de RNG por pasada (determinismo por seed).
  if (stroke.tool === "smudge") {
    const S_ENV: readonly [number, number, number] = [0.9, 1.0, 0.9];
    const dragAlpha = stroke.opacity * strokeNoiseFactor(rand, 0.25);
    // Tono arrastrado: el pigmento se apaga al mezclarse con el papel.
    const dragTone = shade(stroke.color, 0.85);
    // El fieltro vaguea más que la mina (mano alzada, sin filo).
    const wpts = handBend(ptsQ, rand, 0.25, 0.05);
    const path = smoothedPath(wpts);
    const m = pathMetrics(wpts);
    // Halo de fieltro: el tortillón es más ancho que la mina que funde.
    for (const [a, b] of path) {
      target.segment(
        a.x,
        a.y,
        b.x,
        b.y,
        a.w * 3.2,
        b.w * 3.2,
        canvas.background,
        dragAlpha * 0.045,
      );
      target.segment(
        a.x,
        a.y,
        b.x,
        b.y,
        a.w * 2.0,
        b.w * 2.0,
        canvas.background,
        dragAlpha * 0.06,
      );
    }
    // Mezcla real: arrastra lo ya pintado a lo largo del trazo.
    for (const [a, b] of path) {
      target.smear(
        a.x,
        a.y,
        b.x,
        b.y,
        ((a.w + b.w) / 2) * 2.0,
        Math.min(0.3, dragAlpha * 0.18),
      );
    }
    // Arrastre: núcleo del tono apagado, más visible donde se apretó.
    for (const [a, b] of path) {
      const pSeg = (a.p + b.p) / 2;
      target.segment(
        a.x,
        a.y,
        b.x,
        b.y,
        a.w * 1.2,
        b.w * 1.2,
        dragTone,
        Math.min(1, dragAlpha * (0.03 + 0.08 * pSeg)),
      );
    }
    // Fibra del tortillón: rieles longitudinales tenues, mitad papel.
    for (const [a, b] of path) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const w = (a.w + b.w) / 2;
      for (const s of [-0.2, 0.2]) {
        const pale = rand() < 0.5;
        target.hairline(
          a.x + nx * w * s,
          a.y + ny * w * s,
          b.x + nx * w * s,
          b.y + ny * w * s,
          Math.max(0.5, w * 0.12),
          pale ? canvas.background : dragTone,
          dragAlpha * 0.07,
        );
      }
    }
    // Esponjado: mucho papel a la vista (es difumino, no mina).
    grainField(target, canvas, wpts, m, rand, dragTone, dragAlpha, {
      stepMul: 0.35,
      density: 2,
      cap: 300,
      radius: 0.16,
      radiusJitter: 1.2,
      spread: 0.6,
      alphaMin: 0.05,
      alphaSpan: 0.07,
      drySkip: 0.1,
      tooth: 0.55,
      gate: 1.2,
      fuzz: 1.0,
      tiltAmt: 0.6,
      pressure: S_ENV,
    });
    return;
  }

  // cpencil: FIBRA de fieltro. Abanico de 6 micro-líneas paralelas con
  // jitter propio y calvas secas por cerda (no puntos): la textura son
  // líneas, no motas. Alguna cerda sale color papel (fibra gastada).
  // Halo de sangrado leve: el fieltro no es quirúrgico como el técnico.
  if (stroke.tool === "cpencil") {
    // S3: leve crecida al final, sin afinar seco.
    const FIBER_ENV: readonly [number, number, number] = [0.75, 1.1, 0.9];
    const FRACS = [-0.42, -0.25, -0.08, 0.08, 0.25, 0.42];
    const fiberAlpha = stroke.opacity * strokeNoiseFactor(rand, 0.5);
    const wpts = handBend(ptsQ, rand, 0.1, 0.07);
    const path = smoothedPath(wpts);
    const m = pathMetrics(wpts);
    // Sangrado previo: el fieltro moja el poro alrededor.
    for (const [a, b] of path) {
      target.segment(
        a.x,
        a.y,
        b.x,
        b.y,
        a.w * 1.2,
        b.w * 1.2,
        stroke.color,
        fiberAlpha * 0.08,
      );
    }
    let acc = 0;
    for (const [a, b] of path) {
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      const env = envelopeAt(m, acc + segLen / 2, FIBER_ENV);
      acc += segLen;
      const w = ((a.w + b.w) / 2) * env;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      for (const f of FRACS) {
        const j = (rand() - 0.5) * w * 0.16;
        // D4: calvas según presión local (toque leve = más ralo).
        const pSeg = (a.p + b.p) / 2;
        const skip = rand() < 0.08 + 0.35 * (1 - pSeg);
        // Fibra gastada: solo a toque leve, como el papel real.
        const worn = rand() < 0.2 * (1.2 - pSeg);
        if (skip) continue;
        const o = f * w + j;
        target.hairline(
          a.x + nx * o,
          a.y + ny * o,
          b.x + nx * o,
          b.y + ny * o,
          Math.max(0.5, w * 0.11),
          worn ? canvas.background : stroke.color,
          fiberAlpha * 0.55,
        );
      }
    }
    return;
  }

  // Familia seca de NÚCLEO + grano (graphite, pencil, 2b, 2h) y
  // carboncillo de TROZOS (chunk). Desconocido → grafito.
  // graphite: POLVO fino preciso (port fiel p5.brush `HB` v10). PURO
  // ESTIPULADO, sin línea núcleo: la cobertura sale de motas densas
  // solapadas a alfa plana; el diente de papel asoma entre motas.
  if (stroke.tool === "graphite") {
    const P = P5.graphite;
    const L = lorentzFor(rand, P);
    const alpha = stroke.opacity * strokeNoiseFactor(rand, 0.3);
    const wpts = handBend(pts, rand, 0.085, 0.07);
    const m = pathMetrics(wpts);
    const A = (P.opacity / 255) * alpha;
    grainField(target, canvas, wpts, m, rand, stroke.color, alpha, {
      stepMul: 0.22,
      density: 2,
      cap: 600,
      radius: 0.14,
      radiusJitter: 0.3,
      spread: 0.5,
      alphaMin: A * 0.85,
      alphaSpan: A * 0.3,
      drySkip: 0,
      tooth: 0.25,
      gate: Math.min(1, P.grain * 0.25),
      fuzz: 1 - P.sharp,
      tiltAmt: 0.8,
      pressure: [1.0, 1.0, 1.0],
      lorentz: L,
      texture: true,
      toneDark: shade(stroke.color, 0.55),
      toneLight: tint(stroke.color, 0.35),
    });
    return;
  }

  // pencil: LÁPIZ DE COLOR ceroso. Construcción por CAPAS (3 pasadas
  // ligeras desfasadas, como el layering real) + BORDE oscuro de dos
  // tonos + BURNISH a presión alta (rellena el diente, satura y saca
  // brillo) + diente leve. Sin discos blancos.
  if (stroke.tool === "pencil") {
    // S3: creciendo hacia el final (p5.brush cpencil [0.95,1.1]).
    const PENCIL_ENV: readonly [number, number, number] = [0.65, 1.0, 1.15];
    const alpha = stroke.opacity * strokeNoiseFactor(rand, 0.2);
    const edge = shade(stroke.color, 0.5);
    const sheen = tint(stroke.color, 0.25);
    const wpts = handBend(ptsQ, rand, 0.12, 0.07);
    const path = smoothedPath(wpts);
    const m = pathMetrics(wpts);
    let acc = 0;
    for (const [a, b] of path) {
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      const env = envelopeAt(m, acc + segLen / 2, PENCIL_ENV);
      acc += segLen;
      const tiltF = tiltW((a.t + b.t) / 2, 0.3);
      const pSeg = (a.p + b.p) / 2;
      // 3 capas ligeras desfasadas en perpendicular (build-up).
      for (let layer = 0; layer < 3; layer++) {
        const lo = (layer - 1) * 0.12;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const w = ((a.w + b.w) / 2) * env * tiltF;
        target.segment(
          a.x + (-dy / len) * w * lo,
          a.y + (dy / len) * w * lo,
          b.x + (-dy / len) * w * lo,
          b.y + (dy / len) * w * lo,
          a.w * 0.75 * env * tiltF,
          b.w * 0.75 * env * tiltF,
          stroke.color,
          Math.min(1, alpha * 0.32),
        );
      }
      // Burnish: a presión alta se rellena el diente y sale brillo.
      if (pSeg > 0.8) {
        target.segment(
          a.x,
          a.y,
          b.x,
          b.y,
          a.w * 0.6 * env * tiltF,
          b.w * 0.6 * env * tiltF,
          stroke.color,
          Math.min(1, alpha * 0.5),
        );
        target.segment(
          a.x,
          a.y,
          b.x,
          b.y,
          a.w * 0.5 * env * tiltF,
          b.w * 0.5 * env * tiltF,
          sheen,
          alpha * 0.15,
        );
      }
      const w = ((a.w + b.w) / 2) * env;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      for (const s of [-0.38, 0.38]) {
        target.hairline(
          a.x + (-dy / len) * w * s,
          a.y + (dy / len) * w * s,
          b.x + (-dy / len) * w * s,
          b.y + (dy / len) * w * s,
          Math.max(0.5, w * 0.12),
          edge,
          Math.min(1, alpha * 0.8),
        );
      }
    }
    grainField(target, canvas, wpts, m, rand, stroke.color, alpha, {
      stepMul: 0.45,
      density: 2,
      cap: 280,
      radius: 0.12,
      radiusJitter: 1.2,
      spread: 0.5,
      alphaMin: 0.16,
      alphaSpan: 0.2,
      drySkip: 0,
      tooth: 0.35,
      gate: 1.4,
      fuzz: 0.5,
      tiltAmt: 0.3,
      pressure: PENCIL_ENV,
    });
    return;
  }

  // 2b: BLANDO (port fiel p5.brush `2B` v10). Mancha gorda por
  // ESTIPULADO denso y esponjoso (definition 0.1), sin halos suaves:
  // el ahumado sale del scatter amplio, no del aerógrafo. Decrescendo
  // por Lorentz [1.3,1] (arranca grueso, termina fino).
  if (stroke.tool === "2b") {
    const P = P5["2b"];
    const L = lorentzFor(rand, P);
    const alpha = stroke.opacity * strokeNoiseFactor(rand, 0.3);
    const wpts = handBend(pts, rand, 0.12, 0.06);
    const m = pathMetrics(wpts);
    const A = (P.opacity / 255) * alpha;
    grainField(target, canvas, wpts, m, rand, stroke.color, alpha, {
      stepMul: 0.18,
      density: 3,
      cap: 700,
      radius: 0.16,
      radiusJitter: 0.3,
      spread: 0.5,
      alphaMin: A * 0.85,
      alphaSpan: A * 0.3,
      drySkip: 0,
      tooth: 0.15,
      gate: Math.min(1, P.grain * 0.25),
      fuzz: 1 - P.sharp,
      tiltAmt: 0.9,
      pressure: [1.0, 1.0, 1.0],
      lorentz: L,
      texture: true,
      toneDark: shade(stroke.color, 0.5),
      toneLight: tint(stroke.color, 0.3),
    });
    return;
  }

  // 2h: DURO de construcción (port fiel p5.brush `2H` v10). RALO y
  // tenue SIEMPRE: alfa capada a 0.5 (un H no llega a oscuro) y puerta
  // de grano al 50%: el trazo se lee punteado fino, nunca hairline
  // vectorial. Sin temblor, sin blanco: precisión de punta duradera.
  if (stroke.tool === "2h") {
    const P = P5["2h"];
    const L = lorentzFor(rand, P);
    const alpha = Math.min(0.5, stroke.opacity) * strokeNoiseFactor(rand, 0.3);
    const wpts = pts;
    const m = pathMetrics(wpts);
    const A = (P.opacity / 255) * alpha;
    grainField(target, canvas, wpts, m, rand, stroke.color, alpha, {
      stepMul: 0.18,
      density: 1,
      cap: 200,
      radius: 0.09,
      radiusJitter: 0.3,
      spread: 0.4,
      alphaMin: A * 0.85,
      alphaSpan: A * 0.3,
      drySkip: 0,
      tooth: 0,
      gate: Math.min(1, P.grain * 0.25),
      fuzz: 1 - P.sharp,
      tiltAmt: 0,
      pressure: [1.0, 1.0, 1.0],
      lorentz: L,
      texture: true,
      toneDark: shade(stroke.color, 0.7),
      toneLight: tint(stroke.color, 0.5),
    });
    // v11: brillo plateado del H duro — motas claras ralas al centro,
    // sin blancos ni hairlines (sigue siendo estipulado tenue).
    const sheen = tint(stroke.color, 0.5);
    const sheenN = Math.min(
      40,
      Math.max(6, Math.floor(m.total / Math.max(1, m.avgW * 1.2))),
    );
    for (let s = 0; s < sheenN; s++) {
      if (rand() < 0.5) continue;
      const d = m.total > 0 ? ((s + 0.5) / sheenN) * m.total : 0;
      const c = sampleAtDistance(wpts, m.cum, d);
      target.stamp(
        c.x + (rand() - 0.5) * c.w * 0.3,
        c.y + (rand() - 0.5) * c.w * 0.3,
        Math.max(0.3, c.w * 0.06),
        sheen,
        Math.min(0.3, A * 0.5),
      );
    }
    return;
  }

  // charcoal: VINE + COMPRESSED (port fiel p5.brush `charcoal` v10).
  // Estipulado DENSO puro (puerta siempre abierta), sin halos suaves:
  // lo ahumado sale del scatter amplio, no del aerógrafo. Toque leve =
  // vine (polvo amplio tenue); presión = compressed (trozos densos
  // negros mate). Trozos grandes + lifts de goma. Sin discos blancos.
  if (stroke.tool === "charcoal") {
    const P = P5.charcoal;
    const L = lorentzFor(rand, P);
    const alpha = stroke.opacity * strokeNoiseFactor(rand, 0.3);
    const wpts = handBend(pts, rand, 0.2, 0.05);
    const m = pathMetrics(wpts);
    const A = (P.opacity / 255) * alpha;
    grainField(target, canvas, wpts, m, rand, stroke.color, alpha, {
      stepMul: 0.05,
      density: 3,
      cap: 900,
      radius: 0.23,
      radiusJitter: 0.3,
      spread: 2.0,
      alphaMin: A * 0.85,
      alphaSpan: A * 0.3,
      drySkip: 0.1,
      tooth: 0.35,
      gate: Math.min(1, P.grain * 0.25),
      fuzz: 1 - P.sharp,
      tiltAmt: 1.0,
      pressure: [1.0, 1.0, 1.0],
      lorentz: L,
      texture: true,
      toneDark: shade(stroke.color, 0.5),
      toneLight: tint(stroke.color, 0.3),
    });
    // S4: grano DENSO (spacing ~0.14w como el charcoal original) con un
    // trozo grande cada ~8 motas + dispersión gaussiana + jitter de alfa.
    const step = Math.max(1, m.avgW * 0.14);
    const marks = Math.min(
      600,
      Math.max(wpts.length, Math.round((m.total / step) * 2), 8),
    );
    for (let g = 0; g < marks; g++) {
      const d = m.total > 0 ? ((g + 0.5) / marks) * m.total : 0;
      const c = sampleAtDistance(wpts, m.cum, d);
      const envW = c.w * lorentzAt(m, d, L) * tiltW(c.t, 1.0);
      const dir = dirAt(wpts, m.cum, d);
      const nx = -Math.sin(dir);
      const ny = Math.cos(dir);
      const gauss = (rand() + rand() + rand() - 1.5) / 1.5;
      const offP = gauss * envW * 0.9 * (0.35 + 0.8);
      const offA = (rand() * 2 - 1) * envW * 0.9 * 0.3;
      const skip = rand() < 0.18;
      // D4: toque leve = menos trozos.
      const gate = rand() >= Math.min(1, 1.6 * (0.25 + 0.75 * c.p));
      // Vine (leve) = polvo amplio tenue; compressed (fuerte) = denso negro.
      const vine = c.p < 0.5;
      const rMul = vine ? 1.3 : 0.9;
      const aMul = vine ? 0.6 : 1.2;
      // S5: jitter de alfa por mota.
      const a2 =
        Math.min(
          1,
          (0.22 + rand() * 0.3) * (0.6 + 0.4 * alpha) * (0.75 + rand() * 0.35),
        ) * aMul;
      if (skip || gate) continue;
      // Papel: inverso a presión y siempre mota pequeña. Los trozos
      // grandes nunca salen blancos (serían discos).
      const paper = rand() < 0.4 * (1.3 - c.p);
      const col = paper ? canvas.background : stroke.color;
      const cx = c.x + nx * offP + Math.cos(dir) * offA;
      const cy = c.y + ny * offP + Math.sin(dir) * offA;
      if (g % 8 === 7 && !paper) {
        // v11: trozo excéntrico irregular (astilla real, no óvalo limpio).
        const rx = Math.max(0.5, envW * (0.5 + rand() * 0.8) * rMul);
        const squash = 0.25 + rand() * 0.65;
        target.stampEllipse(
          cx,
          cy,
          rx,
          Math.max(0.4, rx * squash),
          rand() * Math.PI,
          col,
          Math.min(1, a2),
        );
      } else {
        target.stamp(
          cx,
          cy,
          Math.max(
            0.3,
            envW * (0.2 + rand() * 0.25) * rMul * (paper ? 0.4 : 1),
          ),
          col,
          paper ? Math.min(1, a2 * 1.2) * 0.5 : Math.min(1, a2 * 1.2),
        );
      }
    }
    // Lifts de goma de borrar: grandes, tenues, con residuo. Luz por
    // sustracción, no papel recortado: alfa ≤0.09.
    const lifts = Math.max(1, Math.floor(m.total / Math.max(1, m.avgW * 6)));
    for (let l = 0; l < lifts; l++) {
      const d = m.total > 0 ? ((l + 0.5) / lifts) * m.total : 0;
      const c = sampleAtDistance(wpts, m.cum, d);
      const envW = c.w * lorentzAt(m, d, L);
      target.stampEllipse(
        c.x + (rand() - 0.5) * envW,
        c.y + (rand() - 0.5) * envW,
        envW * (2 + rand()),
        envW * (1.2 + rand() * 0.8),
        rand() * Math.PI,
        canvas.background,
        0.05 + rand() * 0.04,
      );
    }
    return;
  }

  // watercolor: ACUARELA (wash retunado v10). Charco MUY translúcido
  // (5 pasadas anchas al 0.06: la luz es el papel entre lavados) + FILO
  // OSCURO marcado por pooling en bordes + granulación de pigmento +
  // blooms de backrun. Sin blanco: solo el papel que se deja ver.
  if (stroke.tool === "watercolor") {
    const W_ENV: readonly [number, number, number] = [0.8, 1.1, 0.9];
    const washAlpha =
      Math.min(1, stroke.opacity) * strokeNoiseFactor(rand, 0.15);
    const edge = shade(stroke.color, 0.6);
    const deep = shade(stroke.color, 0.7);
    const wpts = handBend(pts, rand, 0.15, 0.06);
    const path = smoothedPath(wpts);
    const m = pathMetrics(wpts);
    // Charco: 4 pasadas anchas muy tenues ligeramente desfasadas
    // (v11: una menos que v10 para compensar la floculación extra).
    for (let pass = 0; pass < 4; pass++) {
      let acc = 0;
      for (const [a, b] of path) {
        const segLen = Math.hypot(b.x - a.x, b.y - a.y);
        const env = envelopeAt(m, acc + segLen / 2, W_ENV);
        acc += segLen;
        const w = ((a.w + b.w) / 2) * env;
        const jx = (rand() - 0.5) * w * 0.14 * pass;
        const jy = (rand() - 0.5) * w * 0.14 * pass;
        target.segment(
          a.x + jx,
          a.y + jy,
          b.x + jx,
          b.y + jy,
          a.w * 2.0 * env,
          b.w * 2.0 * env,
          stroke.color,
          washAlpha * 0.06,
        );
      }
    }
    // Granulación: pigmento que se asienta dentro del charco, en
    // flóculos (v11: 30% con 2 satélites cercanos = fotorealista).
    const n = Math.min(
      200,
      Math.max(12, Math.floor(m.total / Math.max(1, m.avgW * 0.4))),
    );
    for (let s = 0; s < n; s++) {
      const d = m.total > 0 ? ((s + 0.5) / n) * m.total : 0;
      const c = sampleAtDistance(wpts, m.cum, d);
      const dir = dirAt(wpts, m.cum, d);
      const gauss = (rand() + rand() + rand() - 1.5) / 1.5;
      const off = gauss * c.w * 0.5;
      const dark = rand() < 0.12;
      const gx = c.x + -Math.sin(dir) * off;
      const gy = c.y + Math.cos(dir) * off;
      const grx = Math.max(0.4, c.w * (0.15 + rand() * 0.25));
      const gry = Math.max(0.3, c.w * (0.1 + rand() * 0.2));
      const grot = rand() * Math.PI;
      const gcol = dark ? deep : stroke.color;
      const galpha = washAlpha * (0.15 + rand() * 0.2) * (0.75 + rand() * 0.35);
      target.stampEllipse(gx, gy, grx, gry, grot, gcol, galpha);
      if (rand() < 0.3) {
        for (let k = 0; k < 2; k++) {
          target.stampEllipse(
            gx + (rand() - 0.5) * grx * 1.6,
            gy + (rand() - 0.5) * gry * 1.6,
            Math.max(0.3, grx * 0.45),
            Math.max(0.25, gry * 0.45),
            grot + (rand() - 0.5) * 0.6,
            gcol,
            galpha * 0.8,
          );
        }
      }
    }
    // Filo oscuro irregular: el pigmento migra a los bordes al secar
    // (v11: ancho/alfa con jitter = coffee-ring real, no línea vector).
    for (const [a, b] of path) {
      const w = (a.w + b.w) / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      for (const s of [-0.45, 0.45]) {
        const wj = 0.07 + rand() * 0.05;
        target.hairline(
          a.x + nx * w * s,
          a.y + ny * w * s,
          b.x + nx * w * s,
          b.y + ny * w * s,
          Math.max(0.5, w * wj),
          rand() < 0.25 ? deep : edge,
          Math.min(1, washAlpha * (0.6 + rand() * 0.35)),
        );
      }
    }
    // Blooms de backrun: anillo irregular oscuro + centro pálido donde
    // el agua empujó el pigmento. LA firma de la acuarela.
    const blooms = Math.max(1, Math.floor(m.total / Math.max(1, m.avgW * 7)));
    for (let b = 0; b < blooms; b++) {
      const d =
        m.total > 0 ? ((b + 0.5 + rand() * 0.5) / (blooms + 0.5)) * m.total : 0;
      const c = sampleAtDistance(wpts, m.cum, d);
      const ringR = c.w * (1.5 + rand());
      const petals = 8 + Math.floor(rand() * 7);
      for (let k = 0; k < petals; k++) {
        const ang = (k / petals) * Math.PI * 2 + rand() * 0.5;
        const rr = ringR * (0.8 + rand() * 0.4);
        target.stamp(
          c.x + Math.cos(ang) * rr,
          c.y + Math.sin(ang) * rr,
          Math.max(0.3, c.w * (0.1 + rand() * 0.15)),
          stroke.color,
          washAlpha * 0.2 * (0.75 + rand() * 0.35),
        );
      }
      target.stampEllipse(
        c.x,
        c.y,
        ringR * 0.8,
        ringR * 0.6,
        rand() * Math.PI,
        canvas.background,
        0.06 + rand() * 0.04,
      );
    }
    return;
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
