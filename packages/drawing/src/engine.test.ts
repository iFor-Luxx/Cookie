import { describe, expect, it } from "vitest";
import { createDrawingEngine } from "./engine";
import { DEFAULT_BRUSHES } from "./model";

const ids = (() => {
  let n = 0;
  return {
    newStrokeId: () => `stroke-${++n}`,
    newSeed: () => 1000 + n,
  };
})();

const pt = (x: number, y: number, pressure = 0.5) => ({
  x,
  y,
  pressure,
  tilt: 0,
});

describe("DrawingEngine", () => {
  it("trazo básico: begin/append/end exporta 1 stroke", () => {
    const engine = createDrawingEngine(
      { width: 512, height: 512, background: "#FFFFFF" },
      ids,
    );
    engine.beginStroke(pt(0.1, 0.1), DEFAULT_BRUSHES.marker);
    engine.appendSamples([pt(0.2, 0.2), pt(0.2, 0.2), pt(0.3, 0.3)]);
    const id = engine.endStroke();
    expect(id).toBeTypeOf("string");
    const doc = engine.exportDocument();
    expect(doc.strokes).toHaveLength(1);
    expect(doc.strokes[0]?.points).toHaveLength(3); // duplicado exacto descartado
    expect(doc.strokes[0]?.seed).toBeTypeOf("number");
    engine.dispose();
  });

  it("undo/redo como acciones y redo se limpia con trazo nuevo", () => {
    const engine = createDrawingEngine(
      { width: 64, height: 64, background: "#FFFFFF" },
      ids,
    );
    expect(engine.undo()).toBe(false);
    engine.beginStroke(pt(0, 0), DEFAULT_BRUSHES.marker);
    engine.endStroke();
    engine.beginStroke(pt(1, 1), DEFAULT_BRUSHES.marker);
    engine.endStroke();
    expect(engine.exportDocument().strokes).toHaveLength(2);
    expect(engine.undo()).toBe(true);
    expect(engine.exportDocument().strokes).toHaveLength(1);
    expect(engine.redo()).toBe(true);
    expect(engine.exportDocument().strokes).toHaveLength(2);
    engine.undo();
    engine.beginStroke(pt(0.5, 0.5), DEFAULT_BRUSHES.pencil);
    engine.endStroke();
    expect(engine.canRedo()).toBe(false);
    engine.dispose();
  });

  it("acota puntos y normaliza presión inválida", () => {
    const engine = createDrawingEngine(
      { width: 64, height: 64, background: "#FFFFFF" },
      ids,
    );
    engine.beginStroke(
      { x: 0, y: 0, pressure: Number.NaN, tilt: 0 },
      DEFAULT_BRUSHES.pencil,
    );
    const many = Array.from({ length: 5000 }, (_, i) => pt(i / 5000, 0.5));
    engine.appendSamples(many);
    engine.endStroke();
    const stroke = engine.exportDocument().strokes[0];
    expect(stroke?.points.length).toBeLessThanOrEqual(4096);
    expect(stroke?.points[0]?.[2]).toBe(0.5);
    engine.dispose();
  });

  it("loadDocument restaura y exporta roundtrip", () => {
    const a = createDrawingEngine(
      { width: 128, height: 128, background: "#FFFFFF" },
      ids,
    );
    a.beginStroke(pt(0.1, 0.9), DEFAULT_BRUSHES.pencil);
    a.endStroke();
    const doc = a.exportDocument();
    const b = createDrawingEngine(
      { width: 128, height: 128, background: "#FFFFFF" },
      ids,
    );
    b.loadDocument(JSON.parse(JSON.stringify(doc)));
    expect(b.exportDocument()).toEqual(doc);
    a.dispose();
    b.dispose();
  });
});
