import type { BrushAddParams } from "p5.brush/standalone";
import { describe, expect, it } from "vitest";
import {
  type P5StrokeApi,
  p5WeightForSize,
  registerCookieBrushes,
  renderDocumentP5,
  renderStrokeP5,
  strokeToMoves,
  supportsWebGL2,
  TOOL_P5_MAP,
} from "./p5brush";

const TOOL_IDS = [
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
] as const;

class RecordingP5 implements P5StrokeApi {
  log: string[] = [];
  add(name: string, params: BrushAddParams): void {
    void params;
    this.log.push(`add ${name}`);
  }
  set(name: string, color: string, weight: number): void {
    this.log.push(`set ${name} ${color} ${weight}`);
  }
  seed(n: number): void {
    this.log.push(`seed ${n}`);
  }
  beginStroke(mode: "curve", x: number, y: number): void {
    this.log.push(`begin ${mode} ${x} ${y}`);
  }
  move(angle: number, length: number, pressure: number): void {
    this.log.push(`move ${angle} ${length} ${pressure}`);
  }
  endStroke(angle: number, pressure: number): void {
    this.log.push(`end ${angle} ${pressure}`);
  }
  load(): void {
    this.log.push("load");
  }
  clear(color?: string): void {
    this.log.push(`clear ${color ?? ""}`);
  }
  render(): void {
    this.log.push("render");
  }
}

describe("p5brush mapping", () => {
  it("cubre las 12 herramientas con nombres únicos y params sanos", () => {
    expect(Object.keys(TOOL_P5_MAP).sort()).toEqual([...TOOL_IDS].sort());
    const names = Object.values(TOOL_P5_MAP).map((d) => d.brushName);
    expect(new Set(names).size).toBe(TOOL_IDS.length);
    for (const def of Object.values(TOOL_P5_MAP)) {
      expect(def.brushName.startsWith("cookie-")).toBe(true);
      expect(def.params.weight).toBeGreaterThan(0);
      if (def.params.opacity !== undefined) {
        expect(def.params.opacity).toBeGreaterThanOrEqual(0);
        expect(def.params.opacity).toBeLessThanOrEqual(255);
      }
      if (def.params.spacing !== undefined)
        expect(def.params.spacing).toBeGreaterThan(0);
      expect(["default", "spray", "marker", "custom", "image"]).toContain(
        def.params.type,
      );
    }
  });

  it("registerCookieBrushes registra los 12 pinceles propios", () => {
    const api = new RecordingP5();
    registerCookieBrushes(api);
    expect(api.log.length).toBe(12);
    expect(api.log[0]).toBe("add cookie-graphite");
  });

  it("register no muta la tabla (la lib escala lo registrado)", () => {
    const before = JSON.stringify(TOOL_P5_MAP);
    const rec = new RecordingP5();
    rec.add = (name: string, params: BrushAddParams): void => {
      params.weight *= 99;
      void name;
    };
    registerCookieBrushes(rec);
    registerCookieBrushes(rec);
    expect(JSON.stringify(TOOL_P5_MAP)).toBe(before);
  });

  it("cada tipo trae sus claves numéricas (ausente = NaN = invisible)", () => {
    const required: Record<string, Array<keyof BrushAddParams>> = {
      default: [
        "weight",
        "scatter",
        "sharpness",
        "grain",
        "opacity",
        "spacing",
      ],
      marker: ["weight", "scatter", "opacity", "spacing"],
      spray: ["weight", "scatter", "grain", "opacity", "spacing"],
    };
    for (const def of Object.values(TOOL_P5_MAP)) {
      const keys = required[def.params.type] ?? [];
      expect(keys.length).toBeGreaterThan(0);
      for (const k of keys) {
        expect(Number.isFinite(def.params[k] as number)).toBe(true);
      }
    }
  });

  it("p5WeightForSize escala monótona y valor conocido", () => {
    expect(p5WeightForSize(6, 3)).toBe(2);
    expect(p5WeightForSize(12, 3)).toBeGreaterThan(p5WeightForSize(6, 3));
  });

  it("strokeToMoves calcula ángulo/longitud exactos (radianes)", () => {
    const { start, moves, endAngleRad } = strokeToMoves(
      [
        [0, 0, 0.5, 0],
        [3, 4, 0.8, 0],
      ],
      (x, y) => ({ x, y }),
    );
    expect(start).toEqual({ x: 0, y: 0 });
    expect(moves.length).toBe(1);
    expect(moves[0]?.length).toBe(5);
    expect(moves[0]?.angleRad).toBeCloseTo(0.9273, 3);
    expect(moves[0]?.pressure).toBe(0.8);
    expect(endAngleRad).toBeCloseTo(0.9273, 3);
  });

  it("renderStrokeP5 emite secuencia determinista: seed, set, begin, moves, end", () => {
    const api = new RecordingP5();
    const stroke = {
      tool: "charcoal" as const,
      color: "#1a1a1a",
      size: 9,
      seed: 42,
      points: [
        [0.2, 0.3, 0.5, 0],
        [0.5, 0.5, 0.9, 0],
      ] as ReadonlyArray<readonly [number, number, number, number]>,
    };
    const toPx = (x: number, y: number): { x: number; y: number } => ({
      x: x * 1024,
      y: y * 1024,
    });
    renderStrokeP5(api, stroke, toPx, 3);
    expect(api.log[0]).toBe("seed 42");
    expect(api.log[1]).toBe("set cookie-charcoal #1a1a1a 3");
    expect(api.log[2]).toBe("begin curve 204.8 307.2");
    expect(api.log.length).toBe(5);
    expect(api.log[4]).toMatch(/^end /);
    // Segunda pasada idéntica.
    const api2 = new RecordingP5();
    renderStrokeP5(api2, stroke, toPx, 3);
    expect(api2.log).toEqual(api.log);
  });

  it("sin puntos no llama a nada", () => {
    const api = new RecordingP5();
    renderStrokeP5(
      api,
      {
        tool: "pen",
        color: "#111",
        size: 2,
        seed: 1,
        points: [],
      },
      (x, y) => ({ x, y }),
      3,
    );
    expect(api.log).toEqual([]);
  });

  it("sin DOM no hay WebGL2 (fondo: renderer Canvas2D)", () => {
    expect(supportsWebGL2()).toBe(false);
  });

  it("renderDocumentP5 limpia, pinta trazos y presenta", () => {
    const api = new RecordingP5();
    renderDocumentP5(
      api,
      {
        canvas: { background: "#FFFFFF" },
        strokes: [
          {
            tool: "pen",
            color: "#111111",
            size: 2,
            seed: 7,
            points: [
              [0, 0, 0.5, 0],
              [10, 0, 0.5, 0],
            ],
          },
        ],
      },
      (x, y) => ({ x, y }),
      3,
    );
    expect(api.log[0]).toBe("clear #FFFFFF");
    expect(api.log[api.log.length - 1]).toBe("render");
    expect(api.log).toContain("seed 7");
  });
});
