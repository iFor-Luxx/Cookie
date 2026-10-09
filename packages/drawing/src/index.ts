// @cookie/drawing — modelo canónico + DrawingEngine (sin DOM/React).
export const DRAWING_SCHEMA_VERSION = 1 as const;
export type PointerSample = {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly tilt: number;
};
export interface DrawingEngine {
  beginStroke(input: PointerSample, tool: unknown): void;
  appendSamples(samples: readonly PointerSample[]): void;
  endStroke(): string;
  undo(): boolean;
  redo(): boolean;
  dispose(): void;
}
