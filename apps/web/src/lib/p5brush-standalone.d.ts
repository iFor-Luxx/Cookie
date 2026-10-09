// Declaración ambiental mínima para p5.brush/standalone v2.2.3 (sin tipos
// publicados). Solo la superficie que usa Cookie; ampliar en Fase 2.
declare module "p5.brush/standalone" {
  export type BrushPressure =
    | readonly [number, number]
    | readonly [number, number, number]
    | ((t: number) => number);

  export interface BrushAddParams {
    type: "default" | "spray" | "marker" | "custom" | "image";
    weight: number;
    scatter?: number;
    sharpness?: number;
    grain?: number;
    opacity?: number;
    spacing?: number;
    pressure?: BrushPressure;
    rotate?: "none" | "natural" | "random";
    markerTip?: boolean;
    noise?: number;
  }

  export function add(name: string, params: BrushAddParams): void;
  export function set(name: string, color: string, weight: number): void;
  export function seed(n: number): void;
  export function box(): string[];
  export function scaleBrushes(scale: number): void;
  export function beginStroke(
    mode: "curve" | "segments",
    x: number,
    y: number,
  ): void;
  export function move(angle: number, length: number, pressure: number): void;
  export function endStroke(angle: number, pressure: number): void;
  export function load(target?: HTMLCanvasElement | null): void;
  export function clear(color?: string): void;
  export function render(): void;
}
