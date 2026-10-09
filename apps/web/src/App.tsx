import {
  type BrushConfig,
  createDrawingEngine,
  DEFAULT_BRUSHES,
  serializeDocument,
} from "@cookie/drawing";
import { createDraftStore, indexedDbBackend } from "@cookie/platform-web";
import { CloudOff, LogOut, RefreshCw, Send } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { SaveState } from "@/components/canvas/CanvasBoard";
import { P5Board } from "@/components/canvas/P5Board";
import { Toolbar } from "@/components/canvas/Toolbar";
import { LoginQrDialog } from "@/components/studio/LoginQrDialog";
import { Onboarding } from "@/components/studio/Onboarding";
import { SpaceSetup } from "@/components/studio/SpaceSetup";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  const [tab, setTab] = useState("lienzo");
  const [brush, setBrush] = useState<BrushConfig>(DEFAULT_BRUSHES.graphite);
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
  if (screen === "setup" || !spaceId) {
    return (
      <SpaceSetup
        onDone={(id) => {
          setSpaceId(id);
          setScreen("studio");
        }}
      />
    );
  }

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <Toaster />
      <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-pixel text-xs tracking-widest text-muted-foreground uppercase">
              Cookie · espacio compartido
            </p>
            <h1 className="font-serif text-4xl leading-tight">Estudio</h1>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={saveState === "saved" ? "secondary" : "outline"}>
              {SAVE_LABEL[saveState]}
            </Badge>
            {pending > 0 && (
              <Badge variant="outline">
                <CloudOff className="size-3" aria-hidden /> {pending} pendiente
              </Badge>
            )}
            {failed > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void syncEngine.retryAllFailed()}
              >
                <RefreshCw className="size-3" aria-hidden /> Reintentar (
                {failed})
              </Button>
            )}
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
        </header>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="lienzo">Lienzo</TabsTrigger>
            <TabsTrigger value="historial">Historial</TabsTrigger>
          </TabsList>
        </Tabs>
        {tab === "lienzo" ? (
          <>
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
            />
            <P5Board
              engine={engine}
              brush={brush}
              draftStore={draftStore}
              draftId={DRAFT_ID}
              onSaveState={setSaveState}
              onStrokesVersion={() => setVersion((v) => v + 1)}
            />
            <div className="flex flex-col items-center gap-2">
              <Button onClick={publish}>
                <Send className="size-4" aria-hidden /> Publicar al historial
              </Button>
              <p className="text-sm text-muted-foreground">
                Sin conexión se encola y se envía solo al volver la red.
              </p>
            </div>
          </>
        ) : (
          <Suspense
            fallback={
              <p className="text-sm text-muted-foreground">
                Cargando historial…
              </p>
            }
          >
            <History
              key={historyKey}
              spaceId={spaceId}
              focusId={focusDrawing}
            />
          </Suspense>
        )}
      </div>
    </main>
  );
}
