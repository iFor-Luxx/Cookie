import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m?.[1]) return null;
  const h =
    m[1].length === 3
      ? m[1]
          .split("")
          .map((c) => c + c)
          .join("")
      : m[1];
  const n = Number.parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r: number, g: number, b: number): string {
  const ch = (v: number): string =>
    clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0");
  return `#${ch(r)}${ch(g)}${ch(b)}`;
}

function rgbToHsv(
  r: number,
  g: number,
  b: number,
): { h: number; s: number; v: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  const v = max;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: s * 100, v: v * 100 };
}

function hsvToRgb(
  h: number,
  s: number,
  v: number,
): { r: number; g: number; b: number } {
  const sn = clamp(s, 0, 100) / 100;
  const vn = clamp(v, 0, 100) / 100;
  const c = vn * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = vn - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

function valueToHsv(value: string): { h: number; s: number; v: number } {
  const rgb = hexToRgb(value);
  if (!rgb) return { h: 210, s: 70, v: 40 };
  return rgbToHsv(rgb.r, rgb.g, rgb.b);
}

interface CustomColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  /** true si el color actual es uno de los presets (el picker muestra arcoíris). */
  presetActive: boolean;
  /** Muestra el editor en flujo dentro del menú en vez de popup absoluto. */
  inline?: boolean;
  /** Abre el editor al montar (para mostrarlo directo en el menú). */
  startOpen?: boolean;
  /** Avisar al cerrar con Escape o toque fuera (para cerrar el menú). */
  onClose?: () => void;
  /** Opacidad del trazo (0-1) para el slider de transparencia. */
  opacity: number;
  onOpacityChange: (opacity: number) => void;
}

export function CustomColorPicker({
  value,
  onChange,
  presetActive,
  inline = false,
  startOpen = false,
  onClose,
  opacity,
  onOpacityChange,
}: CustomColorPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(startOpen);
  const wrapRef = useRef<HTMLDivElement>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<"sv" | "hue" | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const { h, s, v } = valueToHsv(value);
  const hueRgb = hsvToRgb(h, 100, 100);
  const hueHex = rgbToHex(hueRgb.r, hueRgb.g, hueRgb.b);
  const previewRgb = hexToRgb(value) ?? { r: 0, g: 0, b: 0 };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        onCloseRef.current?.();
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setOpen(false);
        onCloseRef.current?.();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pickSv = useCallback(
    (clientX: number, clientY: number) => {
      const el = svRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const ns = clamp(((clientX - r.left) / r.width) * 100, 0, 100);
      const nv = clamp(100 - ((clientY - r.top) / r.height) * 100, 0, 100);
      const { r: rr, g: gg, b: bb } = hsvToRgb(h, ns, nv);
      onChange(rgbToHex(rr, gg, bb));
    },
    [h, onChange],
  );

  const pickHue = useCallback(
    (clientX: number) => {
      const el = hueRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const nh = clamp(((clientX - r.left) / r.width) * 360, 0, 360);
      const { r: rr, g: gg, b: bb } = hsvToRgb(nh, s, v);
      onChange(rgbToHex(rr, gg, bb));
    },
    [s, v, onChange],
  );

  useEffect(() => {
    if (!open) return;
    const move = (e: PointerEvent): void => {
      if (dragging.current === "sv") pickSv(e.clientX, e.clientY);
      else if (dragging.current === "hue") pickHue(e.clientX);
    };
    const up = (): void => {
      dragging.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [open, pickSv, pickHue]);

  return (
    <div
      ref={wrapRef}
      className={inline ? "block w-full" : "relative flex shrink-0"}
    >
      {(!inline || !open) && (
        <button
          type="button"
          title="Color personalizado"
          aria-label="Color personalizado"
          aria-expanded={open}
          aria-pressed={!presetActive}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "size-7 shrink-0 rounded-full border transition-transform",
            !presetActive
              ? "scale-110 border-ring ring-2 ring-ring/40"
              : "border-border",
          )}
          style={
            presetActive
              ? {
                  background:
                    "conic-gradient(#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
                }
              : { backgroundColor: value }
          }
        />
      )}
      {open && (
        <div
          role="dialog"
          aria-label="Selector de color personalizado"
          className={
            inline
              ? "static mt-2 w-full rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-md"
              : "absolute top-full left-0 z-50 mt-2 w-60 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-md"
          }
        >
          <div
            ref={svRef}
            role="slider"
            tabIndex={0}
            aria-label="Saturación y brillo"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(s)}
            aria-valuetext={`saturación ${Math.round(s)}, brillo ${Math.round(v)}`}
            onPointerDown={(e) => {
              e.preventDefault();
              dragging.current = "sv";
              pickSv(e.clientX, e.clientY);
            }}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 10 : 2;
              if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                e.preventDefault();
                const ns = clamp(
                  s + (e.key === "ArrowRight" ? step : -step),
                  0,
                  100,
                );
                const { r: rr, g: gg, b: bb } = hsvToRgb(h, ns, v);
                onChange(rgbToHex(rr, gg, bb));
              } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                const nv = clamp(
                  v + (e.key === "ArrowUp" ? step : -step),
                  0,
                  100,
                );
                const { r: rr, g: gg, b: bb } = hsvToRgb(h, s, nv);
                onChange(rgbToHex(rr, gg, bb));
              }
            }}
            className="relative h-36 w-full cursor-crosshair touch-none rounded-md border border-border"
            style={{
              background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), ${hueHex}`,
            }}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
              style={{
                left: `${s}%`,
                top: `${100 - v}%`,
                backgroundColor: value,
              }}
            />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span
              aria-hidden
              className="size-7 shrink-0 rounded-full border border-border"
              style={{ backgroundColor: value }}
            />
            <div
              ref={hueRef}
              role="slider"
              tabIndex={0}
              aria-label="Tono"
              aria-valuemin={0}
              aria-valuemax={360}
              aria-valuenow={Math.round(h)}
              aria-valuetext={`tono ${Math.round(h)}`}
              onPointerDown={(e) => {
                e.preventDefault();
                dragging.current = "hue";
                pickHue(e.clientX);
              }}
              onKeyDown={(e) => {
                const step = e.shiftKey ? 20 : 4;
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  const nh =
                    (h + (e.key === "ArrowRight" ? step : -step) + 360) % 360;
                  const { r: rr, g: gg, b: bb } = hsvToRgb(nh, s, v);
                  onChange(rgbToHex(rr, gg, bb));
                }
              }}
              className="relative h-3 flex-1 cursor-pointer touch-none rounded-full"
              style={{
                background:
                  "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
              }}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
                style={{ left: `${(h / 360) * 100}%`, backgroundColor: hueHex }}
              />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span
              aria-hidden
              title="Vista previa"
              className="size-7 shrink-0 rounded-full border border-border"
              style={{
                background: `linear-gradient(rgba(${previewRgb.r}, ${previewRgb.g}, ${previewRgb.b}, ${opacity}), rgba(${previewRgb.r}, ${previewRgb.g}, ${previewRgb.b}, ${opacity})), conic-gradient(#d1d5db 25%, #ffffff 0 50%, #d1d5db 0 75%, #ffffff 0)`,
                backgroundSize: "auto, 10px 10px",
              }}
            />
            <span className="relative flex h-5 flex-1 items-center">
              <span
                aria-hidden
                className="absolute inset-x-0 h-2.5 rounded-full"
                style={{
                  background: `linear-gradient(to right, rgba(${previewRgb.r}, ${previewRgb.g}, ${previewRgb.b}, 0.05), rgb(${previewRgb.r}, ${previewRgb.g}, ${previewRgb.b})), conic-gradient(#d1d5db 25%, #ffffff 0 50%, #d1d5db 0 75%, #ffffff 0)`,
                  backgroundSize: "auto, 8px 8px",
                }}
              />
              <input
                type="range"
                min={5}
                max={100}
                step={1}
                value={Math.round(opacity * 100)}
                aria-label="Opacidad del trazo"
                onChange={(e) =>
                  onOpacityChange(
                    Math.round(Number(e.target.value)) / 100,
                  )
                }
                className="relative h-5 w-full cursor-pointer appearance-none bg-transparent [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-white/90 [&::-moz-range-thumb]:shadow-[0_0_0_1px_rgba(0,0,0,0.4)] [&::-moz-range-track]:h-2.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:h-2.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:mt-[-3px] [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-white/90 [&::-webkit-slider-thumb]:shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
              />
            </span>
            <span className="w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
              {Math.round(opacity * 100)}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
