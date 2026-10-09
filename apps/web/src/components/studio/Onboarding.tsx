import { ScanLine } from "lucide-react";
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
import { ApiError, api } from "@/lib/api";
import { loginQrPayload } from "@/lib/invite-qr";
import { loadLastSpaceId } from "@/lib/last-space";
import { InviteQr } from "./InviteQr";

export function Onboarding({
  onDone,
}: {
  // spaceId nulo: ir al setup (crear o unirse). Con valor: directo al estudio.
  onDone: (spaceId: string | null) => void;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recover, setRecover] = useState(false);
  const [spaceId, setSpaceId] = useState(() => loadLastSpaceId() ?? "");
  const [secret, setSecret] = useState("");
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

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
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
          {attempt ? (
            <>
              <div className="flex flex-col items-center gap-2">
                <p className="text-sm text-muted-foreground">
                  Escanea este QR con tu celular para entrar a tu misma sala,
                  sin crear otra.
                </p>
                <InviteQr
                  payload={loginQrPayload(attempt.attemptId, attempt.code)}
                  label="QR de entrada"
                />
              </div>
              {waiting && (
                <p className="text-sm text-muted-foreground">
                  Esperando aprobación…
                </p>
              )}
              {attemptError && (
                <p className="text-sm text-destructive">{attemptError}</p>
              )}
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => void openAttempt()}>
                  Generar otro
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setAttempt(null);
                    setAttemptError(null);
                  }}
                >
                  Volver
                </Button>
              </div>
            </>
          ) : !recover ? (
            <>
              <Button onClick={() => void openAttempt()} disabled={busy}>
                <ScanLine className="size-4" aria-hidden /> Entrar con mi
                celular
              </Button>
              {attemptError && (
                <p className="text-sm text-destructive">{attemptError}</p>
              )}
              <Separator />
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
                Recuperar acceso en este dispositivo
              </button>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="space">ID del espacio</Label>
                <Input
                  id="space"
                  value={spaceId}
                  onChange={(e) => setSpaceId(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Si este dispositivo ya estuvo en el espacio, se rellena solo.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="secret">Secreto de recuperación</Label>
                <Input
                  id="secret"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                />
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
                onClick={() => setRecover(false)}
                className="text-sm text-muted-foreground underline-offset-4 hover:underline"
              >
                Volver
              </button>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
