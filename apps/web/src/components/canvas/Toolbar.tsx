import type { BrushConfig, ToolId } from "@cookie/drawing";
import { Brush, Highlighter, Pencil, Redo2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const TOOLS: Array<{ id: ToolId; label: string; icon: typeof Pencil }> = [
  { id: "graphite", label: "Grafito", icon: Pencil },
  { id: "pencil", label: "Lápiz de color", icon: Brush },
  { id: "marker", label: "Rotulador", icon: Highlighter },
];

const COLORS = [
  "#333333",
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
}

export function Toolbar({
  brush,
  onBrush,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: ToolbarProps): React.JSX.Element {
  return (
    <div
      className="flex flex-wrap items-center justify-center gap-2"
      role="toolbar"
      aria-label="Herramientas de dibujo"
    >
      {TOOLS.map(({ id, label, icon: Icon }) => (
        <Button
          key={id}
          variant={brush.tool === id ? "default" : "outline"}
          size="sm"
          aria-pressed={brush.tool === id}
          aria-label={label}
          title={label}
          onClick={() => onBrush({ ...brush, tool: id })}
          className={cn(brush.tool === id && "font-pixel")}
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </Button>
      ))}
      <Separator orientation="vertical" className="h-6" />
      <fieldset className="flex items-center gap-1">
        <legend className="sr-only">Color</legend>
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Color ${c}`}
            aria-pressed={brush.color === c}
            onClick={() => onBrush({ ...brush, color: c })}
            className={cn(
              "size-7 rounded-full border transition-transform",
              brush.color === c
                ? "scale-110 border-ring ring-2 ring-ring/40"
                : "border-border",
            )}
            style={{ backgroundColor: c }}
          />
        ))}
      </fieldset>
      <Separator orientation="vertical" className="h-6" />
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        Tamaño
        <input
          type="range"
          min={1}
          max={48}
          step={0.5}
          value={brush.size}
          aria-label="Tamaño del trazo"
          onChange={(e) => onBrush({ ...brush, size: Number(e.target.value) })}
          className="w-28 accent-primary"
        />
        <span className="w-8 text-right tabular-nums">{brush.size}</span>
      </label>
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
    </div>
  );
}
