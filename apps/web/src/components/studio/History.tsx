import { Copy, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, api, type DrawingMeta } from "@/lib/api";

export function History({
  spaceId,
  focusId,
}: {
  spaceId: string;
  focusId: string | null;
}): React.JSX.Element {
  const [items, setItems] = useState<DrawingMeta[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DrawingMeta | null>(null);
  const [copiedSpace, setCopiedSpace] = useState(false);

  const copySpaceId = async (): Promise<void> => {
    await navigator.clipboard.writeText(spaceId).catch(() => undefined);
    setCopiedSpace(true);
  };

  const loadPage = useCallback(
    async (c?: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.timeline(spaceId, c);
        setItems((prev) => (c ? [...prev, ...res.drawings] : res.drawings));
        setCursor(res.nextCursor);
        const entries = await Promise.all(
          res.drawings.map(async (d) => {
            try {
              const blob = await api.previewBytes(d.id);
              return [d.id, URL.createObjectURL(blob)] as const;
            } catch {
              return [d.id, ""] as const;
            }
          }),
        );
        setUrls((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "No se pudo cargar");
      } finally {
        setLoading(false);
      }
    },
    [spaceId],
  );

  useEffect(() => {
    setItems([]);
    setUrls((prev) => {
      for (const u of Object.values(prev)) if (u) URL.revokeObjectURL(u);
      return {};
    });
    void loadPage();
  }, [loadPage]);

  // Deep link del widget (cookie://drawing/{id}): abrir el detalle si existe.
  useEffect(() => {
    if (!focusId) return;
    const found = items.find((d) => d.id === focusId);
    if (found) setSelected(found);
  }, [focusId, items]);

  const remove = async (id: string): Promise<void> => {
    try {
      await api.deleteDrawing(id);
      setSelected(null);
      setItems((prev) => prev.filter((d) => d.id !== id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo borrar");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center justify-between gap-2">
        <p
          className="truncate font-mono text-xs text-muted-foreground"
          title={spaceId}
        >
          Espacio {spaceId.slice(0, 8)}…
        </p>
        <Button variant="ghost" size="sm" onClick={() => void copySpaceId()}>
          <Copy className="size-3" aria-hidden />
          {copiedSpace ? "Copiado" : "ID"}
        </Button>
      </div>
      {items.length === 0 && !loading && (
        <p className="text-center text-sm text-muted-foreground">
          Aún no hay dibujos publicados. Dibuja algo y pulsa Publicar.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => setSelected(d)}
            className="text-left"
          >
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                {urls[d.id] ? (
                  <img
                    src={urls[d.id]}
                    alt={`Dibujo del ${d.createdAt}`}
                    className="aspect-square w-full object-cover"
                  />
                ) : (
                  <Skeleton className="aspect-square w-full" />
                )}
              </CardContent>
            </Card>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {new Date(d.createdAt).toLocaleString()}
            </p>
          </button>
        ))}
      </div>
      {loading && <Skeleton className="h-32 w-full" />}
      {cursor && !loading && (
        <Button variant="secondary" onClick={() => loadPage(cursor)}>
          Cargar más
        </Button>
      )}
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selected && new Date(selected.createdAt).toLocaleString()}
            </DialogTitle>
          </DialogHeader>
          {selected && urls[selected.id] && (
            <img
              src={urls[selected.id]}
              alt="Dibujo ampliado"
              className="w-full rounded-md"
            />
          )}
          <div className="flex justify-end">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => selected && remove(selected.id)}
            >
              <Trash2 className="size-4" aria-hidden /> Borrar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
