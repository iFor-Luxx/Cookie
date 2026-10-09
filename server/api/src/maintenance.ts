// server/api — mantenimiento compartido (endpoint interno + cron del Worker).
import type { LibraryStore } from "@cookie/core";
import type { WsTicketStore } from "@cookie/server-db";
import type { ObjectStore } from "@cookie/storage";

export interface MaintenanceResult {
  uploadIntents: number;
  idempotency: number;
  tickets: number;
}

export async function runMaintenance(
  library: LibraryStore,
  tickets: WsTicketStore,
  objects: ObjectStore,
  nowIso: string,
): Promise<MaintenanceResult> {
  const expired = await library.listExpiredIntents(nowIso, 500);
  for (const intent of expired) {
    await objects.delete(intent.objectKey).catch(() => undefined);
    await library.deleteIntent(intent.id);
  }
  const idempotency = await library.deleteExpiredIdempotency(nowIso);
  const ticketCount = await tickets.deleteSettledTickets(nowIso);
  return {
    uploadIntents: expired.length,
    idempotency,
    tickets: ticketCount,
  };
}
