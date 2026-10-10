import {
  type BrushConfig,
  createDrawingEngine,
  DEFAULT_BRUSHES,
  serializeDocument,
} from "@cookie/drawing";
import { createDraftStore, indexedDbBackend } from "@cookie/platform-web";
import { ArrowLeft, Frame, Hand, LogOut, Pen, Redo2, RefreshCw, Undo2 } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CanvasBoard, type CanvasMode, type SaveState } from "@/components/canvas/CanvasBoard";
import { Toolbar } from "@/components/canvas/Toolbar";
import { LoginQrDialog } from "@/components/studio/LoginQrDialog";
import { Onboarding } from "@/components/studio/Onboarding";
import { SpaceSetup } from "@/components/studio/SpaceSetup";
import { BrandWipe } from "@/components/studio/wipe/BrandWipe";
import { EXIT_WIPE } from "@/components/studio/wipe/wipe-math";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { installDeepLinkListener } from "@/lib/deep-link";
import { saveLastSpaceId } from "@/lib/last-space";
import {
  installSessionMirror,
  setNativeSpace,
  uploadFcmTokenIfPresent,
} from "@/lib/native-session";
import {
  RealtimeClient,
  reconcileSpace,
  setSyncSpace,
  syncEngine,
} from "@/lib/sync";

const DRAFT_ID = "local";

// H7: Historial fuera del chunk inicial (solo se carga al abrir la pestaña).
const History = lazy(() =>
  import("@/components/studio/History").then((m) => ({ default: m.History })),
);

type Screen = "boot" | "onboarding" | "setup" | "studio";

const SAVE_LABEL: Record<SaveState, string> = {
  saved: "Borrador guardado",
  saving: "Guardando…",
  local: "Solo local",
};

export function App(): React.JSX.Element {
  const engine = useMemo(
    () =>
      createDrawingEngine({ width: 1024, height: 1024, background: "#FFFFFF" }),
    [],
  );
  const draftStore = useMemo(() => createDraftStore(indexedDbBackend()), []);
  const [screen, setScreen] = useState<Screen>("boot");
  const [spaceId, setSpaceId] = useState<string | null>(null);
  // Entrada al estudio con barrido de salida (135°): el estudio se
  // monta detrás del overlay y el wipe lo revela.
  const [entering, setEntering] = useState<string | null>(null);
  const [tab, setTab] = useState("historial");
  const [brush, setBrush] = useState<BrushConfig>(DEFAULT_BRUSHES.marker);
  const [canvasMode, setCanvasMode] = useState<CanvasMode>("draw");
  const [viewReset, setViewReset] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [saveState, setSaveState] = useState<SaveState>("local");
  const [, setVersion] = useState(0);
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);
  const [historyKey, setHistoryKey] = useState(0);
  const [focusDrawing, setFocusDrawing] = useState<string | null>(null);
  const realtimeRef = useRef<RealtimeClient | null>(null);

  // Sin dispose al desmontar: el motor es singleton de la sesión (useMemo).
  // Con StrictMode el desmontaje simulado lo mataría (disposed=true) sin
  // recrearlo, dejando el lienzo mudo sin ningún error. La página al
  // cerrarse limpia sola.

  // Puente nativo (una vez): espejo de sesión para el worker + deep links.
  useEffect(() => {
    installSessionMirror();
    installDeepLinkListener((drawingId) => {
      setFocusDrawing(drawingId);
      setTab("historial");
    });
  }, []);

  useEffect(() => {
    if (!api.loggedIn) {
      setScreen("onboarding");
      return;
    }
    api
      .me()
      .then((me) => {
        if (me.pairSpaceId) {
          setSpaceId(me.pairSpaceId);
          setScreen("studio");
        } else {
          setScreen("setup");
        }
      })
      .catch(() => setScreen("onboarding"));
  }, []);

  // Último espacio conocido (rellena la recuperación, nunca memorizar UUID).
  useEffect(() => {
    if (spaceId) saveLastSpaceId(spaceId);
  }, [spaceId]);

  // Sync + realtime vivos solo en studio.
  useEffect(() => {
    if (screen !== "studio" || !spaceId) return;
    setSyncSpace(spaceId);
    setNativeSpace(spaceId);
    void uploadFcmTokenIfPresent();
    const unsub = syncEngine.subscribe((s) => {
      setPending(s.pending);
      setFailed(s.failed);
    });
    void syncEngine.pump();
    const client = new RealtimeClient(spaceId, {
      onRemoteEvents: (events) => {
        setHistoryKey((k) => k + 1);
        if (events.some((e) => e.type === "drawing.created")) {
          toast("Nuevo dibujo en el historial");
        }
      },
      onSnapshot: () => setHistoryKey((k) => k + 1),
    });
    realtimeRef.current = client;
    client.start();
    // Al entrar, reconciliar por si entraron dibujos con la app cerrada.
    void reconcileSpace(spaceId).then((r) => {
      if (r.snapshot || r.applied.length > 0) setHistoryKey((k) => k + 1);
    });
    const onOnline = (): void => {
      void syncEngine.pump();
      void client.refresh();
    };
    window.addEventListener("online", onOnline);
    const timer = window.setInterval(() => void syncEngine.pump(), 10_000);
    return () => {
      unsub();
      client.stop();
      realtimeRef.current = null;
      setNativeSpace(null);
      window.removeEventListener("online", onOnline);
      window.clearInterval(timer);
    };
  }, [screen, spaceId]);

  const publish = async (): Promise<void> => {
    try {
      const doc = engine.exportDocument();
      if (doc.strokes.length === 0) {
        toast.error("Dibuja algo primero");
        return;
      }
      // Outbox durable: sobrevive offline y reintentos sin duplicar
      // (misma mutationId como Idempotency-Key).
      await syncEngine.enqueue(
        serializeDocument(doc),
        doc.canvas.width,
        doc.canvas.height,
      );
      toast("En cola para publicar");
      await syncEngine.pump();
      setHistoryKey((k) => k + 1);
      setTab("historial");
    } catch {
      toast.error("No se pudo encolar");
    }
  };

  if (screen === "boot") {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <p className="font-pixel text-sm text-muted-foreground">Cargando…</p>
      </main>
    );
  }
  if (screen === "onboarding") {
    return (
      <Onboarding
        onDone={(id) => {
          if (id) {
            setSpaceId(id);
            setScreen("studio");
          } else {
            setScreen("setup");
          }
        }}
      />
    );
  }
  // Pantalla del estudio como nodo reutilizable: en la entrada normal
  // se renderiza sola; en el wipe de salida va recortada tras el
  // overlay mientras el setup sigue vivo debajo.
  const renderStudio = (id: string): React.JSX.Element => (
    <main className="min-h-dvh bg-background text-foreground">
      <Toaster />
      {tab === "lienzo" ? (
        <div className="relative flex h-dvh flex-col overflow-hidden">
          <div className="pointer-events-none absolute inset-x-0 top-4 z-20 flex justify-center px-4">
            <div className="liquid-glass pointer-events-auto flex w-full max-w-3xl items-center justify-between gap-2 rounded-full py-1.5 pr-1.5 pl-1.5 shadow-lg">
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  aria-label="Salir al historial"
                  title="Salir al historial"
                  onClick={() => setTab("historial")}
                  className="rounded-full bg-red-500 text-white shadow-sm hover:bg-red-500/90"
                >
                  <ArrowLeft className="size-4" aria-hidden />
                  Salir
                </Button>
                <Button
                  size="icon"
                  variant="secondary"
                  aria-label="Deshacer"
                  disabled={!engine.canUndo()}
                  onClick={() => {
                    engine.undo();
                    setVersion((v) => v + 1);
                  }}
                  className="size-8 rounded-full"
                >
                  <Undo2 className="size-4" aria-hidden />
                </Button>
                <Button
                  size="icon"
                  variant="secondary"
                  aria-label="Rehacer"
                  disabled={!engine.canRedo()}
                  onClick={() => {
                    engine.redo();
                    setVersion((v) => v + 1);
                  }}
                  className="size-8 rounded-full"
                >
                  <Redo2 className="size-4" aria-hidden />
                </Button>
              </div>
              <Button
                size="sm"
                className="rounded-full"
                onClick={publish}
              >
                Enviar
              </Button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-4 pt-24 pb-36">
            <CanvasBoard
              engine={engine}
              brush={brush}
              draftStore={draftStore}
              draftId={DRAFT_ID}
              dashed
              mode={canvasMode}
              resetViewSignal={viewReset}
              onZoom={setZoom}
              onSaveState={setSaveState}
              onStrokesVersion={() => setVersion((v) => v + 1)}
            />
          </div>
          <div className="fixed bottom-8 left-1/2 z-20 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 justify-center">
            <div className="liquid-glass flex max-w-full flex-col items-center gap-1 rounded-3xl px-4 py-2 shadow-lg">
              <div
                className="flex items-center gap-1"
                role="toolbar"
                aria-label="Modo del lienzo"
              >
                <Button
                  variant={canvasMode === "pan" ? "default" : "ghost"}
                  size="sm"
                  aria-pressed={canvasMode === "pan"}
                  onClick={() => setCanvasMode("pan")}
                  className="rounded-full"
                >
                  <Hand className="size-4" aria-hidden />
                  Mover
                </Button>
                <Button
                  variant={canvasMode === "draw" ? "default" : "ghost"}
                  size="sm"
                  aria-pressed={canvasMode === "draw"}
                  onClick={() => setCanvasMode("draw")}
                  className="rounded-full"
                >
                  <Pen className="size-4" aria-hidden />
                  Pintar
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Centrar vista"
                  title="Centrar vista"
                  onClick={() => setViewReset((n) => n + 1)}
                  className="size-8 rounded-full"
                >
                  <Frame className="size-4" aria-hidden />
                </Button>
                <span
                  aria-live="polite"
                  title="Nivel de zoom"
                  className="w-12 shrink-0 text-center text-xs text-muted-foreground tabular-nums"
                >
                  {Math.round(((zoom - 1) / 7) * 100)}%
                </span>
              </div>
              <Toolbar
                brush={brush}
                onBrush={setBrush}
                canUndo={engine.canUndo()}
                canRedo={engine.canRedo()}
                onUndo={() => {
                  engine.undo();
                  setVersion((v) => v + 1);
                }}
                onRedo={() => {
                  engine.redo();
                  setVersion((v) => v + 1);
                }}
                hideHistoryActions
              />
            </div>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-1 z-10 flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
            <span>
              {SAVE_LABEL[saveState]}
              {pending > 0 && ` · ${pending} pendiente`}
            </span>
            {failed > 0 && (
              <Button
                variant="link"
                size="sm"
                onClick={() => void syncEngine.retryAllFailed()}
                className="pointer-events-auto h-auto p-0 text-[11px]"
              >
                <RefreshCw className="size-3" aria-hidden /> Reintentar (
                {failed})
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-8">
          <>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <LoginQrDialog />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Cerrar sesión"
                  onClick={() => {
                    realtimeRef.current?.stop();
                    setSyncSpace(null);
                    api.logout();
                    setScreen("onboarding");
                  }}
                >
                  <LogOut className="size-4" aria-hidden />
                </Button>
              </div>
              <Button
                className="rounded-full"
                onClick={() => setTab("lienzo")}
              >
                Dibujar
              </Button>
            </div>
            <h2 className="font-pixel text-sm tracking-widest text-muted-foreground uppercase">
              Historial:
            </h2>
            <Suspense
              fallback={
                <p className="text-sm text-muted-foreground">
                  Cargando historial…
                </p>
              }
            >
              <History key={historyKey} spaceId={id} focusId={focusDrawing} />
            </Suspense>
          </>
        </div>
      )}
    </main>
  );

  if (screen === "setup" || !spaceId) {
    return (
      <>
        <SpaceSetup
          onDone={(nextId) => {
            setSpaceId(nextId);
            setScreen("studio");
          }}
          onEnter={(nextId) => {
            // Movimiento reducido: entrar directo sin barrido.
            if (
              typeof window !== "undefined" &&
              typeof window.matchMedia === "function" &&
              window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ) {
              setSpaceId(nextId);
              setScreen("studio");
              return;
            }
            setEntering(nextId);
          }}
        />
        {entering && (
          <BrandWipe
            to={renderStudio(entering)}
            params={EXIT_WIPE}
            onDone={() => {
              setSpaceId(entering);
              setScreen("studio");
              setEntering(null);
            }}
          />
        )}
      </>
    );
  }
  return renderStudio(spaceId);
}
