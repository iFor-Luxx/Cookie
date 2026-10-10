import { forwardRef, useImperativeHandle, useRef } from "react";
import { cn } from "@/lib/utils";
import { drawRibbonFrame } from "./wipe-2d";
import type { WipeParams } from "./wipe-math";

/**
 * Cinta del fallback 2D (sin WebGPU). Transparente fuera de la franja.
 */
export interface WipeCanvas2dHandle {
  draw(params: WipeParams, eased: number): void;
}

export const WipeCanvas2d = forwardRef<
  WipeCanvas2dHandle,
  { className?: string }
>(function WipeCanvas2d({ className }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useImperativeHandle(ref, () => ({
    draw(params, eased) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = Math.min(globalThis.devicePixelRatio || 1, 1.5);
      const width = Math.max(Math.round(canvas.clientWidth * dpr), 1);
      const height = Math.max(Math.round(canvas.clientHeight * dpr), 1);
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      drawRibbonFrame(ctx, width, height, params, eased);
    },
  }));

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn("block size-full", className)}
    />
  );
});
