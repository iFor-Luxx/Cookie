import { describe, expect, it } from "vitest";
import {
  BRAND_WIPE,
  easeInOutCubic,
  hexToRgb,
  inverseEaseInOutCubic,
  sweepAxis,
  wipeClipPath,
  wipeEdgeAt,
} from "./wipe-math";

describe("wipe-math", () => {
  it("easing cúbico fija extremos y mitad", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 10);
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
  });

  it("la inversa de ease-in-out reanuda el reloj", () => {
    for (const eased of [0, 0.2, 0.5, 0.8, 1]) {
      expect(easeInOutCubic(inverseEaseInOutCubic(eased))).toBeCloseTo(
        eased,
        8,
      );
    }
  });

  it("eje de barrido 315° apunta a sup-der y cubre el cuadrado", () => {
    const { dir, bias } = sweepAxis(315);
    // 315°: dx>0, dy<0 (uv con origen arriba).
    expect(dir[0]).toBeGreaterThan(0);
    expect(dir[1]).toBeLessThan(0);
    // Las esquinas caen en [0,1] a lo largo del eje.
    const at = (x: number, y: number): number => x * dir[0] + y * dir[1] + bias;
    expect(at(0, 1)).toBeCloseTo(0, 10);
    expect(at(1, 0)).toBeCloseTo(1, 10);
  });

  it("el borde empieza fuera de pantalla y termina pasado el final", () => {
    expect(wipeEdgeAt(0, BRAND_WIPE)).toBeLessThan(0);
    expect(wipeEdgeAt(1, BRAND_WIPE)).toBeGreaterThan(1);
  });

  it("clip-path cubre todo al inicio y colapsa al final", () => {
    const full = wipeClipPath(-10, 315);
    expect(full).toContain("0% 0%");
    expect(full).toContain("100% 100%");
    expect(wipeClipPath(10, 315)).toBe("polygon(0% 0%, 0% 0%, 0% 0%)");
  });

  it("hex a rgb normalizado, negro si inválido", () => {
    expect(hexToRgb("#ff0000")).toEqual([1, 0, 0]);
    expect(hexToRgb("#38bdf8")[1]).toBeCloseTo(0xbd / 255, 5);
    expect(hexToRgb("rojo")).toEqual([0, 0, 0]);
  });
});
