import type { BrushConfig, ToolId } from "@cookie/drawing";
import {
  Brush,
  Highlighter,
  Paintbrush,
  Pen,
  Redo2,
  Undo2,
  X,
} from "lucide-react";
import { useState } from "react";
import { CustomColorPicker } from "@/components/canvas/CustomColorPicker";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const TOOLS: Array<{ id: ToolId; label: string; icon: typeof Brush }> = [
  { id: "marker", label: "Rotulador", icon: Highlighter },
  { id: "pen", label: "Pluma", icon: Pen },
  { id: "pencil", label: "Lápiz de color", icon: Brush },
  { id: "cpencil", label: "Fibra", icon: Paintbrush },
];

const COLORS = [
  "#111111",
  "#2563eb",
  "#dc2626",
  "#059669",
  "#d97706",
  "#7c3aed",
];

interface ToolbarProps {
  brush: BrushConfig;
  onBrush: (b: BrushConfig) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Oculta deshacer/rehacer (cuando ya viven en la barra superior). */
  hideHistoryActions?: boolean;
}

export function Toolbar({
  brush,
  onBrush,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  hideHistoryActions = false,
}: ToolbarProps): React.JSX.Element | null {
  const [panelOpen, setPanelOpen] = useState(false);
  const [pickerFirst, setPickerFirst] = useState(false);
  const current = TOOLS.find((t) => t.id === brush.tool) ?? TOOLS[0];
  if (current === undefined) return null;
  const CurrentIcon = current.icon;
  const toggle = (): void => setPanelOpen((v) => !v);
  const openBrushes = (): void => {
    setPickerFirst(false);
    setPanelOpen(true);
  };
  const openPicker = (): void => {
    setPickerFirst(true);
    setPanelOpen(true);
  };
  return (
    <div className="flex flex-col items-stretch gap-2">
      {panelOpen && (
        <div className="flex flex-col gap-3 rounded-2xl bg-muted/70 p-3 animate-[fade-in_0.25s_ease-out_both]">
          <div className="flex items-center justify-between">
            <p className="font-pixel text-xs tracking-widest text-muted-foreground uppercase">
              {pickerFirst ? "Color personalizado" : "Tipos de lápiz"}
            </p>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Cerrar herramientas"
              onClick={toggle}
              className="h-7 w-7"
            >
              <X className="size-4" aria-hidden />
            </Button>
          </div>
          {pickerFirst ? (
            <div
              key="panel-color"
              className="animate-[fade-in_0.25s_ease-out_both]"
            >
              <CustomColorPicker
                inline
                startOpen
                value={brush.color}
                presetActive={COLORS.includes(brush.color)}
                onChange={(color) => onBrush({ ...brush, color })}
                onClose={() => setPanelOpen(false)}
                opacity={brush.opacity}
                onOpacityChange={(opacity) => onBrush({ ...brush, opacity })}
              />
            </div>
          ) : (
            <div
              key="panel-brushes"
              className="grid grid-cols-2 gap-2 animate-[fade-in_0.25s_ease-out_both]"
            >
              {TOOLS.map(({ id, label, icon: Icon }) => (
                <Button
                  key={id}
                  variant={brush.tool === id ? "default" : "outline"}
                  aria-pressed={brush.tool === id}
                  aria-label={label}
                  title={label}
                  onClick={() => {
                    onBrush({ ...brush, tool: id });
                    setPanelOpen(false);
                  }}
                  className="justify-start"
                >
                  <Icon className="size-4" aria-hidden />
                  {label}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
      <div
        className="flex flex-wrap items-center justify-center gap-x-2 gap-y-2"
        role="toolbar"
        aria-label="Herramientas de dibujo"
      >
        <Button
          variant="default"
          size="sm"
          aria-expanded={panelOpen}
          aria-label={`Pincel actual: ${current.label}. Abrir tipos de lápiz`}
          title="Tipos de lápiz"
          onClick={openBrushes}
        >
          <CurrentIcon className="size-4" aria-hidden />
          {current.label}
        </Button>
        <Separator orientation="vertical" className="h-6" />
        <fieldset className="flex min-w-0 items-center gap-1">
          <legend className="sr-only">Color</legend>
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              aria-pressed={brush.color === c}
              onClick={() => onBrush({ ...brush, color: c })}
              className={cn(
                "size-6 shrink-0 rounded-full border transition-transform",
                brush.color === c
                  ? "scale-110 border-ring ring-2 ring-ring/40"
                  : "border-border",
              )}
              style={{ backgroundColor: c }}
            />
          ))}
          <button
            type="button"
            aria-label="Color personalizado. Abrir en el menú"
            title="Color personalizado"
            onClick={openPicker}
            className={cn(
              "size-6 shrink-0 rounded-full border transition-transform",
              !COLORS.includes(brush.color)
                ? "scale-110 border-ring ring-2 ring-ring/40"
                : "border-border",
            )}
            style={{
              background:
                "conic-gradient(#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
            }}
          />
        </fieldset>
        <Separator orientation="vertical" className="h-6" />
        <label className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
          Tamaño
          <input
            type="range"
            min={1}
            max={48}
            step={0.5}
            value={brush.size}
            aria-label="Tamaño del trazo"
            onChange={(e) => onBrush({ ...brush, size: Number(e.target.value) })}
            className="w-24 accent-primary"
          />
          <span className="w-8 text-right tabular-nums">{brush.size}</span>
        </label>
        {!hideHistoryActions && (
          <>
            <Separator orientation="vertical" className="h-6" />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Deshacer"
              disabled={!canUndo}
              onClick={onUndo}
            >
              <Undo2 className="size-4" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Rehacer"
              disabled={!canRedo}
              onClick={onRedo}
            >
              <Redo2 className="size-4" aria-hidden />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
