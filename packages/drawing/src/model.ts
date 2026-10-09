// @cookie/drawing — modelo canónico del documento (SDD §7). Geometría
// normalizada 0..1, sin referencias DOM. `schemaVersion: 1`.
import { z } from "zod";

export const DRAWING_SCHEMA_VERSION = 1 as const;
/** Límite MVP: puntos por trazo (acota memoria/interpolación). */
export const MAX_POINTS_PER_STROKE = 4096 as const;
/** Límite MVP: trazos por documento (acota render/export). */
export const MAX_STROKES_PER_DOCUMENT = 512 as const;

export const toolSchema = z.enum(["graphite", "pencil", "marker"]);
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
};

/** Muestra de puntero normalizada que entra al engine. */
export interface PointerSample {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly tilt: number;
}
