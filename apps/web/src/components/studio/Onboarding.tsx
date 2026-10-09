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
import { ApiError, api } from "@/lib/api";

export function Onboarding({
  onDone,
}: {
  onDone: () => void;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recover, setRecover] = useState(false);
  const [spaceId, setSpaceId] = useState("");
  const [secret, setSecret] = useState("");

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.register(name.trim());
      onDone();
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
      onDone();
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
          {!recover ? (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">Nombre</Label>
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
