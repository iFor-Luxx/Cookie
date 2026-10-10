/**
 * Cambios de etapa sin parpadeo: fundido cruzado nativo (View
 * Transitions API) cuando existe y no hay movimiento reducido;
 * cambio directo en caso contrario.
 */
export function transitionTo(fn: () => void): void {
  if (typeof document === "undefined") {
    fn();
    return;
  }
  const reduced =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const doc = document as Document & {
    startViewTransition?: (callback: () => void) => void;
  };
  if (!reduced && typeof doc.startViewTransition === "function") {
    doc.startViewTransition(fn);
  } else {
    fn();
  }
}
