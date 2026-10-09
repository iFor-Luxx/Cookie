// Adapter Canvas 2D real (navegador/WebView). Capas las gestiona el componente.
import type { RenderTarget } from "./renderer";

export function canvas2dTarget(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): RenderTarget {
  return {
    width,
    height,
    clear(background: string): void {
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    },
    segment(
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      w0: number,
      w1: number,
      color: string,
      alpha: number,
    ): void {
      ctx.save();
      ctx.globalAlpha = Math.min(1, Math.max(0, alpha));
      ctx.strokeStyle = color;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      // Taper: dos mitades con anchos interpolados.
      ctx.lineWidth = w0;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo((x0 + x1) / 2, (y0 + y1) / 2);
      ctx.stroke();
      ctx.lineWidth = w1;
      ctx.beginPath();
      ctx.moveTo((x0 + x1) / 2, (y0 + y1) / 2);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.restore();
    },
    stamp(x: number, y: number, r: number, color: string, alpha: number): void {
      ctx.save();
      ctx.globalAlpha = Math.min(1, Math.max(0, alpha));
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
  };
}
