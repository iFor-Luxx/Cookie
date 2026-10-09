import { Check, Copy, ScanLine } from "lucide-react";
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
import { ApiError, api } from "@/lib/api";
import { inviteQrPayload, parseQrPayload } from "@/lib/invite-qr";
import { InviteQr } from "./InviteQr";
import { QrScanner } from "./QrScanner";

export function SpaceSetup({
  onDone,
}: {
  onDone: (spaceId: string) => void;
}): React.JSX.Element {
  const [created, setCreated] = useState<{
    pairSpaceId: string;
    recoverySecret: string;
  } | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [joinToken, setJoinToken] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.createSpace();
      setCreated(res);
      // QR inmediato: encadenar la invitación para mostrarla sin otro clic.
      try {
        const inv = await api.createInvite(res.pairSpaceId);
        setInvite(inv.inviteToken);
      } catch {
        // Se genera manual con el botón de abajo.
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
    try {
      const res = await api.createInvite(created.pairSpaceId);
      setInvite(res.inviteToken);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo invitar");
    } finally {
      setBusy(false);
    }
  };

  const join = async (token: string): Promise<void> => {
    const t = token.trim();
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

  if (created) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="font-serif text-2xl">
              Guarda esto. En serio.
            </CardTitle>
            <CardDescription>
              El secreto de recuperación se muestra una sola vez. Sin él no hay
              recuperación.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div>
              <Label>Secreto de recuperación (se muestra una sola vez)</Label>
              <code className="block rounded-md bg-muted p-2 font-mono text-xs break-all">
                {created.recoverySecret}
              </code>
            </div>
            {!invite ? (
              <Button onClick={makeInvite} disabled={busy}>
                Generar invitación para la otra persona
              </Button>
            ) : (
              <>
                <div className="flex flex-col items-center gap-2">
                  <Label>Escanea este QR desde el otro dispositivo</Label>
                  <InviteQr
                    payload={inviteQrPayload(invite)}
                    label="QR de invitación"
                  />
                </div>
                <div>
                  <Label>Token de invitación (un solo uso)</Label>
                  <code className="block rounded-md bg-muted p-2 font-mono text-xs break-all">
                    {invite}
                  </code>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={copyInvite}>
                    {copied ? (
                      <Check className="size-4" aria-hidden />
                    ) : (
                      <Copy className="size-4" aria-hidden />
                    )}
                    Copiar
                  </Button>
                  <Button onClick={() => onDone(created.pairSpaceId)}>
                    Ya la compartí, entrar
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-serif text-2xl">
            Tu espacio compartido
          </CardTitle>
          <CardDescription>
            Crea uno nuevo o únete con una invitación.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Button onClick={create} disabled={busy}>
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
                  setError("Ese QR es de entrada, úsalo desde el inicio");
                  return;
                }
                setJoinToken(parsed.token);
                void join(parsed.token);
              }}
              onClose={() => setShowScanner(false)}
            />
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="token">Token de invitación</Label>
                <Input
                  id="token"
                  value={joinToken}
                  onChange={(e) => setJoinToken(e.target.value)}
                />
              </div>
              <Button
                variant="secondary"
                onClick={() => setShowScanner(true)}
                disabled={busy}
              >
                <ScanLine className="size-4" aria-hidden /> Escanear QR
              </Button>
            </>
          )}
          <Button
            variant={showScanner ? "secondary" : "default"}
            onClick={() => void join(joinToken)}
            disabled={busy || !joinToken.trim()}
          >
            Unirse
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
