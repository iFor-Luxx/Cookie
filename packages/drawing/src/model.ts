// @cookie/drawing — modelo canónico del documento (SDD §7). Geometría
// normalizada 0..1, sin referencias DOM. `schemaVersion: 1`.
import { z } from "zod";

export const DRAWING_SCHEMA_VERSION = 1 as const;
/** Límite MVP: puntos por trazo (acota memoria/interpolación). */
export const MAX_POINTS_PER_STROKE = 4096 as const;
/** Límite MVP: trazos por documento (acota render/export). */
export const MAX_STROKES_PER_DOCUMENT = 512 as const;

export const toolSchema = z.enum([
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
]);
export type ToolId = z.infer<typeof toolSchema>;

/** Punto canónico: x, y (0..1), pressure (0..1), tilt (radianes, puede ser 0). */
export const pointSchema = z.tuple([
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number(),
]);
export type DrawingPoint = z.infer<typeof pointSchema>;

export const strokeSchema = z.object({
  id: z.string().min(1),
  tool: toolSchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  size: z.number().positive().max(128),
  opacity: z.number().min(0).max(1),
  /** Semilla determinista del grano/textura de este trazo. */
  seed: z.number().int(),
  points: z.array(pointSchema).min(1).max(MAX_POINTS_PER_STROKE),
});
export type Stroke = z.infer<typeof strokeSchema>;

export const canvasSchema = z.object({
  width: z.number().int().positive().max(4096),
  height: z.number().int().positive().max(4096),
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type DrawingCanvas = z.infer<typeof canvasSchema>;

export const documentSchema = z.object({
  schemaVersion: z.literal(1),
  canvas: canvasSchema,
  strokes: z.array(strokeSchema).max(MAX_STROKES_PER_DOCUMENT),
});
export type VersionedDrawingDocument = z.infer<typeof documentSchema>;

export function createBlankDocument(
  width: number,
  height: number,
  background = "#FFFFFF",
): VersionedDrawingDocument {
  const doc = {
    schemaVersion: 1 as const,
    canvas: { width, height, background },
    strokes: [],
  };
  return documentSchema.parse(doc);
}

/** Valida y migra documentos viejos al canónico actual. Hoy solo existe v1. */
export function parseDocument(unknownDoc: unknown): VersionedDrawingDocument {
  const parsed = documentSchema.safeParse(unknownDoc);
  if (!parsed.success) throw new Error("Documento de dibujo inválido");
  return parsed.data;
}

function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/**
 * Serializa el documento con pérdida imperceptible para minimizar bytes en R2.
 * Las coordenadas normalizadas se redondean a 4 decimales (≤0.4 px en 4096) y
 * presión/tilt/tamaño/opacidad a 3. El resultado sigue siendo válido para
 * `parseDocument`. Es la representación canónica persistida/publicada.
 */
export function serializeDocument(doc: VersionedDrawingDocument): string {
  const compact = {
    schemaVersion: doc.schemaVersion,
    canvas: doc.canvas,
    strokes: doc.strokes.map((s) => ({
      id: s.id,
      tool: s.tool,
      color: s.color,
      size: roundTo(s.size, 3),
      opacity: roundTo(s.opacity, 3),
      seed: s.seed,
      points: s.points.map((p) => [
        roundTo(p[0], 4),
        roundTo(p[1], 4),
        roundTo(p[2], 3),
        roundTo(p[3], 3),
      ]),
    })),
  };
  return JSON.stringify(compact);
}

/** Config de pincel para un trazo nuevo (UI → engine). */
export interface BrushConfig {
  readonly tool: ToolId;
  readonly color: string;
  readonly size: number;
  readonly opacity: number;
}

export const DEFAULT_BRUSHES: Record<ToolId, BrushConfig> = {
  graphite: { tool: "graphite", color: "#333333", size: 3.2, opacity: 0.82 },
  pencil: { tool: "pencil", color: "#2563eb", size: 4.5, opacity: 0.7 },
  marker: { tool: "marker", color: "#111111", size: 12, opacity: 0.55 },
  "2b": { tool: "2b", color: "#222222", size: 4.2, opacity: 0.9 },
  "2h": { tool: "2h", color: "#444444", size: 2.2, opacity: 0.6 },
  cpencil: { tool: "cpencil", color: "#059669", size: 5, opacity: 0.65 },
  pen: { tool: "pen", color: "#111111", size: 2.6, opacity: 0.95 },
  rotring: { tool: "rotring", color: "#111111", size: 3, opacity: 0.95 },
  spray: { tool: "spray", color: "#333333", size: 14, opacity: 0.5 },
  marker2: { tool: "marker2", color: "#1e40af", size: 12, opacity: 0.5 },
  charcoal: { tool: "charcoal", color: "#1a1a1a", size: 9, opacity: 0.75 },
  hatch: { tool: "hatch", color: "#333333", size: 3, opacity: 0.8 },
};

/** Muestra de puntero normalizada que entra al engine. */
export interface PointerSample {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly tilt: number;
}
