import { describe, expect, it } from "vitest";
import { parseDocument } from "./model";
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
  };
}

const doc = parseDocument({
  schemaVersion: 1,
  canvas: { width: 256, height: 256, background: "#FFFFFF" },
  strokes: [
    {
      id: "a",
      tool: "graphite",
      color: "#333333",
      size: 3.2,
      opacity: 0.82,
      seed: 92831,
      points: [
        [0.1, 0.22, 0.4, 0],
        [0.11, 0.23, 0.7, 0.1],
        [0.13, 0.27, 0.9, 0],
      ],
    },
    {
      id: "b",
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
      id: "c",
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
  ],
});

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

  it("salida exacta congelada de las 3 clásicas (anti-regresión visual)", () => {
    const t = recordingTarget(256, 256);
    renderDocument(t, doc);
    expect(t.log).toMatchSnapshot();
  });

  it("las 8 nuevas son deterministas y producen marcas", () => {
    const tools = [
      "2b",
      "2h",
      "cpencil",
      "pen",
      "rotring",
      "spray",
      "marker2",
      "charcoal",
      "hatch",
    ] as const;
    for (const tool of tools) {
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
            points: [
              [0.2, 0.3, 0.5, 0],
              [0.5, 0.5, 0.9, 0],
              [0.7, 0.4, 0.4, 0],
            ],
          },
        ],
      });
      const t1 = recordingTarget(256, 256);
      const t2 = recordingTarget(256, 256);
      renderDocument(t1, strokeDoc);
      renderDocument(t2, strokeDoc);
      expect(t1.log).toEqual(t2.log);
      expect(t1.log.length).toBeGreaterThan(3);
    }
  });

  it("spray solo sella (sin segmentos) y hatch genera ticks", () => {
    const mk = (
      tool: "spray" | "hatch",
    ): ReturnType<typeof recordingTarget> => {
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
            seed: 99,
            points: [
              [0.2, 0.3, 0.5, 0],
              [0.6, 0.6, 0.6, 0],
            ],
          },
        ],
      });
      const t = recordingTarget(256, 256);
      renderDocument(t, strokeDoc);
      return t;
    };
    const spray = mk("spray");
    expect(spray.log.some((l) => l.startsWith("seg"))).toBe(false);
    expect(spray.log.some((l) => l.startsWith("stamp"))).toBe(true);
    const hatch = mk("hatch");
    expect(hatch.log.filter((l) => l.startsWith("seg")).length).toBeGreaterThan(
      2,
    );
    expect(hatch.log.some((l) => l.startsWith("stamp"))).toBe(false);
  });
});
