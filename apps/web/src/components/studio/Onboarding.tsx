import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, api } from "@/lib/api";
import { loginQrPayload } from "@/lib/invite-qr";
import { loadLastSpaceId } from "@/lib/last-space";
import { usePrefersDark } from "@/lib/use-prefers-dark";
import { cn } from "@/lib/utils";
import { transitionTo } from "@/lib/view-transition";
import { InviteQr } from "./InviteQr";
import { SkyBackground } from "./SkyBackground";
import { BrandWipe } from "./wipe/BrandWipe";
import { warmWipeGpu } from "./wipe/WipeCanvas";

export function Onboarding({
  onDone,
}: {
  // spaceId nulo: ir al setup (crear o unirse). Con valor: directo al estudio.
  onDone: (spaceId: string | null) => void;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Portada de marca: primero solo el logo, luego textos y botón
  // en cascada (fases temporizadas, sin saltos de layout). Al pulsar
  // "Comenzar", un barrido revela el formulario ya montado detrás.
  const [started, setStarted] = useState(false);
  const [wiping, setWiping] = useState(false);
  // Bienvenida tras el wipe: antes del formulario.
  const [welcomed, setWelcomed] = useState(false);
  const dark = usePrefersDark();
  const [phase, setPhase] = useState(0);
  const [reducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    if (started) return;
    if (reducedMotion) {
      setPhase(2);
      return;
    }
    const t1 = window.setTimeout(() => setPhase(1), 650);
    const t2 = window.setTimeout(() => setPhase(2), 1200);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [started, reducedMotion]);

  // Precalienta el adapter WebGPU cuando el botón ya es visible, para
  // que el barrido arranque sin espera al pulsar.
  useEffect(() => {
    if (!started && phase >= 2 && !reducedMotion) warmWipeGpu();
  }, [started, phase, reducedMotion]);
  const [recover, setRecover] = useState(false);
  const [spaceId, setSpaceId] = useState(() => loadLastSpaceId() ?? "");
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  // Entrada estilo WhatsApp Web: este PC muestra su QR y el celular con
  // sesión lo escanea para aprobar. Sin escribir nada aquí.
  const [attempt, setAttempt] = useState<{
    attemptId: string;
    code: string;
  } | null>(null);
  const [attemptError, setAttemptError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!attempt) return;
    let cancelled = false;
    let timer: number | null = null;
    setWaiting(true);
    const tick = async (): Promise<void> => {
      try {
        const res = await api.pollLoginAttempt(attempt.attemptId, attempt.code);
        if (cancelled) return;
        if (res.status === "approved") {
          setWaiting(false);
          onDoneRef.current(res.pairSpaceId);
          return;
        }
      } catch (e) {
        // Terminal (caducado/inválido/usado): dejar de sondear.
        // Fallo de red: seguir intentando en el siguiente tick.
        if (cancelled || !(e instanceof ApiError)) {
          if (!cancelled) timer = window.setTimeout(() => void tick(), 2500);
          return;
        }
        if (!cancelled) {
          setWaiting(false);
          setAttemptError(e.message);
        }
        return;
      }
      if (!cancelled) timer = window.setTimeout(() => void tick(), 2500);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [attempt]);

  const openAttempt = async (): Promise<void> => {
    setAttemptError(null);
    setAttempt(null);
    try {
      const res = await api.createLoginAttempt();
      setAttempt({ attemptId: res.attemptId, code: res.loginCode });
    } catch (e) {
      setAttemptError(
        e instanceof ApiError ? e.message : "No se pudo generar el QR",
      );
    }
  };
  const openAttemptRef = useRef(openAttempt);
  openAttemptRef.current = openAttempt;

  // Al entrar a "Ya tienes una sala": mostrar el QR ya generado,
  // sin botón intermedio.
  const recoverOpenedRef = useRef(false);
  useEffect(() => {
    if (!recover) {
      recoverOpenedRef.current = false;
      return;
    }
    if (recoverOpenedRef.current) return;
    recoverOpenedRef.current = true;
    void openAttemptRef.current();
  }, [recover]);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.register(name.trim());
      onDone(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo registrar");
    } finally {
      setBusy(false);
    }
  };

  const doRecover = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const installationId = crypto.randomUUID();
      const ch = await api.recoveryChallenge(spaceId.trim(), installationId);
      await api.recoveryComplete(ch.challengeId, secret.trim());
      onDone(null);
    } catch {
      setError("No se pudo recuperar. Revisa el espacio y el secreto.");
    } finally {
      setBusy(false);
    }
  };

  // Nodo destino del wipe de entrada (se monta recortado tras el
  // overlay y también en la etapa normal: contenido estático).
  // OJO: la capa `to` del wipe debe encuadrar EXACTO igual que la
  // pantalla final (cielo + centrado), si no a mitad del barrido se ven
  // las dos pantallas desalineadas (Bienvenido arriba, cover debajo).
  // Versión estática para el wipe: sin animación de entrada (ya la hace
  // el barrido) y sin botón interactivo (evita doble avance a mitad del
  // vuelo). La versión animada sigue debajo para la etapa normal.
  const welcomeWipeNode = (
    <div className="absolute inset-0 overflow-hidden bg-background">
      <SkyBackground variant={dark ? "night" : "day"} />
      <div className="relative flex min-h-dvh items-center justify-center px-4">
        <div className="flex flex-col items-center gap-8 text-center">
          <div className="flex flex-col gap-2">
            <h1 className="font-serif text-6xl leading-tight text-foreground">
              Bienvenido
            </h1>
            <p className="text-base text-foreground/80">
              Unos cuantos pasos antes de empezar.
            </p>
          </div>
          <div
            aria-hidden
            className="liquid-glass flex size-14 items-center justify-center rounded-full text-slate-800 dark:text-white"
          >
            <ArrowRight className="size-6" aria-hidden />
          </div>
        </div>
      </div>
    </div>
  );

  const welcomeNode = (
    <div
      className={cn(
        "flex flex-col items-center gap-8 text-center",
        !reducedMotion && "animate-[rise-in_0.6s_ease-out_both]",
      )}
    >
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-6xl leading-tight text-foreground">
          Bienvenido
        </h1>
        <p className="text-base text-foreground/80">
          Unos cuantos pasos antes de empezar.
        </p>
      </div>
      <button
        type="button"
        onClick={() => transitionTo(() => setWelcomed(true))}
        aria-label="Continuar al registro"
        className="liquid-glass flex size-14 items-center justify-center rounded-full text-slate-800 transition-transform hover:scale-105 active:scale-95 dark:text-white"
      >
        <ArrowRight className="size-6" aria-hidden />
      </button>
    </div>
  );

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-4">
      {started && <SkyBackground variant={dark ? "night" : "day"} />}
      {!started ? (
        <div className="relative flex flex-col items-center gap-5 text-center">
          <span
            aria-hidden
            className={cn(
              "absolute -top-10 size-64 rounded-full bg-primary/25 blur-3xl",
              phase >= 1 && !reducedMotion
                ? "animate-[rise-in_0.8s_ease-out_both]"
                : phase >= 1
                  ? "opacity-100"
                  : "opacity-0",
            )}
          />
          <img
            src="/logo.svg"
            alt="Logo de Cookie"
            width={112}
            height={112}
            className={
              reducedMotion
                ? "relative size-28 rounded-3xl shadow-lg"
                : "relative size-28 rounded-3xl shadow-lg animate-[logo-pop_0.6s_ease-out]"
            }
          />
          <div
            className={cn(
              "flex flex-col gap-1",
              phase >= 1 && !reducedMotion
                ? "animate-[rise-in_0.6s_ease-out_both]"
                : phase >= 1
                  ? "opacity-100"
                  : "opacity-0",
            )}
          >
            <p className="font-pixel text-xs tracking-widest text-muted-foreground uppercase">
              Espacio compartido
            </p>
            <h1 className="font-serif text-5xl leading-tight">Cookie</h1>
            <p className="text-sm text-muted-foreground">
              Dibujo compartido para dos.
            </p>
          </div>
          <div
            className={cn(
              "mt-2",
              phase >= 2 && !reducedMotion
                ? "animate-[rise-in_0.6s_ease-out_both]"
                : phase >= 2
                  ? "opacity-100"
                  : "opacity-0",
            )}
            style={
              phase >= 2 && !reducedMotion
                ? { animationDelay: "150ms" }
                : undefined
            }
          >
            <Button
              size="lg"
              onClick={() => {
                // Movimiento reducido: corte directo sin barrido.
                if (reducedMotion) {
                  setStarted(true);
                  return;
                }
                // Solo cuando la secuencia terminó: el wipe corre sobre
                // esta pantalla y el formulario aparece al revelar.
                if (phase < 2) return;
                setWiping(true);
              }}
              tabIndex={phase >= 2 ? 0 : -1}
            >
              Comenzar
            </Button>
          </div>
        </div>
      ) : !welcomed ? (
        welcomeNode
      ) : (
        <Card
          key={recover ? "recover-box" : "new-box"}
          className={cn(
            "liquid-glass-card relative w-full max-w-sm",
            !reducedMotion && "animate-[fade-in_0.45s_ease-out_both]",
          )}
        >
          <CardHeader>
            <p className="font-pixel text-xs tracking-widest text-muted-foreground uppercase">
              Cookie
            </p>
            <CardTitle className="font-serif text-3xl">
              Hola, ¿cómo te llamas?
            </CardTitle>
            <CardDescription>
              Nombre visible de 1 a 32 caracteres. Sin contraseñas.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-4">
            {!recover ? (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="name">Nombre (cuenta nueva)</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={32}
                    placeholder="Lux"
                    autoComplete="nickname"
                  />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button
                  onClick={submit}
                  disabled={busy || name.trim().length === 0}
                >
                  Entrar
                </Button>
                <button
                  type="button"
                  onClick={() => setRecover(true)}
                  className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                >
                  ¿Ya tienes una sala? Ingresa aquí
                </button>
              </>
            ) : (
              <>
                <div className="flex flex-col items-center gap-2">
                  <p className="text-sm text-muted-foreground">
                    Escanea este QR con tu celular para entrar a tu misma sala,
                    sin crear otra.
                  </p>
                  {attempt ? (
                    <div
                      key="qr"
                      className={cn(
                        !reducedMotion &&
                          "animate-[fade-in_0.22s_ease-in-out_both]",
                      )}
                    >
                      <InviteQr
                        payload={loginQrPayload(attempt.attemptId, attempt.code)}
                        label="QR de entrada"
                      />
                    </div>
                  ) : attemptError ? (
                    <div className="flex h-48 w-48 flex-col items-center justify-center gap-2 text-center">
                      <p className="text-sm text-destructive">{attemptError}</p>
                      <button
                        type="button"
                        onClick={() => void openAttempt()}
                        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                      >
                        Reintentar
                      </button>
                    </div>
                  ) : (
                    <div
                      className="flex flex-col items-center gap-2"
                      role="status"
                      aria-label="Generando QR…"
                    >
                      <Skeleton className="h-48 w-48 rounded-md" />
                      <span className="sr-only">Generando QR…</span>
                    </div>
                  )}
                  <p
                    className="min-h-5 text-sm text-muted-foreground"
                    aria-live="polite"
                  >
                    {waiting && attempt ? "Esperando aprobación…" : " "}
                  </p>
                </div>
                <Separator />
                <div className="flex flex-col gap-2">
                  <Label htmlFor="space">ID del espacio</Label>
                  <Input
                    id="space"
                    value={spaceId}
                    onChange={(e) => setSpaceId(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Si este dispositivo ya estuvo en el espacio, se rellena
                    solo.
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="secret">Contraseña de recuperación</Label>
                  <div className="relative">
                    <Input
                      id="secret"
                      type={showSecret ? "text" : "password"}
                      value={secret}
                      onChange={(e) => setSecret(e.target.value)}
                      autoComplete="current-password"
                      className="pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowSecret((v) => !v)}
                      aria-label={
                        showSecret
                          ? "Ocultar contraseña"
                          : "Mostrar contraseña"
                      }
                      title={
                        showSecret
                          ? "Ocultar contraseña"
                          : "Mostrar contraseña"
                      }
                      className="absolute top-1/2 right-1 h-7 w-7 -translate-y-1/2"
                    >
                      {showSecret ? (
                        <EyeOff className="size-4" aria-hidden />
                      ) : (
                        <Eye className="size-4" aria-hidden />
                      )}
                    </Button>
                  </div>
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button
                  onClick={doRecover}
                  disabled={busy || !spaceId || !secret}
                >
                  Recuperar
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setRecover(false);
                    setAttempt(null);
                    setAttemptError(null);
                  }}
                  className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                >
                  Volver
                </button>
              </>
            )}
            </div>
          </CardContent>
        </Card>
      )}
      {wiping && (
        <BrandWipe
          to={welcomeWipeNode}
          onDone={() => {
            setStarted(true);
            setWiping(false);
          }}
        />
      )}
    </main>
  );
}
