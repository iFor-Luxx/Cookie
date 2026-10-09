import { toast } from "sonner";

/**
 * Reportero de errores visibles (H9): en el móvil no hay F12, así que los
 * fallos de dibujo/sync se muestran como toast. Deduplica ráfagas iguales.
 */
export function installErrorReporter(): void {
  let last = "";
  let lastAt = 0;
  const show = (message: string): void => {
    const msg = message.trim() || "Error en la app";
    const now = Date.now();
    if (msg === last && now - lastAt < 3000) return;
    last = msg;
    lastAt = now;
    toast.error(msg.length > 160 ? `${msg.slice(0, 160)}…` : msg);
  };
  window.addEventListener("error", (e) => {
    show(e.message);
  });
  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const reason = e.reason;
    show(reason instanceof Error ? reason.message : String(reason));
  });
}
