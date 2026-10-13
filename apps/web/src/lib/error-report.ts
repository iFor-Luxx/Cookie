import { toast } from "sonner";

/**
 * Reportero de errores visibles (H9): en el móvil no hay F12, así que los
 * fallos de dibujo/sync se muestran como toast. Deduplica ráfagas iguales.
 *
 * Solo toastea fallos de NUESTRO bundle: el ruido de extensiones del
 * navegador (scripts ajenos inyectados en la página) se ignora para no
 * alarmar con errores que no son de la app.
 */

const OWN_HOSTS = new Set(["localhost", "127.0.0.1", "cookieapp.pages.dev"]);

function isOwnUrl(url: string): boolean {
  try {
    const u = new URL(url, window.location.href);
    if (u.protocol === "capacitor:" || u.protocol === "blob:") return true;
    return OWN_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

/** Primera URL http(s)/capacitor/blob del stack (origen real del fallo). */
function stackUrl(stack: string | undefined): string | null {
  if (!stack) return null;
  const m = /(?:https?|capacitor|blob):[^\s)'"]+/.exec(stack);
  return m?.[0] ?? null;
}

export function installErrorReporter(): void {
  let last = "";
  let lastAt = 0;
  const show = (
    message: string,
    origin: string | null,
    stack?: string,
  ): void => {
    // Ajeno a la app (p. ej. extensiones): fuera del toast, solo consola.
    if (origin && !isOwnUrl(origin)) {
      console.error("[externo]", message, stack ?? "");
      return;
    }
    const msg = message.trim() || "Error en la app";
    const now = Date.now();
    if (msg === last && now - lastAt < 3000) return;
    last = msg;
    lastAt = now;
    console.error("[app]", origin ?? "origen desconocido", stack ?? msg);
    toast.error(msg.length > 160 ? `${msg.slice(0, 160)}…` : msg);
  };
  window.addEventListener("error", (e) => {
    const err = e.error as Error | undefined;
    show(e.message, e.filename || stackUrl(err?.stack), err?.stack);
  });
  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const reason = e.reason;
    const errStack = reason instanceof Error ? reason.stack : undefined;
    show(
      reason instanceof Error ? reason.message : String(reason),
      stackUrl(errStack),
      errStack,
    );
  });
}
