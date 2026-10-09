import qrcode from "qrcode-generator";
import { useEffect, useRef, useState } from "react";

/** Pinta un payload QR (invitación o entrada) para escanear con el otro dispositivo. */
export function InviteQr({
  payload,
  label,
}: {
  payload: string;
  label: string;
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const qr = qrcode(0, "M");
      qr.addData(payload);
      qr.make();
      const count = qr.getModuleCount();
      const quiet = 4;
      const cell = 6;
      const size = (count + quiet * 2) * cell;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setFailed(true);
        return;
      }
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = "#000000";
      for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
          if (qr.isDark(r, c)) {
            ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
          }
        }
      }
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [payload]);

  if (failed) {
    return (
      <p className="text-sm text-muted-foreground">
        No se pudo dibujar el QR. Usa el código de abajo.
      </p>
    );
  }
  return (
    <canvas
      ref={canvasRef}
      className="h-48 w-48 rounded-md border"
      aria-label={label}
    />
  );
}
