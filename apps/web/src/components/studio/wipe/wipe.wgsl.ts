import { hexToRgb, sweepAxis, type WipeParams } from "./wipe-math";

/**
 * Barrido de marca en un solo fragment shader: borde turbulento con
 * cinta de gradiente Sky que escribe alfa premultiplicada en un canvas
 * transparente, de modo que el DOM de detrás se ve donde ya pasó.
 * La superficie es el color del tema (uniforme), no una textura.
 */

export const WIPE_WGSL = /* wgsl */ `
struct Params {
  dir: vec2f,
  bias: f32,
  progress: f32,
  band: f32,
  bleed: f32,
  feather: f32,
  turbulence: f32,
  noiseScale: f32,
  swirl: f32,
  grainSize: f32,
  grainAmount: f32,
  resolution: vec2f,
  surface: vec3f,
  _pad: f32,
  stops: array<vec4f, 4>,
}

@group(0) @binding(0) var<uniform> params: Params;

struct VSOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

// Un solo triángulo sobredimensionado: sin costura en la diagonal.
@vertex fn vs_main(@builtin(vertex_index) index: u32) -> VSOut {
  var corners = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  let p = corners[index];
  var out: VSOut;
  out.position = vec4f(p, 0.0, 1.0);
  out.uv = vec2f((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5);
  return out;
}

fn hash21(p: vec2f) -> f32 {
  var q = fract(p * vec2f(123.34, 345.45));
  q += dot(q, q + 34.345);
  return fract(q.x * q.y);
}

fn valueNoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2f(1.0, 0.0));
  let c = hash21(i + vec2f(0.0, 1.0));
  let d = hash21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(p: vec2f) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var q = p;
  for (var i = 0; i < 3; i++) {
    value += amplitude * valueNoise(q);
    q = q * 2.13 + vec2f(17.3, 9.1);
    amplitude *= 0.5;
  }
  return value / 0.875;
}

fn hashU32(value: u32) -> u32 {
  var h = value;
  h ^= h >> 16u;
  h *= 0x7feb352du;
  h ^= h >> 15u;
  h *= 0x846ca68bu;
  h ^= h >> 16u;
  return h;
}

fn grainAt(uv: vec2f) -> f32 {
  let cell = vec2u(max(
    floor(uv * params.resolution / max(params.grainSize, 1.0)),
    vec2f(0.0)
  ));
  let mixed = hashU32(cell.x ^ hashU32(cell.y * 0x9e3779b9u));
  return f32(mixed) / 4294967295.0 - 0.5;
}

// Distancia con signo al borde (turbulento), en unidades de barrido:
// negativo ya barrido, [0, band] dentro de la cinta, más allá superficie.
fn wipeDistance(uv: vec2f, progress: f32) -> f32 {
  let d = dot(uv, params.dir) + params.bias;
  let bend = fbm(uv * params.noiseScale + vec2f(progress * 0.6, -progress * 0.4)) * 2.0 - 1.0;
  let edge = mix(
    -(params.band + params.turbulence),
    1.0 + params.turbulence + params.feather,
    progress
  );
  return d - edge + bend * params.turbulence;
}

// Rampa de 4 paradas a lo largo de la cinta.
fn rampColor(t: f32) -> vec3f {
  let x = clamp(t, 0.0, 1.0) * 3.0;
  let i = min(u32(x), 2u);
  let f = smoothstep(0.0, 1.0, x - f32(i));
  return mix(params.stops[i].rgb, params.stops[i + 1u].rgb, f);
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let grain = grainAt(uv) * params.grainAmount;
  let s = wipeDistance(uv, params.progress);
  let alpha = smoothstep(0.0, params.feather, s + grain * params.feather * 2.0);
  let swirl = (fbm(uv * 2.0 + vec2f(4.7, 8.1)) - 0.5) * params.swirl;
  let bandT = clamp(s / params.band + swirl, 0.0, 1.0);
  let bandWeight = 1.0 - smoothstep(params.band * params.bleed, params.band, s);
  let ground = clamp(params.surface * (1.0 + grain * 0.25), vec3f(0.0), vec3f(1.0));
  let ribbon = clamp(rampColor(bandT) * (1.0 + grain * 0.5), vec3f(0.0), vec3f(1.0));
  let rgb = mix(ground, ribbon, bandWeight);
  return vec4f(rgb * alpha, alpha);
}
`;

/** Nº de f32 del uniforme. Sincronizado con `packParams`. */
export const UNIFORM_FLOATS = 36;

/**
 * Empaqueta los parámetros en el uniforme. Índices mantenidos a mano
 * contra el WGSL: `dir` en 0, `resolution` en 12, `surface` en 16,
 * `stops` en 20.
 */
export function packParams(
  out: Float32Array<ArrayBuffer>,
  params: WipeParams,
  progress: number,
  width: number,
  height: number,
  surface: readonly [number, number, number],
): Float32Array<ArrayBuffer> {
  const { dir, bias } = sweepAxis(params.angleDeg);

  out[0] = dir[0];
  out[1] = dir[1];
  out[2] = bias;
  out[3] = progress;
  out[4] = params.band;
  out[5] = params.bleed;
  out[6] = params.feather;
  out[7] = params.turbulence;
  out[8] = params.noiseScale;
  out[9] = params.swirl;
  out[10] = params.grainSize;
  out[11] = params.grainAmount;
  out[12] = Math.max(width, 1);
  out[13] = Math.max(height, 1);
  // 14, 15: relleno (surface necesita alineación de 16 bytes).
  out[16] = surface[0];
  out[17] = surface[1];
  out[18] = surface[2];
  // 19: relleno (stops arranca en la frontera de 16 bytes).
  for (let i = 0; i < 4; i++) {
    const [r, g, b] = hexToRgb(params.colors[i] ?? "#000000");
    out[20 + i * 4] = r;
    out[21 + i * 4] = g;
    out[22 + i * 4] = b;
    out[23 + i * 4] = 1;
  }
  return out;
}
