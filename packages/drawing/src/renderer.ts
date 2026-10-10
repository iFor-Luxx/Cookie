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
  /** Línea fina de ancho exacto (cerdas de fibra). */
  hairline(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    w: number,
    color: string,
    alpha: number,
  ): void;
}

export interface RenderOptions {
  /** Versión del renderer para metadata de export (cambios visuales). */
  readonly rendererVersion?: number;
}

export const RENDERER_VERSION = 12 as const;

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
 * v12: solo 4 herramientas (pencil/marker/cpencil/pen). Las 10
 * eliminadas migran en parseDocument a su equivalente y el renderer
 * ya no las contempla.
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
 * Fila literal de p5.brush v1.1.4 para el rotulador (pesos
 * pre-`scaleBrushes`; verificado en `src/index.js` v.1.1.4).
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

const P5: Record<"marker", P5Row> = {
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
    target.stamp(
      c.x + nx * offP + Math.cos(dir) * offA,
      c.y + ny * offP + Math.sin(dir) * offA,
      Math.max(0.3, envW * o.radius * jr * (tooth ? 0.35 : 1)),
      tooth ? canvas.background : color,
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
  const pts = toPixels(stroke.points, canvas, stroke.size, target);
  // D2: grano con respuesta cuadrática (p5.brush `drawDefault`); el resto
  // de regímenes usan la curva lineal de arriba.
  const ptsQ = toPixels(
    stroke.points,
    canvas,
    stroke.size,
    target,
    false,
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
