import { describe, expect, it, vi } from "vitest";
import { drawWipeFrame, fbm1, hash1, ribbonStrip, sampleRamp } from "./wipe-2d";
import { BRAND_WIPE, wipePolygonPoints } from "./wipe-math";

describe("wipe 2d", () => {
  it("polígono cubre el cuadrado al inicio y se vacía al final", () => {
    const full = wipePolygonPoints(-10, 315);
    expect(full.length).toBe(4);
    expect(wipePolygonPoints(10, 315)).toEqual([]);
    const mid = wipePolygonPoints(0.4, 315);
    expect(mid.length).toBeGreaterThanOrEqual(3);
  });

  it("la cinta tiene ambos bordes y se mueve con el progreso", () => {
    const a = ribbonStrip(400, 800, BRAND_WIPE, 0.2);
    const b = ribbonStrip(400, 800, BRAND_WIPE, 0.7);
    expect(a.near.length).toBeGreaterThan(10);
    expect(a.near.length).toBe(a.far.length);
    expect(a.spanPx).toBeGreaterThan(0);
    // El borde avanza en la dirección del barrido entre progresos.
    const mx = (p: readonly (readonly [number, number])[]): number =>
      p.reduce((s, q) => s + q[0], 0) / p.length;
    expect(mx(b.near)).toBeGreaterThan(mx(a.near));
  });

  it("el borde se ondula (no es una recta perfecta)", () => {
    const { near } = ribbonStrip(400, 800, BRAND_WIPE, 0.5);
    // Distancia perpendicular a la cuerda entre extremos: alguna se aparta.
    const first = near[0];
    const last = near[near.length - 1];
    if (!first || !last) throw new Error("cinta vacía");
    const dx = last[0] - first[0];
    const dy = last[1] - first[1];
    const len = Math.hypot(dx, dy) || 1;
    const dev = Math.max(
      ...near.map((p) =>
        Math.abs((p[0] - first[0]) * dy - (p[1] - first[1]) * dx),
      ),
    );
    expect(dev / len).toBeGreaterThan(0.001);
  });

  it("ruido y rampa: rango, extremos y determinismo", () => {
    for (const x of [0, 0.37, 2.5, 9.99]) {
      const v = fbm1(x);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(fbm1(x)).toBe(v);
    }
    expect(hash1(1)).toBeGreaterThanOrEqual(0);
    expect(hash1(1)).toBeLessThan(1);
    expect(sampleRamp(BRAND_WIPE.colors, 0)).toEqual([99, 102, 241]);
    expect(sampleRamp(BRAND_WIPE.colors, 1)).toEqual([224, 242, 254]);
    const a = JSON.stringify(ribbonStrip(400, 800, BRAND_WIPE, 0.5));
    const b = JSON.stringify(ribbonStrip(400, 800, BRAND_WIPE, 0.5));
    expect(a).toBe(b);
  });

  it("drawWipeFrame pinta superficie + cinta con gradiente + grano", () => {
    const stops: string[][] = [];
    const fills: string[] = [];
    const ctx = {
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(() => fills.push(`fill:${String(ctx.fillStyle).slice(0, 20)}`)),
      fillRect: vi.fn(),
      createLinearGradient: vi.fn(() => ({
        addColorStop: vi.fn((o: number, c: string) => void stops.push([`${o}`, c])),
      })),
      fillStyle: "#000000",
    };
    drawWipeFrame(
      ctx as unknown as CanvasRenderingContext2D,
      400,
      800,
      BRAND_WIPE,
      0.5,
      "#ffffff",
    );
    expect(ctx.clearRect).toHaveBeenCalledOnce();
    // 64 rebanadas con gradiente Sky de 6 paradas cada una.
    expect(ctx.createLinearGradient).toHaveBeenCalledTimes(64);
    expect(stops.length).toBe(64 * 6);
    expect(stops.some(([, c]) => c?.includes("99,102,241") ?? false)).toBe(
      true,
    );
    expect(stops.some(([, c]) => c?.includes("224,242,254") ?? false)).toBe(
      true,
    );
    // Superficie (blanca) + rebanadas + grano.
    expect(fills.length).toBeGreaterThan(64);
    expect(ctx.fillRect).not.toHaveBeenCalledTimes(0);
  });
});
