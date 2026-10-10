import { describe, expect, it } from "vitest";
import { type DrawingPoint, parseDocument } from "./model";
import { type RenderTarget, renderDocument } from "./renderer";

function recordingTarget(
  width: number,
  height: number,
): RenderTarget & { log: string[] } {
  const log: string[] = [];
  const fmt = (n: number): string => n.toFixed(3);
  return {
    width,
    height,
    log,
    clear: (bg: string) => void log.push(`clear ${bg}`),
    segment: (x0, y0, x1, y1, w0, w1, color, alpha) =>
      void log.push(
        `seg ${fmt(x0)} ${fmt(y0)} ${fmt(x1)} ${fmt(y1)} ${fmt(w0)} ${fmt(w1)} ${color} ${fmt(alpha)}`,
      ),
    stamp: (x, y, r, color, alpha) =>
      void log.push(
        `stamp ${fmt(x)} ${fmt(y)} ${fmt(r)} ${color} ${fmt(alpha)}`,
      ),
    hairline: (x0, y0, x1, y1, w, color, alpha) =>
      void log.push(
        `hair ${fmt(x0)} ${fmt(y0)} ${fmt(x1)} ${fmt(y1)} ${fmt(w)} ${color} ${fmt(alpha)}`,
      ),
  };
}

const doc = parseDocument({
  schemaVersion: 1,
  canvas: { width: 256, height: 256, background: "#FFFFFF" },
  strokes: [
    {
      id: "a",
      tool: "pencil",
      color: "#2563eb",
      size: 4.5,
      opacity: 0.7,
      seed: 42,
      points: [
        [0.5, 0.5, 0.5, 0],
        [0.6, 0.55, 0.6, 0],
      ],
    },
    {
      id: "b",
      tool: "marker",
      color: "#111111",
      size: 12,
      opacity: 0.55,
      seed: 7,
      points: [
        [0.2, 0.8, 1, 0],
        [0.4, 0.7, 1, 0],
      ],
    },
    {
      id: "c",
      tool: "pen",
      color: "#111111",
      size: 3,
      opacity: 0.95,
      seed: 9,
      points: [
        [0.1, 0.2, 0.9, 0],
        [0.3, 0.25, 0.9, 0],
      ],
    },
  ],
});

const TOOLS = ["pencil", "marker", "cpencil", "pen"] as const;

function strokeLog(
  tool: (typeof TOOLS)[number],
  points: DrawingPoint[] = [
    [0.2, 0.3, 0.5, 0],
    [0.5, 0.5, 0.9, 0],
    [0.7, 0.4, 0.4, 0],
  ],
): string[] {
  const strokeDoc = parseDocument({
    schemaVersion: 1,
    canvas: { width: 256, height: 256, background: "#FFFFFF" },
    strokes: [
      {
        id: "x",
        tool,
        color: "#333333",
        size: 8,
        opacity: 0.8,
        seed: 1234,
        points,
      },
    ],
  });
  const t = recordingTarget(256, 256);
  renderDocument(t, strokeDoc);
  return t.log;
}

describe("renderer determinista", () => {
  it("mismo documento → misma secuencia de comandos", () => {
    const t1 = recordingTarget(256, 256);
    const t2 = recordingTarget(256, 256);
    renderDocument(t1, doc);
    renderDocument(t2, doc);
    expect(t1.log).toEqual(t2.log);
    expect(t1.log.length).toBeGreaterThan(10);
    expect(t1.log[0]).toBe("clear #FFFFFF");
  });

  it("seed distinto → grano distinto (pero estable por seed)", () => {
    const t1 = recordingTarget(256, 256);
    const t2 = recordingTarget(256, 256);
    renderDocument(t1, doc);
    renderDocument(t2, {
      ...doc,
      strokes: doc.strokes.map((s) => (s.id === "a" ? { ...s, seed: 1 } : s)),
    });
    expect(t1.log).not.toEqual(t2.log);
    const t3 = recordingTarget(256, 256);
    renderDocument(t3, doc);
    expect(t3.log).toEqual(t1.log);
  });

  it("salida exacta congelada (anti-regresión visual)", () => {
    const t = recordingTarget(256, 256);
    renderDocument(t, doc);
    expect(t.log).toMatchSnapshot();
  });

  it("las 4 son deterministas y producen marcas", () => {
    for (const tool of TOOLS) {
      const t1 = recordingTarget(256, 256);
      const t2 = recordingTarget(256, 256);
      const d = parseDocument({
        schemaVersion: 1,
        canvas: { width: 256, height: 256, background: "#FFFFFF" },
        strokes: [
          {
            id: "x",
            tool,
            color: "#333333",
            size: 8,
            opacity: 0.8,
            seed: 1234,
            points: [
              [0.2, 0.3, 0.5, 0],
              [0.5, 0.5, 0.9, 0],
              [0.7, 0.4, 0.4, 0],
            ],
          },
        ],
      });
      renderDocument(t1, d);
      renderDocument(t2, d);
      expect(t1.log).toEqual(t2.log);
      expect(t1.log.length).toBeGreaterThan(3);
    }
  });

  it("las 4 herramientas producen secuencias distintas entre sí", () => {
    const seen = new Set(TOOLS.map((tool) => JSON.stringify(strokeLog(tool))));
    expect(seen.size).toBe(TOOLS.length);
  });

  it("firmas por régimen: cada pincel usa su geometría propia", () => {
    const ops = (
      tool: (typeof TOOLS)[number],
      points: DrawingPoint[] = [
        [0.1, 0.5, 0.9, 0],
        [0.45, 0.5, 0.9, 0],
        [0.45, 0.15, 0.9, 0],
      ],
    ): { seg: number; stamp: number; hair: number; segW: number[] } => {
      const out = { seg: 0, stamp: 0, hair: 0, segW: [] as number[] };
      for (const l of strokeLog(tool, points)) {
        const parts = l.split(" ");
        if (parts[0] === "seg") {
          out.seg++;
          out.segW.push(Number(parts[5]), Number(parts[6]));
        } else if (parts[0] === "stamp") out.stamp++;
        else if (parts[0] === "hair") out.hair++;
      }
      return out;
    };
    // Rotulador: solo motas translúcidas que acumulan, nada vectorial.
    const markerOps = ops("marker");
    expect(markerOps.seg).toBe(0);
    expect(markerOps.hair).toBe(0);
    expect(markerOps.stamp).toBeGreaterThan(50);
    // Pluma stub: el ancho varía con la dirección en el trazo en L.
    const penOps = ops("pen");
    expect(penOps.seg).toBeGreaterThan(0);
    expect(new Set(penOps.segW.map((w) => w.toFixed(2))).size).toBeGreaterThan(
      2,
    );
    // Fibra: abanico de hairlines, cero motas circulares.
    const fiber = ops("cpencil");
    expect(fiber.hair).toBeGreaterThan(10);
    expect(fiber.stamp).toBe(0);
    // Lápiz de color: núcleo en capas + bordes de dos tonos + grano.
    const wax = ops("pencil");
    expect(wax.seg).toBeGreaterThan(0);
    expect(wax.hair).toBeGreaterThan(0);
    expect(wax.stamp).toBeGreaterThan(0);
  });

  it("documentos legacy con herramientas eliminadas migran y renderizan", () => {
    const legacy = parseDocument({
      schemaVersion: 1,
      canvas: { width: 256, height: 256, background: "#FFFFFF" },
      strokes: [
        {
          id: "g",
          tool: "graphite",
          color: "#333333",
          size: 4,
          opacity: 0.8,
          seed: 1,
          points: [
            [0.2, 0.3, 0.5, 0],
            [0.5, 0.5, 0.9, 0],
          ],
        },
        {
          id: "s",
          tool: "smudge",
          color: "#555555",
          size: 10,
          opacity: 0.5,
          seed: 2,
          points: [
            [0.3, 0.3, 0.5, 0],
            [0.6, 0.6, 0.5, 0],
          ],
        },
      ],
    });
    expect(legacy.strokes[0]?.tool).toBe("pencil");
    expect(legacy.strokes[1]?.tool).toBe("pencil");
    const t = recordingTarget(256, 256);
    renderDocument(t, legacy);
    expect(t.log.length).toBeGreaterThan(3);
  });
});
