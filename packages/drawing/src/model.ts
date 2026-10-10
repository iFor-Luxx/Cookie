// @cookie/drawing — modelo canónico del documento (SDD §7). Geometría
// normalizada 0..1, sin referencias DOM. `schemaVersion: 1`.
import { z } from "zod";

export const DRAWING_SCHEMA_VERSION = 1 as const;
/** Límite MVP: puntos por trazo (acota memoria/interpolación). */
export const MAX_POINTS_PER_STROKE = 4096 as const;
/** Límite MVP: trazos por documento (acota render/export). */
export const MAX_STROKES_PER_DOCUMENT = 512 as const;

export const toolSchema = z.enum(["pencil", "marker", "cpencil", "pen"]);
export type ToolId = z.infer<typeof toolSchema>;

/** Herramientas legacy (v1 con 14 pinceles) → equivalente actual. */
const LEGACY_TOOL_MAP: Record<string, ToolId> = {
  graphite: "pencil",
  "2b": "pencil",
  "2h": "pen",
  charcoal: "pencil",
  hatch: "pen",
  rotring: "pen",
  spray: "marker",
  marker2: "marker",
  watercolor: "marker",
  smudge: "pencil",
};

/**
 * Mapeo físico → ToolId (nombres congelados: NO renombrar).
 * Solo 4 herramientas, cada una con receta propia validada:
 *
 * - lápiz de color (cera) → `pencil`: capas translúcidas + burnish con
 *   brillo a presión alta.
 * - rotulador (punta bala) → `marker`: pleno jugoso por acumulación,
 *   sangrado leve, gotas a presión fuerte.
 * - fibra (fineliner/fieltro) → `cpencil`: abanico de 6 micro-cerdas con
 *   calvas secas, nunca motas.
 * - pluma (estilográfica/stub) → `pen`: ancho por DIRECCIÓN (stub
 *   horizontal), shading de tinta, hambre en subidas leves.
 */

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

/** Valida y migra documentos viejos al canónico actual. Migra las 10
 * herramientas legacy eliminadas a su equivalente actual (mismo color,
 * tamaño, opacidad, semilla y puntos: solo cambia el `tool`). */
export function parseDocument(unknownDoc: unknown): VersionedDrawingDocument {
  if (
    typeof unknownDoc === "object" &&
    unknownDoc !== null &&
    "strokes" in unknownDoc &&
    Array.isArray((unknownDoc as { strokes: unknown }).strokes)
  ) {
    const doc = unknownDoc as {
      strokes: Array<{ tool?: unknown } & Record<string, unknown>>;
    };
    for (const s of doc.strokes) {
      if (typeof s.tool === "string" && s.tool in LEGACY_TOOL_MAP) {
        s.tool = LEGACY_TOOL_MAP[s.tool];
      }
    }
  }
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
  pencil: { tool: "pencil", color: "#2563eb", size: 6, opacity: 0.8 },
  marker: { tool: "marker", color: "#111111", size: 13, opacity: 0.95 },
  cpencil: { tool: "cpencil", color: "#059669", size: 5, opacity: 0.75 },
  pen: { tool: "pen", color: "#111111", size: 3, opacity: 0.95 },
};

/** Muestra de puntero normalizada que entra al engine. */
export interface PointerSample {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly tilt: number;
}
