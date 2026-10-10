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
    stampEllipse: (x, y, rx, ry, rot, color, alpha) =>
      void log.push(
        `ell ${fmt(x)} ${fmt(y)} ${fmt(rx)} ${fmt(ry)} ${fmt(rot)} ${color} ${fmt(alpha)}`,
      ),
    hairline: (x0, y0, x1, y1, w, color, alpha) =>
      void log.push(
        `hair ${fmt(x0)} ${fmt(y0)} ${fmt(x1)} ${fmt(y1)} ${fmt(w)} ${color} ${fmt(alpha)}`,
      ),
    band: (x0, y0, x1, y1, w0, w1, color, alpha) =>
      void log.push(
        `band ${fmt(x0)} ${fmt(y0)} ${fmt(x1)} ${fmt(y1)} ${fmt(w0)} ${fmt(w1)} ${color} ${fmt(alpha)}`,
      ),
    smear: (x0, y0, x1, y1, w, strength) =>
      void log.push(
        `smear ${fmt(x0)} ${fmt(y0)} ${fmt(x1)} ${fmt(y1)} ${fmt(w)} ${fmt(strength)}`,
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

  it("las nuevas son deterministas y producen marcas", () => {
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
      "watercolor",
      "smudge",
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

  it("blanco solo en medios secos; tinta y marcadores limpios", () => {
    const mk = (
      tool:
        | "graphite"
        | "pencil"
        | "marker"
        | "2b"
        | "2h"
        | "cpencil"
        | "pen"
        | "rotring"
        | "spray"
        | "marker2"
        | "charcoal"
        | "hatch"
        | "watercolor"
        | "smudge",
    ): string[] => {
      const strokeDoc = parseDocument({
        schemaVersion: 1,
        canvas: { width: 256, height: 256, background: "#FFFFFF" },
        strokes: [
          {
            id: "x",
            tool,
            color: "#111111",
            size: 10,
            opacity: 0.9,
            seed: 555,
            points: [
              [0.2, 0.3, 0.5, 0],
              [0.5, 0.5, 0.9, 0],
              [0.7, 0.4, 0.4, 0],
            ],
          },
        ],
      });
      const t = recordingTarget(256, 256);
      renderDocument(t, strokeDoc);
      return t.log;
    };
    const hasBg = (log: string[]): boolean =>
      log.some(
        (l) =>
          (l.startsWith("seg") ||
            l.startsWith("stamp") ||
            l.startsWith("ell") ||
            l.startsWith("hair")) &&
          l.includes("#FFFFFF"),
      );
    // Secos con diente: alguna mota es del fondo.
    for (const tool of ["graphite", "pencil", "2b", "charcoal"] as const) {
      expect(
        mk(tool).some((l) => l.includes("#FFFFFF")),
        tool,
      ).toBe(true);
    }
    // Fibra: alguna cerda sale color papel (no son motas).
    expect(
      mk("cpencil").some((l) => l.startsWith("hair") && l.includes("#FFFFFF")),
      "cpencil",
    ).toBe(true);
    // Tinta, técnico, rotulador, 2H, spray y sombreado: cero fondo.
    // (Bisel con vetas y acuarela con blooms: se comprueban aparte.)
    for (const tool of [
      "pen",
      "rotring",
      "spray",
      "hatch",
      "marker",
      "2h",
    ] as const) {
      expect(hasBg(mk(tool)), tool).toBe(false);
    }
    // Vetado seco del bisel: rieles pálidos finos (alfa ≤ 0.25), nunca puntos.
    {
      const veins = mk("marker2").filter(
        (l) => l.startsWith("hair") && l.includes("#FFFFFF"),
      );
      expect(veins.length).toBeGreaterThan(0);
      expect(
        Math.max(...veins.map((l) => Number(l.split(" ")[7]))),
      ).toBeLessThanOrEqual(0.25);
      expect(
        mk("marker2").some(
          (l) =>
            (l.startsWith("stamp") || l.startsWith("ell")) &&
            l.includes("#FFFFFF"),
        ),
      ).toBe(false);
    }
    // Marcadores translúcidos por solape (port p5: op 25/255): motas
    // grandes y tenues que acumulan; bandas tenues en el bisel.
    {
      const mlog = mk("marker").filter((l) => l.startsWith("stamp"));
      expect(mlog.length).toBeGreaterThan(50);
      expect(
        Math.max(...mlog.map((l) => Number(l.split(" ")[3]))),
      ).toBeGreaterThanOrEqual(4);
      expect(
        Math.max(...mlog.map((l) => Number(l.split(" ")[5]))),
      ).toBeLessThan(0.3);
    }
    {
      const blog = mk("marker2").filter((l) => l.startsWith("band"));
      expect(blog.length).toBeGreaterThan(0);
      expect(
        Math.max(...blog.map((l) => Number(l.split(" ")[8]))),
      ).toBeLessThan(0.2);
    }
    // Acuarela: wash + filo oscuro + granulación, sin fondo.
    {
      const log = mk("watercolor");
      expect(log.some((l) => l.startsWith("seg"))).toBe(true);
      expect(log.some((l) => l.includes("#0a0a0a"))).toBe(true);
      expect(log.some((l) => l.startsWith("ell"))).toBe(true);
    }
    // Difumino: sin tinta propia — halo de lifts color papel + núcleo
    // de tono arrastrado apagado (#111111→#0e0e0e), nunca negro sólido.
    {
      const log = mk("smudge");
      expect(
        log.some((l) => l.startsWith("seg") && l.includes("#FFFFFF")),
      ).toBe(true);
      expect(log.some((l) => l.includes("#0e0e0e"))).toBe(true);
      expect(
        log.some((l) => l.includes("#111111") && !l.includes("#FFFFFF")),
      ).toBe(false);
      const alphaOf = (l: string): number => {
        const p = l.split(" ");
        if (p[0] === "seg") return Number(p[8]);
        if (p[0] === "hair" || p[0] === "ell") return Number(p[7]);
        if (p[0] === "smear") return Number(p[6]);
        return Number(p[5]); // stamp
      };
      const alphas = log.filter((l) => !l.startsWith("clear")).map(alphaOf);
      expect(Math.max(...alphas)).toBeLessThan(0.3);
    }
    // Papel físico: las motas de fondo son diminutas (nunca discos).
    for (const tool of ["graphite", "pencil", "2b"] as const) {
      const radii: number[] = [];
      for (const l of mk(tool)) {
        const parts = l.split(" ");
        if (parts[0] === "stamp" && parts[4] === "#FFFFFF")
          radii.push(Number(parts[3]));
      }
      if (radii.length > 0)
        expect(Math.max(...radii), tool).toBeLessThanOrEqual(2.5);
    }
    // Lifts de carbón: elipses de fondo grandes y tenues (alfa ≤ 0.12).
    {
      const lifts: { rx: number; alpha: number }[] = [];
      for (const l of mk("charcoal")) {
        const parts = l.split(" ");
        if (parts[0] === "ell" && parts[6] === "#FFFFFF")
          lifts.push({ rx: Number(parts[3]), alpha: Number(parts[7]) });
      }
      expect(lifts.length).toBeGreaterThan(0);
      expect(Math.max(...lifts.map((x) => x.rx))).toBeGreaterThanOrEqual(8);
      expect(Math.max(...lifts.map((x) => x.alpha))).toBeLessThanOrEqual(0.12);
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
    expect(spray.log.some((l) => l.startsWith("hair"))).toBe(false);
    expect(spray.log.some((l) => l.startsWith("stamp"))).toBe(true);
    const hatch = mk("hatch");
    // Línea en estipulado (motas) + ticks, sin segmentos vectoriales.
    expect(hatch.log.some((l) => l.startsWith("seg"))).toBe(false);
    expect(hatch.log.some((l) => l.startsWith("stamp"))).toBe(true);
    // Ticks del sombreado son hairlines presentes.
    expect(hatch.log.some((l) => l.startsWith("hair"))).toBe(true);
    const tickAlpha = hatch.log
      .filter((l) => l.startsWith("hair"))
      .map((l) => Number(l.split(" ")[7]));
    expect(Math.max(...tickAlpha)).toBeGreaterThanOrEqual(0.6);
  });

  it("las 14 herramientas producen secuencias distintas entre sí", () => {
    const tools = [
      "graphite",
      "pencil",
      "marker",
      "2b",
      "2h",
      "cpencil",
      "pen",
      "rotring",
      "spray",
      "marker2",
      "charcoal",
      "hatch",
      "watercolor",
      "smudge",
    ] as const;
    const logs = new Map<string, string>();
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
      const t = recordingTarget(256, 256);
      renderDocument(t, strokeDoc);
      logs.set(tool, JSON.stringify(t.log));
    }
    const seen = new Set(logs.values());
    expect(seen.size).toBe(tools.length);
  });

  it("firmas por régimen: cada pincel usa su geometría propia", () => {
    const ops = (
      tool:
        | "graphite"
        | "pencil"
        | "marker"
        | "2b"
        | "2h"
        | "cpencil"
        | "pen"
        | "rotring"
        | "spray"
        | "marker2"
        | "charcoal"
        | "hatch"
        | "watercolor",
      // Trazo en L: expone si el ancho depende de la dirección.
      points: DrawingPoint[] = [
        [0.1, 0.5, 0.9, 0],
        [0.45, 0.5, 0.9, 0],
        [0.45, 0.15, 0.9, 0],
      ],
    ): {
      seg: number;
      stamp: number;
      ell: number;
      hair: number;
      band: number;
      segW: number[];
      stampR: number[];
    } => {
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
      const out = {
        seg: 0,
        stamp: 0,
        ell: 0,
        hair: 0,
        band: 0,
        segW: [] as number[],
        stampR: [] as number[],
      };
      for (const l of t.log) {
        const parts = l.split(" ");
        if (parts[0] === "seg") {
          out.seg++;
          out.segW.push(Number(parts[5]), Number(parts[6]));
        } else if (parts[0] === "stamp") {
          out.stamp++;
          out.stampR.push(Number(parts[3]));
        } else if (parts[0] === "ell") out.ell++;
        else if (parts[0] === "hair") out.hair++;
        else if (parts[0] === "band") {
          out.band++;
          out.segW.push(Number(parts[5]), Number(parts[6]));
        }
      }
      return out;
    };
    // Fibra = abanico de hairlines, cero motas circulares.
    const fiber = ops("cpencil");
    expect(fiber.hair).toBeGreaterThan(10);
    expect(fiber.stamp).toBe(0);
    expect(fiber.ell).toBe(0);
    // Carboncillo = trozos elípticos, grafito no usa elipses.
    expect(ops("charcoal").ell).toBeGreaterThan(5);
    expect(ops("graphite").ell).toBe(0);
    // Técnico = estipulado fino y denso (gris con grano) + gota.
    // Cero segmentos y cero hairlines: nada vectorial.
    const tec = ops("rotring");
    expect(tec.seg).toBe(0);
    expect(tec.hair).toBe(0);
    expect(tec.stamp).toBeGreaterThan(50);
    // 2H = estipulado ralo y tenue, mucho menos denso que el grafito.
    const h2 = ops("2h");
    expect(h2.seg).toBe(0);
    expect(h2.hair).toBe(0);
    expect(h2.stamp).toBeGreaterThan(0);
    expect(h2.stamp).toBeLessThan(ops("graphite").stamp);
    // Pluma caligráfica: el ancho varía con la dirección en el trazo en L;
    // rotulador sólido: ancho constante entre tramo horizontal y vertical.
    const lStroke = ops("pen");
    const lWidths = new Set(lStroke.segW.map((w) => w.toFixed(2)));
    expect(lWidths.size).toBeGreaterThan(2);
    // Rotulador translúcido que acumula: motas grandes (≥0.6×size),
    // abundantes y tenues — el sólido sale del solape, no de la alfa.
    const markerOps = ops("marker");
    expect(markerOps.seg).toBe(0);
    expect(markerOps.stamp).toBeGreaterThan(50);
    expect(Math.max(...markerOps.stampR)).toBeGreaterThanOrEqual(0.6 * 8);
    // Bisel: BANDA PLANA modulada por dirección + filos (hair) + bulbs.
    const bevel = ops("marker2");
    expect(bevel.band).toBeGreaterThan(0); // filo plano, no cápsula
    expect(bevel.seg).toBe(0);
    expect(bevel.stamp).toBeGreaterThan(0); // bulbs
    expect(bevel.hair).toBeGreaterThan(0); // filos
    expect(new Set(bevel.segW.map((w) => w.toFixed(2))).size).toBeGreaterThan(
      2,
    );
    // Acuarela: wash (seg) + filo (hair) + granulación (ell).
    const wash = ops("watercolor");
    expect(wash.seg).toBeGreaterThan(0);
    expect(wash.hair).toBeGreaterThan(0);
    expect(wash.ell).toBeGreaterThan(0);
    // Spray: solo sellos; hatch: segmentos + hairlines, cero sellos.
    const spray = ops("spray");
    expect(spray.seg).toBe(0);
    expect(spray.hair).toBe(0);
    expect(spray.stamp).toBeGreaterThan(0);
    // Sombreado: línea en motas + ticks, cero segmentos.
    const hatch = ops("hatch");
    expect(hatch.stamp).toBeGreaterThan(0);
    expect(hatch.hair).toBeGreaterThan(0);
    expect(hatch.seg).toBe(0);
    // Lápiz de color: núcleo + bordes de dos tonos (más segmentos que grafito).
    expect(ops("pencil").seg + ops("pencil").hair).toBeGreaterThan(
      ops("graphite").seg,
    );
    // D1: el rotulador es sólido (motas grandes) y el grafito es polvo
    // (motas pequeñas): la mota mayor del rotulador duplica la del grafito.
    expect(Math.max(...ops("marker").stampR)).toBeGreaterThan(
      Math.max(...ops("graphite").stampR) * 2,
    );
    // D2: toque leve = motas más finas pero con cuerpo (ratio < 0.6).
    const faintDoc = parseDocument({
      schemaVersion: 1,
      canvas: { width: 256, height: 256, background: "#FFFFFF" },
      strokes: [
        {
          id: "x",
          tool: "graphite",
          color: "#333333",
          size: 8,
          opacity: 0.8,
          seed: 1234,
          points: [
            [0.1, 0.5, 0.2, 0],
            [0.45, 0.5, 0.2, 0],
            [0.45, 0.15, 0.2, 0],
          ],
        },
      ],
    });
    const ft = recordingTarget(256, 256);
    renderDocument(ft, faintDoc);
    const faintR: number[] = [];
    for (const l of ft.log) {
      const parts = l.split(" ");
      if (parts[0] === "stamp") faintR.push(Number(parts[3]));
    }
    const refMax = Math.max(...ops("graphite").stampR);
    expect(Math.max(...faintR) / refMax).toBeLessThan(0.6);
    // D5: curva de mano — el carbón se desvía de la recta, el 2H no.
    const straight = (tool: "charcoal" | "2h"): number => {
      const d = parseDocument({
        schemaVersion: 1,
        canvas: { width: 256, height: 256, background: "#FFFFFF" },
        strokes: [
          {
            id: "x",
            tool,
            color: "#333333",
            size: 10,
            opacity: 0.8,
            seed: 77,
            points: [
              [0.05, 0.5, 0.9, 0],
              [0.2, 0.5, 0.9, 0],
              [0.35, 0.5, 0.9, 0],
              [0.5, 0.5, 0.9, 0],
              [0.65, 0.5, 0.9, 0],
              [0.8, 0.5, 0.9, 0],
            ],
          },
        ],
      });
      const t = recordingTarget(256, 256);
      renderDocument(t, d);
      let dev = 0;
      for (const l of t.log) {
        const parts = l.split(" ");
        if (parts[0] === "stamp" || parts[0] === "ell") {
          dev = Math.max(dev, Math.abs(Number(parts[2]) - 128));
        }
      }
      return dev;
    };
    // D5: el carbón vaguea mucho más que el 2H (estipulado disperso).
    expect(straight("charcoal")).toBeGreaterThan(0.5);
    expect(straight("charcoal")).toBeGreaterThan(straight("2h") * 2);
  });

  it("firmas v5: niebla, densidad, envolventes y polvo", () => {
    const v5 = (
      tool:
        | "graphite"
        | "pencil"
        | "marker"
        | "2b"
        | "2h"
        | "cpencil"
        | "pen"
        | "rotring"
        | "spray"
        | "marker2"
        | "charcoal"
        | "hatch",
      points: DrawingPoint[] = [
        [0.1, 0.5, 0.9, 0],
        [0.45, 0.5, 0.9, 0],
        [0.45, 0.15, 0.9, 0],
      ],
    ): { segW: number[]; stampR: number[]; ellRx: number[]; n: number } => {
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
      const out = {
        segW: [] as number[],
        stampR: [] as number[],
        ellRx: [] as number[],
        n: 0,
      };
      for (const l of t.log) {
        const parts = l.split(" ");
        if (parts[0] === "seg")
          out.segW.push(Number(parts[5]), Number(parts[6]));
        else if (parts[0] === "stamp") out.stampR.push(Number(parts[3]));
        else if (parts[0] === "ell") out.ellRx.push(Number(parts[3]));
        else if (parts[0] === "band")
          out.segW.push(Number(parts[5]), Number(parts[6]));
      }
      out.n = out.segW.length + out.stampR.length + out.ellRx.length;
      return out;
    };
    // S1: niebla — motas minúsculas (≤2.2px a size 8) y abundantes.
    const mist = v5("spray");
    expect(mist.stampR.length).toBeGreaterThan(100);
    expect(Math.max(...mist.stampR)).toBeLessThanOrEqual(2.2);
    // S4: carbón denso con algún trozo grande.
    const coal = v5("charcoal");
    expect(coal.stampR.length + coal.ellRx.length).toBeGreaterThan(200);
    expect(Math.max(...coal.ellRx)).toBeGreaterThan(3);
    // S6: grafito en polvo denso (motas < 0.6×size, abundantes).
    const dust = v5("graphite");
    expect(Math.max(...dust.stampR)).toBeLessThan(0.6 * 8);
    expect(dust.stampR.length).toBeGreaterThan(50);
    // S3: 2B modulado a lo largo (Lorentz [1.3,1]): los cuartiles de
    // motas primero y último difieren >1.1×.
    const softR = v5("2b").stampR;
    const q = Math.floor(softR.length / 4);
    const qavg = (a: number[]): number =>
      a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
    expect(
      Math.max(qavg(softR.slice(0, q)), qavg(softR.slice(3 * q))) /
        Math.min(qavg(softR.slice(0, q)), qavg(softR.slice(3 * q))),
    ).toBeGreaterThan(1.1);
    // S3: lápiz creciendo hacia el final (media 2ª mitad > 1ª mitad,
    // robusto al burnish intercalado).
    const wax = v5("pencil");
    const waxHalf = Math.floor(wax.segW.length / 2);
    const waxAvg = (ws: number[]): number =>
      ws.reduce((s, w) => s + w, 0) / Math.max(1, ws.length);
    expect(
      waxAvg(wax.segW.slice(waxHalf)) / waxAvg(wax.segW.slice(0, waxHalf)),
    ).toBeGreaterThan(1.1);
    // Bisel marcado: el ancho respira con la dirección (ratio > 1.25 en L).
    const bevelW = v5("marker2").segW;
    expect(Math.max(...bevelW) / Math.min(...bevelW)).toBeGreaterThan(1.25);
  });

  it("realismo por herramienta: física de cada medio", () => {
    const stroke = (
      tool:
        | "graphite"
        | "pencil"
        | "marker"
        | "2b"
        | "2h"
        | "cpencil"
        | "pen"
        | "rotring"
        | "spray"
        | "marker2"
        | "charcoal"
        | "hatch"
        | "watercolor",
      points: DrawingPoint[],
      color = "#111111",
    ): string[] => {
      const doc = parseDocument({
        schemaVersion: 1,
        canvas: { width: 256, height: 256, background: "#FFFFFF" },
        strokes: [
          { id: "x", tool, color, size: 8, opacity: 0.9, seed: 1234, points },
        ],
      });
      const t = recordingTarget(256, 256);
      renderDocument(t, doc);
      return t.log;
    };
    const lStroke: DrawingPoint[] = [
      [0.1, 0.5, 0.9, 0],
      [0.45, 0.5, 0.9, 0],
      [0.45, 0.15, 0.9, 0],
    ];
    const segOps = (log: string[]): number[][] =>
      log
        .filter((l) => l.startsWith("seg"))
        .map((l) => l.split(" ").slice(1, 9).map(Number));
    // Pluma stub: tramo vertical más ancho que el horizontal (×1.5+).
    {
      const segs = segOps(stroke("pen", lStroke));
      const half = Math.floor(segs.length / 2);
      const avg = (ws: number[][]): number =>
        ws.reduce((s, w) => s + (w[4] ?? 0) + (w[5] ?? 0), 0) /
        Math.max(1, ws.length * 2);
      expect(avg(segs.slice(half)) / avg(segs.slice(0, half))).toBeGreaterThan(
        1.5,
      );
    }
    // Pluma shading: el alfa varía a lo largo del trazo (no es plano).
    {
      const alphas = segOps(stroke("pen", lStroke)).map((w) => w[7] ?? 0);
      expect(Math.max(...alphas) / Math.min(...alphas)).toBeGreaterThan(1.05);
    }
    // Técnico: gota al apoyar (sello junto al primer punto, r ≥ 4).
    {
      const found = stroke("rotring", lStroke).some((l) => {
        const p = l.split(" ");
        return (
          p[0] === "stamp" &&
          Math.hypot(Number(p[1]) - 25.6, Number(p[2]) - 128) < 1 &&
          Number(p[3]) >= 4
        );
      });
      expect(found).toBe(true);
    }
    // Bisel sin presión: rampa 0.3→1.0 en recta, anchos casi constantes.
    {
      const ramp: DrawingPoint[] = [
        [0.1, 0.5, 0.3, 0],
        [0.4, 0.5, 0.65, 0],
        [0.7, 0.5, 1.0, 0],
      ];
      const log = stroke("marker2", ramp);
      const ws: number[] = [];
      for (const l of log) {
        const p = l.split(" ");
        if (p[0] === "band") ws.push(Number(p[5]), Number(p[6]));
      }
      expect(Math.max(...ws) / Math.min(...ws)).toBeLessThan(1.05);
      // Vetas secas tenues (fondo, alfa ≤ 0.25).
      const dry = log.filter(
        (l) => l.startsWith("hair") && l.includes("#FFFFFF"),
      );
      expect(dry.length).toBeGreaterThan(0);
      expect(
        Math.max(...dry.map((l) => Number(l.split(" ")[7]))),
      ).toBeLessThanOrEqual(0.25);
    }
    // Rotulador translúcido que acumula: motas grandes (≥0.6×size),
    // abundantes y tenues (alfa < 0.3) — el sólido sale del solape.
    {
      const straight: DrawingPoint[] = [
        [0.1, 0.5, 1.0, 0],
        [0.4, 0.5, 1.0, 0],
        [0.7, 0.5, 1.0, 0],
      ];
      const log = stroke("marker", straight);
      const stamps = log.filter((l) => l.startsWith("stamp"));
      expect(stamps.length).toBeGreaterThan(50);
      expect(
        Math.max(...stamps.map((l) => Number(l.split(" ")[3]))),
      ).toBeGreaterThanOrEqual(0.6 * 8);
      expect(
        Math.max(...stamps.map((l) => Number(l.split(" ")[5]))),
      ).toBeLessThan(0.3);
    }
    // Fibra con sangrado: segmentos tenues bajo las cerdas.
    {
      const log = stroke("cpencil", lStroke);
      expect(log.some((l) => l.startsWith("seg"))).toBe(true);
      expect(log.some((l) => l.startsWith("hair"))).toBe(true);
    }
    // 2H capado: con opacidad 1.0 el trazo sigue tenue.
    {
      const doc = parseDocument({
        schemaVersion: 1,
        canvas: { width: 256, height: 256, background: "#FFFFFF" },
        strokes: [
          {
            id: "x",
            tool: "2h",
            color: "#111111",
            size: 8,
            opacity: 1.0,
            seed: 5,
            points: [
              [0.1, 0.5, 1.0, 0],
              [0.5, 0.5, 1.0, 0],
            ],
          },
        ],
      });
      const t = recordingTarget(256, 256);
      renderDocument(t, doc);
      const alphas = t.log
        .filter((l) => l.startsWith("stamp"))
        .map((l) => Number(l.split(" ")[5]));
      expect(Math.max(...alphas)).toBeLessThanOrEqual(0.3);
    }
    // Lápiz en capas: más segmentos que el grafito + velo de burnish.
    {
      const g = stroke("graphite", lStroke).filter((l) =>
        l.startsWith("seg"),
      ).length;
      const p = stroke("pencil", lStroke).filter((l) =>
        l.startsWith("seg"),
      ).length;
      expect(p).toBeGreaterThanOrEqual(g * 2);
      const hasSheen = stroke("pencil", lStroke).some((l) =>
        l.includes("#4d4d4d"),
      );
      expect(hasSheen).toBe(true);
    }
    // Carbón vine/compressed: a presión 1 hay marcas densas (alfa ≥ 0.3).
    {
      const hard: DrawingPoint[] = [
        [0.1, 0.5, 1.0, 0],
        [0.45, 0.5, 1.0, 0],
        [0.45, 0.15, 1.0, 0],
      ];
      const alphas = stroke("charcoal", hard)
        .filter((l) => l.startsWith("stamp") || l.startsWith("ell"))
        .map((l) => Number(l.split(" ")[l.startsWith("ell") ? 7 : 5]));
      expect(Math.max(...alphas)).toBeGreaterThanOrEqual(0.3);
    }
    // Spray con gatillo: el primer decil es más tenue que la media.
    {
      const all = stroke("spray", lStroke)
        .filter((l) => l.startsWith("stamp"))
        .map((l) => ({
          x: Number(l.split(" ")[1]),
          a: Number(l.split(" ")[5]),
        }));
      const first = all.filter((s) => s.x < 34.6).map((s) => s.a);
      const mean = all.reduce((s, x) => s + x.a, 0) / all.length;
      const meanFirst = first.reduce((s, x) => s + x, 0) / first.length;
      expect(meanFirst).toBeLessThan(mean * 0.8);
    }
    // Spray con tilt: la nube se abre (un solo punto: solo mide la nube).
    {
      const dot = (tilt: number): DrawingPoint[] => [[0.5, 0.5, 0.9, tilt]];
      const spread = (log: string[]): number => {
        const xs = log
          .filter((l) => l.startsWith("stamp"))
          .map((l) => Number(l.split(" ")[1]));
        const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
        return xs.reduce((s, x) => s + Math.abs(x - mean), 0) / xs.length;
      };
      expect(
        spread(stroke("spray", dot(0.6))) / spread(stroke("spray", dot(0))),
      ).toBeGreaterThan(1.5);
    }
    // Grafito con tilt: el lateral ensancha las motas.
    {
      const tilted: DrawingPoint[] = [
        [0.1, 0.5, 0.9, 0.6],
        [0.45, 0.5, 0.9, 0.6],
        [0.45, 0.15, 0.9, 0.6],
      ];
      const rmax = (log: string[]): number =>
        Math.max(
          ...log
            .filter((l) => l.startsWith("stamp"))
            .map((l) => Number(l.split(" ")[3])),
        );
      expect(
        rmax(stroke("graphite", tilted)) / rmax(stroke("graphite", lStroke)),
      ).toBeGreaterThan(1.3);
    }
    // Sombreado cruzado: algún tick con ángulo distinto (>0.3 rad).
    {
      const angs = stroke("hatch", lStroke)
        .filter((l) => l.startsWith("hair"))
        .map((l) => {
          const p = l.split(" ").slice(1, 5).map(Number);
          return Math.atan2(
            (p[3] ?? 0) - (p[1] ?? 0),
            (p[2] ?? 0) - (p[0] ?? 0),
          );
        });
      const base = angs[0] ?? 0;
      const norm = (a: number): number =>
        Math.atan2(Math.sin(a - base), Math.cos(a - base));
      expect(Math.max(...angs.map((a) => Math.abs(norm(a))))).toBeGreaterThan(
        0.3,
      );
    }
    // Bloom de acuarela: centro pálido grande y tenue.
    {
      const blooms = stroke("watercolor", lStroke)
        .filter((l) => l.startsWith("ell") && l.includes("#FFFFFF"))
        .map((l) => ({
          rx: Number(l.split(" ")[3]),
          a: Number(l.split(" ")[7]),
        }));
      expect(blooms.length).toBeGreaterThan(0);
      expect(Math.max(...blooms.map((b) => b.rx))).toBeGreaterThanOrEqual(8);
      expect(Math.max(...blooms.map((b) => b.a))).toBeLessThanOrEqual(0.12);
    }
  });

  it("difumino determinista con firma propia (halo + arrastre + fibra)", () => {
    const doc = parseDocument({
      schemaVersion: 1,
      canvas: { width: 256, height: 256, background: "#FFFFFF" },
      strokes: [
        {
          id: "x",
          tool: "smudge",
          color: "#333333",
          size: 10,
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
    renderDocument(t1, doc);
    renderDocument(t2, doc);
    expect(t1.log).toEqual(t2.log);
    expect(t1.log.length).toBeGreaterThan(10);
    // Halo ancho de lifts (seg color fondo, más anchos que la mina).
    const halo = t1.log.filter(
      (l) => l.startsWith("seg") && l.includes("#FFFFFF"),
    );
    expect(halo.length).toBeGreaterThan(0);
    const haloW = halo.map((l) => Number(l.split(" ")[5]));
    expect(Math.max(...haloW)).toBeGreaterThan(10);
    // Arrastre del tono apagado (#333333→#2b2b2b), nunca el color puro.
    expect(t1.log.some((l) => l.includes("#2b2b2b"))).toBe(true);
    expect(
      t1.log.some((l) => l.includes("#333333") && !l.includes("#FFFFFF")),
    ).toBe(false);
    // Fibra longitudinal + esponjado, sin bandas ni elipses duras de carbón.
    expect(t1.log.some((l) => l.startsWith("hair"))).toBe(true);
    expect(t1.log.some((l) => l.startsWith("band"))).toBe(false);
    // v11: mezcla real — emite smear a lo largo del trazo.
    expect(t1.log.some((l) => l.startsWith("smear"))).toBe(true);
  });
});
