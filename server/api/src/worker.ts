// server/api — entrada real del Worker (H8 staging/prod).
// Cablea bindings Cloudflare a los puertos del core. Sin reglas de dominio.
import {
  type D1Like,
  d1Db,
  type R2BucketLike,
  r2ObjectStore,
  sqlLibraryStore,
  sqlPairingStore,
  sqlWsTicketStore,
} from "@cookie/server-db";
import { createApp } from "./app";
import { webCryptoPort } from "./crypto";
import type { RealtimeNotification } from "./http";
import { runMaintenance } from "./maintenance";
import { Metrics, RateLimiter } from "./middleware";

export { PairRoom } from "@cookie/server-realtime";

interface DurableStub {
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

interface PairRoomNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): DurableStub;
}

export interface WorkerEnv {
  DB: D1Like;
  BUCKET: R2BucketLike;
  PAIR_ROOM: PairRoomNamespace;
  ACCESS_SECRET: string;
  INTERNAL_SECRET: string;
  /** Orígenes CORS separados por coma (vacío = ninguno). */
  ALLOWED_ORIGINS?: string;
}

const limiter = new RateLimiter();
const metrics = new Metrics();

function toBytes(secret: string): Uint8Array {
  const bytes = new TextEncoder().encode(secret);
  if (bytes.length < 32)
    throw new Error("ACCESS_SECRET debe tener al menos 32 bytes");
  return bytes;
}

export default {
  async fetch(req: Request, env: WorkerEnv): Promise<Response> {
    const db = d1Db(env.DB);
    const notify = async (n: RealtimeNotification): Promise<void> => {
      try {
        const stub = env.PAIR_ROOM.get(env.PAIR_ROOM.idFromName(n.spaceId));
        await stub.fetch("https://pair/notify", {
          method: "POST",
          headers: {
            authorization: `Bearer ${env.INTERNAL_SECRET}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(n),
        });
      } catch {
        // Fanout best-effort: el replay por cursor repara clientes.
      }
    };
    const app = createApp({
      store: sqlPairingStore(db),
      library: sqlLibraryStore(db),
      tickets: sqlWsTicketStore(db),
      objects: r2ObjectStore(env.BUCKET),
      crypto: webCryptoPort(),
      clock: { nowIso: () => new Date().toISOString() },
      accessSecret: toBytes(env.ACCESS_SECRET),
      internalSecret: env.INTERNAL_SECRET,
      notify,
      limiter,
      metrics,
      allowedOrigins: (env.ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    });
    return app(req);
  },

  /** Cron diario: GC de huérfanos y vencidos (ver wrangler cron). */
  async scheduled(_event: unknown, env: WorkerEnv): Promise<void> {
    const db = d1Db(env.DB);
    await runMaintenance(
      sqlLibraryStore(db),
      sqlWsTicketStore(db),
      r2ObjectStore(env.BUCKET),
      new Date().toISOString(),
    );
  },
};
