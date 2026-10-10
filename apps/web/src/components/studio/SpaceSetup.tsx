import { Check, Copy, Eye, EyeOff, ScanLine, Share2 } from "lucide-react";
import { useState } from "react";
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
import { formatInviteTokenInput, inviteQrPayload, parseQrPayload } from "@/lib/invite-qr";
import { usePrefersDark } from "@/lib/use-prefers-dark";
import { cn } from "@/lib/utils";
import { InviteQr } from "./InviteQr";
import { QrScanner } from "./QrScanner";
import { SkyBackground } from "./SkyBackground";

export function SpaceSetup({
  onDone,
  onEnter,
}: {
  onDone: (spaceId: string) => void;
  /** Entrar tras crear: con barrido de salida. Si falta, entra directo. */
  onEnter?: (spaceId: string) => void;
}): React.JSX.Element {
  const [created, setCreated] = useState<{
    pairSpaceId: string;
    recoverySecret: string;
  } | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [joinToken, setJoinToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const dark = usePrefersDark();
  const sky = <SkyBackground variant={dark ? "night" : "day"} />;

  const create = async (): Promise<void> => {
    const pass = password.trim();
    if (pass.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (pass !== confirm.trim()) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.createSpace(pass);
      setInvite(null);
      setInviteError(null);
      setInviteLoading(true);
      setCreating(false);
      setCreated({ pairSpaceId: res.pairSpaceId, recoverySecret: "" });
      // QR inmediato: encadenar la invitación para mostrarla sin otro clic.
      try {
        const inv = await api.createInvite(res.pairSpaceId);
        setInvite(inv.inviteToken);
      } catch {
        setInviteError("No se pudo generar la invitación.");
      } finally {
        setInviteLoading(false);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo crear");
    } finally {
      setBusy(false);
    }
  };

  const makeInvite = async (): Promise<void> => {
    if (!created) return;
    setBusy(true);
    setInviteError(null);
    setInviteLoading(true);
    try {
      const res = await api.createInvite(created.pairSpaceId);
      setInvite(res.inviteToken);
    } catch (e) {
      setInviteError(
        e instanceof ApiError ? e.message : "No se pudo invitar",
      );
    } finally {
      setBusy(false);
      setInviteLoading(false);
    }
  };

  const join = async (token: string): Promise<void> => {
    const t = formatInviteTokenInput(token);
    if (!t) return;
    setBusy(true);
    setError(null);
    try {
      // La identidad ya viene del onboarding: solo se vincula al espacio.
      const res = await api.consumeInvite(t);
      onDone(res.pairSpaceId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Invitación inválida");
    } finally {
      setBusy(false);
    }
  };

  const copyInvite = async (): Promise<void> => {
    if (!invite) return;
    await navigator.clipboard.writeText(invite).catch(() => undefined);
    setCopied(true);
  };

  // Comparte una imagen con el QR + el token (Web Share con archivo,
  // descarga como respaldo). Sin dependencias nuevas: se dibuja en canvas.
  const shareInvite = async (): Promise<void> => {
    if (!invite || sharing) return;
    setSharing(true);
    try {
      const qr = document.querySelector(
        'canvas[aria-label="QR de invitación"]',
      ) as HTMLCanvasElement | null;
      const S = 2;
      const W = 360;
      const H = 520;
      const canvas = document.createElement("canvas");
      canvas.width = W * S;
      canvas.height = H * S;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("sin canvas 2d");
      ctx.scale(S, S);
      // Fondo blanco con esquinas redondeadas.
      ctx.beginPath();
      ctx.roundRect(0, 0, W, H, 36);
      ctx.fillStyle = "#FFFFFF";
      ctx.fill();
      ctx.fillStyle = "#33406E";
      ctx.textAlign = "center";
      ctx.font = "600 24px system-ui, sans-serif";
      ctx.fillText("Cookie · Invitación", W / 2, 52);
      if (qr && qr.width > 0) {
        ctx.drawImage(qr, (W - 240) / 2, 76, 240, 240);
      }
      ctx.fillStyle = "#111827";
      try {
        (ctx as { letterSpacing?: string }).letterSpacing = "6px";
      } catch {
        // letterSpacing no soportado: se dibuja sin tracking.
      }
      ctx.font = "700 30px ui-monospace, monospace";
      ctx.fillText(invite, W / 2, 372);
      try {
        (ctx as { letterSpacing?: string }).letterSpacing = "0px";
      } catch {
        // Sin soporte: nada que restaurar.
      }
      ctx.fillStyle = "#6B7280";
      ctx.font = "400 19px system-ui, sans-serif";
      ctx.fillText("Escanea el QR o escribe el código", W / 2, 420);
      ctx.fillText("en Cookie para unirte.", W / 2, 448);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!blob) throw new Error("no se pudo generar la imagen");
      const file = new File([blob], "invitacion-cookie.png", {
        type: "image/png",
      });
      const nav = navigator as Navigator & {
        canShare?: (data: { files: File[] }) => boolean;
        share?: (data: { files: File[]; title?: string }) => Promise<void>;
      };
      if (nav.canShare?.({ files: [file] }) && nav.share) {
        await nav.share({ files: [file], title: "Invitación a Cookie" });
        return;
      }
      // Respaldo: descargar la imagen.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "invitacion-cookie.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      // Último recurso: copiar el token.
      await navigator.clipboard.writeText(invite).catch(() => undefined);
      setCopied(true);
    } finally {
      setSharing(false);
    }
  };

  if (created) {
    return (
      <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-4">
        {sky}
        <Card
          key={created.pairSpaceId}
          className={cn(
            "liquid-glass-card relative w-full max-w-md",
            !reducedMotion && "animate-[fade-in_0.45s_ease-out_both]",
          )}
        >
          <CardHeader>
            <CardTitle className="font-serif text-2xl">
              Espacio listo
            </CardTitle>
            <CardDescription>
              Tu contraseña será la llave de recuperación. No la olvides.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {invite ? (
              <div
                className={cn(
                  "flex flex-col gap-3",
                  !reducedMotion && "animate-[fade-in_0.45s_ease-out_both]",
                )}
              >
                <div className="flex flex-col items-center gap-2">
                  <Label>Escanea este QR desde el otro dispositivo</Label>
                  <InviteQr
                    payload={inviteQrPayload(invite)}
                    label="QR de invitación"
                  />
                </div>
                <div>
                  <Label>Token de invitación (un solo uso)</Label>
                  <div className="flex gap-2">
                    <code className="block flex-1 rounded-md bg-muted p-2 font-mono text-sm tracking-[0.2em] break-all">
                      {invite}
                    </code>
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      onClick={copyInvite}
                      aria-label="Copiar token"
                      title="Copiar token"
                      className="shrink-0"
                    >
                      {copied ? (
                        <Check className="size-4" aria-hidden />
                      ) : (
                        <Copy className="size-4" aria-hidden />
                      )}
                    </Button>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => void shareInvite()}
                    disabled={sharing}
                    className="flex-1"
                  >
                    <Share2 className="size-4" aria-hidden />
                    {sharing ? "Compartiendo…" : "Compartir"}
                  </Button>
                  <Button
                    onClick={() => (onEnter ?? onDone)(created.pairSpaceId)}
                    className="flex-1"
                  >
                    Ya la compartí, entrar
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col items-center gap-2">
                  <Label>Escanea este QR desde el otro dispositivo</Label>
                  {inviteLoading ? (
                    <div
                      role="status"
                      aria-label="Generando invitación…"
                      className="flex flex-col items-center"
                    >
                      <Skeleton className="h-48 w-48 rounded-md" />
                      <span className="sr-only">Generando invitación…</span>
                    </div>
                  ) : (
                    <div className="flex h-48 w-48 flex-col items-center justify-center gap-2 text-center">
                      <p className="text-sm text-destructive">
                        {inviteError ?? "No se pudo generar la invitación."}
                      </p>
                      <button
                        type="button"
                        onClick={() => void makeInvite()}
                        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                      >
                        Reintentar
                      </button>
                    </div>
                  )}
                </div>
                <div>
                  <Label>Token de invitación (un solo uso)</Label>
                  <div className="flex gap-2">
                    <Skeleton className="h-9 flex-1 rounded-md" />
                    <Skeleton className="h-9 w-9 rounded-md" />
                  </div>
                </div>
                {inviteLoading ? (
                  <div className="flex gap-2" aria-hidden>
                    <Skeleton className="h-9 flex-1 rounded-md" />
                    <Skeleton className="h-9 flex-1 rounded-md" />
                  </div>
                ) : (
                  <Button onClick={makeInvite} disabled={busy}>
                    Generar invitación para la otra persona
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-4">
      {sky}
      <Card
        key={creating ? "creating" : showScanner ? "scan" : "join"}
        className={cn(
          "liquid-glass-card relative w-full max-w-sm",
          !reducedMotion && "animate-[fade-in_0.45s_ease-out_both]",
        )}
      >
        <CardHeader>
          <CardTitle className="font-serif text-2xl">
            {creating ? "Crea tu contraseña" : "Tu espacio compartido"}
          </CardTitle>
          <CardDescription>
            {creating
              ? "Será tu llave para recuperar el acceso."
              : "Crea uno nuevo o únete con una invitación."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {creating ? (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">Contraseña de recuperación</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    placeholder="Mínimo 8 caracteres"
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowPassword((v) => !v)}
                    disabled={busy}
                    aria-label={
                      showPassword
                        ? "Ocultar contraseña"
                        : "Mostrar contraseña"
                    }
                    title={
                      showPassword
                        ? "Ocultar contraseña"
                        : "Mostrar contraseña"
                    }
                    className="absolute top-1/2 right-1 h-7 w-7 -translate-y-1/2"
                  >
                    {showPassword ? (
                      <EyeOff className="size-4" aria-hidden />
                    ) : (
                      <Eye className="size-4" aria-hidden />
                    )}
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="confirm">Confirmar contraseña</Label>
                <div className="relative">
                  <Input
                    id="confirm"
                    type={showPassword ? "text" : "password"}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    autoComplete="new-password"
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowPassword((v) => !v)}
                    disabled={busy}
                    aria-label={
                      showPassword
                        ? "Ocultar contraseña"
                        : "Mostrar contraseña"
                    }
                    title={
                      showPassword
                        ? "Ocultar contraseña"
                        : "Mostrar contraseña"
                    }
                    className="absolute top-1/2 right-1 h-7 w-7 -translate-y-1/2"
                  >
                    {showPassword ? (
                      <EyeOff className="size-4" aria-hidden />
                    ) : (
                      <Eye className="size-4" aria-hidden />
                    )}
                  </Button>
                </div>
              </div>
              <Button onClick={create} disabled={busy}>
                Generar QR y token
              </Button>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setError(null);
                }}
                className="text-sm text-muted-foreground underline-offset-4 hover:underline"
              >
                Volver
              </button>
            </>
          ) : (
            <>
              <Button
                onClick={() => {
                  setError(null);
                  setCreating(true);
                }}
                disabled={busy}
              >
                Crear espacio y mostrar QR
              </Button>
              {error && <p className="text-sm text-destructive">{error}</p>}
          <Separator />
          {showScanner ? (
            <QrScanner
              onScan={(raw) => {
                const parsed = parseQrPayload(raw);
                setShowScanner(false);
                if (!parsed) {
                  setError("QR no reconocido");
                  return;
                }
                if (parsed.kind !== "invite") {
                  setError(
                    "Ese QR es de entrada: apruébalo desde el estudio (botón QR)",
                  );
                  return;
                }
                setJoinToken(formatInviteTokenInput(parsed.token));
                void join(parsed.token);
              }}
              onClose={() => setShowScanner(false)}
            />
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="token">Token de invitación</Label>
              <div className="flex gap-2">
                <Input
                  id="token"
                  value={joinToken}
                  onChange={(e) =>
                    setJoinToken(formatInviteTokenInput(e.target.value))
                  }
                  className="flex-1 font-mono tracking-[0.2em] uppercase"
                  placeholder="9 caracteres"
                  maxLength={9}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  onClick={() => setShowScanner(true)}
                  disabled={busy}
                  aria-label="Escanear QR"
                  title="Escanear QR"
                  className="shrink-0"
                >
                  <ScanLine className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
          )}
          <Button
            variant={showScanner ? "secondary" : "default"}
            onClick={() => void join(joinToken)}
            disabled={busy || !joinToken.trim()}
          >
            Unirse
          </Button>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
