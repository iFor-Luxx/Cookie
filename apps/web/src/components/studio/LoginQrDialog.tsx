import { QrCode } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError, api } from "@/lib/api";
import { parseQrPayload } from "@/lib/invite-qr";
import { QrScanner } from "./QrScanner";

/**
 * Dar entrada a otro dispositivo (H9, estilo WhatsApp Web): el PC sin
 * sesión muestra su QR y ESTE dispositivo lo escanea para aprobar.
 * Escanear = aprobar (FR-10). Un solo uso, ~5 minutos.
 */
export function LoginQrDialog(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const approve = async (raw: string): Promise<void> => {
    const parsed = parseQrPayload(raw);
    if (!parsed || parsed.kind !== "login") {
      setError("Ese QR no es de entrada. Pide el QR que muestra el PC.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.approveLoginAttempt(parsed.attemptId, parsed.code);
      setDone(
        res.platform === "android"
          ? "Celular vinculado a tu cuenta."
          : "Navegador vinculado a tu cuenta.",
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo aprobar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Dar entrada a otro dispositivo"
        onClick={() => {
          setDone(null);
          setError(null);
          setOpen(true);
        }}
      >
        <QrCode className="size-4" aria-hidden />
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dar entrada a otro dispositivo</DialogTitle>
            <p className="text-sm text-muted-foreground">
              En el PC pulsa «Entrar con mi celular» y escanea aquí el QR que
              muestra. Entrará a tu misma sala, sin crear otra.
            </p>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {done ? (
              <p className="text-sm text-foreground">{done}</p>
            ) : busy ? (
              <p className="text-sm text-muted-foreground">Aprobando…</p>
            ) : (
              <QrScanner
                onScan={(raw) => void approve(raw)}
                onClose={() => setOpen(false)}
              />
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
