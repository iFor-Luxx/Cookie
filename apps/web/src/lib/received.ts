import type { DrawingMeta } from "./api";

// Flujo A-envía / B-recibe: el historial muestra solo dibujos recibidos
// (los que NO son de mi autoría). El que envía no ve lo enviado.
export function receivedOnly(
  items: DrawingMeta[],
  myUserId: string | null,
): DrawingMeta[] {
  if (!myUserId) return items;
  return items.filter((d) => d.authorUserId !== myUserId);
}
