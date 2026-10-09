import * as brush from "p5.brush/standalone";
import { describe, expect, it } from "vitest";

// Superficie usada por Cookie: si una versión cambia estos exports, falla aquí.
describe("p5.brush exports usados", () => {
  it("expone las funciones del adaptador", () => {
    const fns = [
      brush.add,
      brush.set,
      brush.seed,
      brush.box,
      brush.scaleBrushes,
      brush.beginStroke,
      brush.move,
      brush.endStroke,
    ];
    expect(fns.length).toBe(8);
    for (const fn of fns) expect(typeof fn).toBe("function");
  });
});
