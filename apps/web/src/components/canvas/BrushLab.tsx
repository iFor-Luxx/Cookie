// Galería visual dev-only de los 14 pinceles (plan F3). Se abre con
// `#/lab` en desarrollo y NO forma parte del bundle de producción
// (import lazy + gate `import.meta.env.DEV` en main.tsx). Cada fila
// renderiza 4 gestos canónicos con el `canvas2dTarget` real: línea
// lenta firme, línea leve, curva con rampa de presión y cruce
// superpuesto (buildup). Semillas fijas → repetible.
import {
  canvas2dTarget,
  DEFAULT_BRUSHES,
  type DrawingPoint,
  renderDocument,
  type ToolId,
  type VersionedDrawingDocument,
} from "@cookie/drawing";
import { useEffect, useRef } from "react";

const ORDER: Array<{ id: ToolId; label: string }> = [
  { id: "graphite", label: "Grafito" },
  { id: "pencil", label: "Lápiz de color" },
  { id: "marker", label: "Rotulador" },
  { id: "2b", label: "2B" },
  { id: "2h", label: "2H" },
  { id: "cpencil", label: "Fibra" },
  { id: "pen", label: "Pluma" },
  { id: "rotring", label: "Técnico" },
  { id: "spray", label: "Spray" },
  { id: "marker2", label: "Bisel" },
  { id: "watercolor", label: "Acuarela" },
  { id: "charcoal", label: "Carboncillo" },
  { id: "hatch", label: "Sombreado" },
  { id: "smudge", label: "Difumino" },
];

function linePts(
  n: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  p0: number,
  p1: number,
): DrawingPoint[] {
  const pts: DrawingPoint[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, p0 + (p1 - p0) * t, 0]);
  }
  return pts;
}

function curvePts(
  n: number,
  x0: number,
  x1: number,
  y: number,
): DrawingPoint[] {
  const pts: DrawingPoint[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const p = t < 0.5 ? 0.2 + t * 1.6 : 1.0 - (t - 0.5) * 1.4;
    pts.push([
      x0 + (x1 - x0) * t,
      y + Math.sin(t * Math.PI * 2) * 0.08,
      Math.min(1, Math.max(0.15, p)),
      0,
    ]);
  }
  return pts;
}

function docFor(tool: ToolId, seedBase: number): VersionedDrawingDocument {
  const b = DEFAULT_BRUSHES[tool];
  return {
    schemaVersion: 1,
    canvas: { width: 512, height: 160, background: "#FFFFFF" },
    strokes: [
      {
        id: `${tool}-slow`,
        tool,
        color: b.color,
        size: b.size,
        opacity: b.opacity,
        seed: seedBase,
        points: linePts(10, 0.03, 0.5, 0.22, 0.5, 0.9, 0.9),
      },
      {
        id: `${tool}-light`,
        tool,
        color: b.color,
        size: b.size,
        opacity: b.opacity,
        seed: seedBase + 1,
        points: linePts(4, 0.28, 0.5, 0.44, 0.5, 0.25, 0.25),
      },
      {
        id: `${tool}-ramp`,
        tool,
        color: b.color,
        size: b.size,
        opacity: b.opacity,
        seed: seedBase + 2,
        points: curvePts(12, 0.5, 0.68, 0.5),
      },
      {
        id: `${tool}-x1`,
        tool,
        color: b.color,
        size: b.size,
        opacity: b.opacity,
        seed: seedBase + 3,
        points: linePts(8, 0.75, 0.2, 0.95, 0.8, 0.8, 0.8),
      },
      {
        id: `${tool}-x2`,
        tool,
        color: b.color,
        size: b.size,
        opacity: b.opacity,
        seed: seedBase + 4,
        points: linePts(8, 0.75, 0.8, 0.95, 0.2, 0.8, 0.8),
      },
    ],
  };
}

function LabRow({
  tool,
  label,
  index,
}: {
  tool: ToolId;
  label: string;
  index: number;
}): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    renderDocument(
      canvas2dTarget(ctx, c.width, c.height),
      docFor(tool, 1000 + index * 10),
    );
  }, [tool, index]);
  const b = DEFAULT_BRUSHES[tool];
  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="text-sm">
        <strong>{label}</strong>{" "}
        <span className="text-muted-foreground">
          {tool} · size {b.size} · op {b.opacity} · {b.color}
        </span>
      </figcaption>
      <canvas
        ref={ref}
        width={640}
        height={200}
        className="block w-full rounded border bg-white"
      />
    </figure>
  );
}

export function BrushLab(): React.JSX.Element {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <header>
        <p className="text-xs tracking-widest text-muted-foreground uppercase">
          Dev-only · #/lab
        </p>
        <h1 className="text-2xl">Banco visual de pinceles (v11)</h1>
        <p className="text-sm text-muted-foreground">
          Lenta firme · leve rápida · curva con rampa · cruce superpuesto.
          Textura fotorealista v11 (doble-tono, grano de papel, smear real).
        </p>
      </header>
      {ORDER.map(({ id, label }, i) => (
        <LabRow key={id} tool={id} label={label} index={i} />
      ))}
    </main>
  );
}
