import { describe, expect, it } from "vitest";
import {
  createBlankDocument,
  DEFAULT_BRUSHES,
  MAX_POINTS_PER_STROKE,
  parseDocument,
  serializeDocument,
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
            tool: "marker",
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

  it("serializeDocument redondea y sigue siendo canónico", () => {
    const doc: Parameters<typeof serializeDocument>[0] = {
      schemaVersion: 1,
      canvas: { width: 1024, height: 1024, background: "#FFFFFF" },
      strokes: [
        {
          id: "s1",
          tool: "pencil",
          color: "#333333",
          size: 3.25,
          opacity: 0.876543,
          seed: 1,
          points: [
            [0.1234567, 0.7654321, 0.545454, 0.33333333],
            [0.5, 0.5, 1, 0],
          ],
        },
      ],
    };
    const parsed = parseDocument(JSON.parse(serializeDocument(doc)));
    const stroke = parsed.strokes[0]!;
    const firstPoint = stroke.points[0]!;
    expect(stroke.size).toBe(3.25);
    expect(stroke.opacity).toBe(0.877);
    expect(firstPoint).toEqual([0.1235, 0.7654, 0.545, 0.333]);
    // Precisión perdida ≤ 0.5px en 4096 (4 decimales normalizados).
    expect(Math.abs(0.1234567 - firstPoint[0]) * 4096).toBeLessThan(0.5);
  });

  it("pinceles por defecto cubren las 4 herramientas", () => {
    expect(Object.keys(DEFAULT_BRUSHES).sort()).toEqual([
      "cpencil",
      "marker",
      "pen",
      "pencil",
    ]);
  });

  it("migra herramientas legacy a su equivalente actual", () => {
    const doc = parseDocument({
      schemaVersion: 1,
      canvas: { width: 256, height: 256, background: "#FFFFFF" },
      strokes: [
        {
          id: "old",
          tool: "graphite",
          color: "#333333",
          size: 4,
          opacity: 0.8,
          seed: 1,
          points: [[0.2, 0.2, 0.5, 0]],
        },
        {
          id: "old2",
          tool: "spray",
          color: "#333333",
          size: 8,
          opacity: 0.5,
          seed: 2,
          points: [[0.5, 0.5, 0.5, 0]],
        },
      ],
    });
    expect(doc.strokes[0]?.tool).toBe("pencil");
    expect(doc.strokes[1]?.tool).toBe("marker");
  });
});
