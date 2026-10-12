import { Check, Copy, Ticket } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError, api } from "@/lib/api";
import { inviteQrPayload } from "@/lib/invite-qr";
import { InviteQr } from "./InviteQr";

/**
 * El teléfono que está en la sala genera un código fresco para el otro
 * (recuperar su acceso con código + contraseña). Un solo uso: cada vez
 * que se genera, el anterior caduca.
 */
export function InviteDialog({
  spaceId,
  label,
  className,
}: {
  spaceId: string;
  label?: string;
  className?: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const make = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.createInvite(spaceId);
      setToken(res.inviteToken);
      setCopied(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo generar");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (): Promise<void> => {
    if (!token) return;
    await navigator.clipboard.writeText(token).catch(() => undefined);
    setCopied(true);
  };

  return (
    <>
      <Button
        variant="ghost"
        size={label ? "sm" : "icon"}
        aria-label="Generar código para el otro teléfono"
        title="Generar código para el otro teléfono"
        onClick={() => {
          setToken(null);
          setError(null);
          setOpen(true);
          void make();
        }}
        className={className}
      >
        <Ticket className="size-4" aria-hidden />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Código para el otro teléfono</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Dicta o comparte este código: en su pantalla de volver a
              entrar lo escribe junto a la contraseña y vuelve a la misma
              sala. Un solo uso y caduca en 1 hora.
            </p>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3">
            {token ? (
              <>
                <InviteQr
                  payload={inviteQrPayload(token)}
                  label="QR del código"
                />
                <div className="flex w-full items-center gap-2">
                  <code className="block flex-1 rounded-md bg-muted p-2 text-center font-mono text-lg tracking-[0.2em]">
                    {token}
                  </code>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    onClick={() => void copy()}
                    aria-label="Copiar código"
                    title="Copiar código"
                    className="shrink-0"
                  >
                    {copied ? (
                      <Check className="size-4" aria-hidden />
                    ) : (
                      <Copy className="size-4" aria-hidden />
                    )}
                  </Button>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => void make()}
                  disabled={busy}
                >
                  Generar otro
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {error ?? "Generando…"}
              </p>
            )}
            {error && !token && (
              <Button onClick={() => void make()} disabled={busy}>
                Reintentar
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
