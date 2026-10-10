import { useCallback, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
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
}

export function CustomColorPicker({
  value,
  onChange,
  presetActive,
}: CustomColorPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<"sv" | "hue" | null>(null);

  const { h, s, v } = valueToHsv(value);
  const hueRgb = hsvToRgb(h, 100, 100);
  const hueHex = rgbToHex(hueRgb.r, hueRgb.g, hueRgb.b);
  const rgb = hexToRgb(value) ?? { r: 0, g: 0, b: 0 };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
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

  const commitRgb = (part: "r" | "g" | "b", raw: string): void => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const next = { ...rgb, [part]: clamp(Math.round(n), 0, 255) };
    onChange(rgbToHex(next.r, next.g, next.b));
  };

  const commitHex = (raw: string): void => {
    const clean = raw.trim().startsWith("#") ? raw.trim() : `#${raw.trim()}`;
    if (hexToRgb(clean)) onChange(clean.toLowerCase());
  };

  return (
    <div ref={wrapRef} className="relative flex shrink-0">
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
      {open && (
        <div
          role="dialog"
          aria-label="Selector de color personalizado"
          className="absolute top-full left-0 z-50 mt-2 w-60 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-md"
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
          <div className="mt-3 grid grid-cols-3 gap-2">
            {(["r", "g", "b"] as const).map((part) => (
              <label
                key={part}
                htmlFor={`custom-color-${part}`}
                className="flex flex-col items-center gap-1 text-xs text-muted-foreground uppercase"
              >
                <Input
                  id={`custom-color-${part}`}
                  key={`${part}-${rgb[part]}`}
                  defaultValue={rgb[part]}
                  inputMode="numeric"
                  aria-label={`Componente ${part.toUpperCase()}`}
                  className="h-8 text-center tabular-nums"
                  onBlur={(e) => commitRgb(part, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      commitRgb(part, e.currentTarget.value);
                      e.currentTarget.blur();
                    }
                  }}
                />
                {part.toUpperCase()}
              </label>
            ))}
          </div>
          <label
            htmlFor="custom-color-hex"
            className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"
          >
            Hex
            <Input
              id="custom-color-hex"
              key={value}
              defaultValue={value}
              aria-label="Color en hexadecimal"
              spellCheck={false}
              className="h-8 font-mono lowercase"
              onBlur={(e) => commitHex(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  commitHex(e.currentTarget.value);
                  e.currentTarget.blur();
                }
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}
