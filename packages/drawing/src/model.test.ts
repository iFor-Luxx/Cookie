import { describe, expect, it } from "vitest";
import {
  createBlankDocument,
  DEFAULT_BRUSHES,
  MAX_POINTS_PER_STROKE,
  parseDocument,
} from "./model";

describe("drawing model v1", () => {
  it("crea documento en blanco válido", () => {
    const doc = createBlankDocument(1024, 1024);
    expect(doc.schemaVersion).toBe(1);
    expect(doc.strokes).toEqual([]);
  });

  it("rechaza versión desconocida y geometría fuera de rango", () => {
    expect(() =>
      parseDocument({
        schemaVersion: 2,
        canvas: { width: 1, height: 1 },
        strokes: [],
      }),
    ).toThrow();
    expect(() =>
      parseDocument({
        schemaVersion: 1,
        canvas: { width: 1024, height: 1024, background: "#FFFFFF" },
        strokes: [
          {
            id: "s",
            tool: "graphite",
            color: "#333333",
            size: 3,
            opacity: 0.8,
            seed: 1,
            points: [[2, 0.5, 0.5, 0]],
          },
        ],
      }),
    ).toThrow();
  });

  it("acota puntos por trazo", () => {
    const points = Array.from({ length: MAX_POINTS_PER_STROKE + 1 }, () => [
      0.5, 0.5, 0.5, 0,
    ]);
    expect(() =>
      parseDocument({
        schemaVersion: 1,
        canvas: { width: 64, height: 64, background: "#FFFFFF" },
        strokes: [
          {
            id: "s",
            tool: "marker",
            color: "#111111",
            size: 8,
            opacity: 1,
            seed: 7,
            points,
          },
        ],
      }),
    ).toThrow();
  });

  it("roundtrip del documento es estable", () => {
    const doc = createBlankDocument(512, 512);
    const json = JSON.stringify(doc);
    expect(parseDocument(JSON.parse(json))).toEqual(doc);
  });

  it("pinceles por defecto cubren las 3 herramientas MVP", () => {
    expect(Object.keys(DEFAULT_BRUSHES).sort()).toEqual([
      "graphite",
      "marker",
      "pencil",
    ]);
  });
});
