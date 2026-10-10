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
    stampEllipse(
      x: number,
      y: number,
      rx: number,
      ry: number,
      rot: number,
      color: string,
      alpha: number,
    ): void {
      ctx.save();
      ctx.globalAlpha = Math.min(1, Math.max(0, alpha));
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(
        x,
        y,
        Math.max(0.1, rx),
        Math.max(0.1, ry),
        rot,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.restore();
    },
    hairline(
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      w: number,
      color: string,
      alpha: number,
    ): void {
      ctx.save();
      ctx.globalAlpha = Math.min(1, Math.max(0, alpha));
      ctx.strokeStyle = color;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(0.5, w);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.restore();
    },
    smear(
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      w: number,
      strength: number,
    ): void {
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      if (len < 0.01 || w < 0.5) return;
      // Arrastre real: copia la zona ya pintada desplazada hacia atrás
      // a lo largo del trazo + blur leve, dentro del clip del fieltro.
      const ux = dx / len;
      const uy = dy / len;
      const shift = Math.min(3, Math.max(1, w * 0.15));
      ctx.save();
      ctx.beginPath();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(0.5, w);
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.clip();
      ctx.globalAlpha = Math.min(0.35, Math.max(0, strength));
      try {
        ctx.filter = "blur(1px)";
      } catch {
        // WebView sin filter: sigue el arrastre sin blur.
      }
      const src = ctx.canvas;
      ctx.drawImage(src, -ux * shift, -uy * shift);
      ctx.restore();
    },
    band(
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      w0: number,
      w1: number,
      color: string,
      alpha: number,
    ): void {
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      ctx.save();
      ctx.globalAlpha = Math.min(1, Math.max(0, alpha));
      ctx.fillStyle = color;
      ctx.beginPath();
      if (len < 0.01) {
        ctx.arc(x0, y0, Math.max(0.1, w0 / 2), 0, Math.PI * 2);
      } else {
        const nx = -dy / len;
        const ny = dx / len;
        ctx.moveTo(x0 + (nx * w0) / 2, y0 + (ny * w0) / 2);
        ctx.lineTo(x1 + (nx * w1) / 2, y1 + (ny * w1) / 2);
        ctx.lineTo(x1 - (nx * w1) / 2, y1 - (ny * w1) / 2);
        ctx.lineTo(x0 - (nx * w0) / 2, y0 - (ny * w0) / 2);
        ctx.closePath();
      }
      ctx.fill();
      ctx.restore();
    },
  };
}
