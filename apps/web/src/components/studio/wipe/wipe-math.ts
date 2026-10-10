// Matemáticas puras del barrido de marca (sin DOM): eje de barrido,
// borde animado, polígono de clip para el fallback DOM y utilidades.

export interface WipeParams {
  /** Dirección en grados, uv con origen arriba: 0 = izq→der, 315 = inf-izq→sup-der. */
  angleDeg: number;
  /** Duración del barrido completo. */
  durationMs: number;
  /** Ancho de la cinta de gradiente tras el borde, en unidades de barrido. */
  band: number;
  /** Fracción de la cinta que sangra hacia la superficie. */
  bleed: number;
  /** Hasta dónde pasado el borde el alfa llega a cero. */
  feather: number;
  /** Cuánto dobla el ruido el borde recto. */
  turbulence: number;
  /** Frecuencia de esa doblez. */
  noiseScale: number;
  /** Cuánto un segundo campo de ruido mezcla los colores de la cinta. */
  swirl: number;
  /** Tamaño de celda del grano, en píxeles de dispositivo. */
  grainSize: number;
  /** Intensidad del grano. 0 lo apaga. */
  grainAmount: number;
  /** Paradas de la cinta `#rrggbb`, del borde revelado hacia adentro. */
  colors: readonly [string, string, string, string];
}

/** Rampa Sky + barrido 315° en ~1.1s (valores de la referencia). */
export const BRAND_WIPE: WipeParams = {
  angleDeg: 315,
  durationMs: 1100,
  band: 0.65,
  bleed: 0.73,
  feather: 0.17,
  turbulence: 0.16,
  noiseScale: 3,
  swirl: 0.22,
  grainSize: 1.5,
  grainAmount: 0.12,
  colors: ["#6366f1", "#38bdf8", "#67e8f9", "#e0f2fe"],
};

export function easeInOutCubic(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
}

/**
 * Inversa de `easeInOutCubic`: reanudar el reloj desde un progreso dado.
 */
export function inverseEaseInOutCubic(eased: number): number {
  const c = eased < 0 ? 0 : eased > 1 ? 1 : eased;
  if (c < 0.5) return (c / 4) ** (1 / 3);
  return 1 - (2 * (1 - c)) ** (1 / 3) / 2;
}

/**
 * Eje del barrido en espacio uv: `dot(uv, dir) + bias` va de 0 a 1 al
 * cruzar el cuadrado unidad en `angleDeg`. Dividir por `|dx| + |dy|`
 * mantiene el barrido de esquina a esquina en cualquier ángulo.
 */
export function sweepAxis(angleDeg: number): {
  dir: readonly [number, number];
  bias: number;
} {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const span = Math.abs(dx) + Math.abs(dy);
  const min = Math.min(0, dx) + Math.min(0, dy);
  return { dir: [dx / span, dy / span], bias: -min / span };
}

/**
 * Posición del borde en unidades de barrido para un progreso 0..1 con
 * easing: arranca un ancho de cinta fuera de pantalla. Espejo JS del
 * `edge` del shader.
 */
export function wipeEdgeAt(progress: number, params: WipeParams): number {
  const from = -(params.band + params.turbulence);
  const to = 1 + params.turbulence + params.feather;
  return from + (to - from) * progress;
}

type Point = readonly [number, number];

/**
 * Región aún no barrida como puntos del cuadrado unidad (origen
 * arriba): el cuadrado recortado por el semiplano del barrido
 * (Sutherland–Hodgman). Base del `clip-path` DOM y del fallback 2D
 * (escalando a píxeles). Vacío si queda menos de un triángulo.
 */
export function wipePolygonPoints(
  edge: number,
  angleDeg: number,
): Array<[number, number]> {
  const { dir, bias } = sweepAxis(angleDeg);
  const depth = (p: Point): number =>
    p[0] * dir[0] + p[1] * dir[1] + bias - edge;

  const square: readonly Point[] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const kept: Array<[number, number]> = [];
  for (let i = 0; i < square.length; i++) {
    const a = square[i];
    const b = square[(i + 1) % square.length];
    if (!a || !b) continue;
    const da = depth(a);
    const db = depth(b);
    if (da >= 0) kept.push([a[0], a[1]]);
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db);
      kept.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return kept.length < 3 ? [] : kept;
}

/**
 * Región aún no barrida como polígono `clip-path` CSS.
 */
export function wipeClipPath(edge: number, angleDeg: number): string {
  const kept = wipePolygonPoints(edge, angleDeg);
  if (kept.length < 3) return "polygon(0% 0%, 0% 0%, 0% 0%)";

  const pct = (v: number): string => `${Math.round(v * 1000) / 10}%`;
  return `polygon(${kept.map(([x, y]) => `${pct(x)} ${pct(y)}`).join(", ")})`;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** `#rrggbb` a sRGB normalizado. Negro si no parsea. */
export function hexToRgb(hex: string): [number, number, number] {
  if (!HEX.test(hex)) return [0, 0, 0];
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
