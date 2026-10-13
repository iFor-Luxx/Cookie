// @cookie/server-realtime — PairRoom Durable Object (un actor por PairSpace).
// Wrapper fino sobre RoomHub. En prod corre en Cloudflare con WebSocket
// Hibernation; `state`/`env` son estructurales para no atar el repo al SDK.
//
// Flujo: cliente pide ticket en API (auth + membresía) → conecta al DO con
// ?ticket= → el DO consume el ticket vía endpoint interno → hello/ready.
// Cableado en server/api/src/worker.ts: el Worker enruta el upgrade
// `/v1/pair-spaces/{id}/realtime-socket` al stub del DO; el DO lee
// INTERNAL_SECRET y API_BASE del mismo env del script.
import { type BroadcastEvent, RoomHub } from "./hub";

// Globals del runtime Cloudflare (no existen en lib DOM de typecheck).
declare const WebSocketPair: new () => {
  0: unknown;
  1: unknown;
};

interface HibernatingWebSocket {
  accept(): void;
  send(message: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

interface DOState {
  acceptWebSocket(socket: HibernatingWebSocket): void;
  getWebSockets(): HibernatingWebSocket[];
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>;
}

interface DOEnv {
  /** Compartido con el Worker (mismo script): el DO ve los secretos del script. */
  INTERNAL_SECRET: string;
  /** URL pública del Worker; el DO la usa para los endpoints /internal/*. */
  API_BASE: string;
}

interface Attachment {
  spaceId: string;
  installationId: string;
  socketId: string;
}

const hub = new RoomHub();

export class PairRoom {
  private readonly state: DOState;
  private readonly env: DOEnv;

  constructor(state: DOState, env: DOEnv) {
    this.state = state;
    this.env = env;
  }

  private async consumeTicket(
    ticket: string,
  ): Promise<{ spaceId: string; installationId: string } | null> {
    try {
      const res = await fetch(`${this.env.API_BASE}/internal/tickets/consume`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.env.INTERNAL_SECRET}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ticket }),
      });
      if (!res.ok) return null;
      return (await res.json()) as { spaceId: string; installationId: string };
    } catch {
      return null;
    }
  }

  private async currentSeq(spaceId: string): Promise<number> {
    try {
      const res = await fetch(
        `${this.env.API_BASE}/internal/spaces/${encodeURIComponent(spaceId)}/seq`,
        {
          headers: { authorization: `Bearer ${this.env.INTERNAL_SECRET}` },
        },
      );
      if (!res.ok) return 0;
      const body = (await res.json()) as { currentSeq?: number };
      return typeof body.currentSeq === "number" ? body.currentSeq : 0;
    } catch {
      return 0;
    }
  }

  /** Handles vivos por evento: tras hibernar, los cacheados no sirven. */
  private liveSockets(spaceId: string): Map<string, HibernatingWebSocket> {
    const out = new Map<string, HibernatingWebSocket>();
    try {
      for (const s of this.state.getWebSockets()) {
        const att = s.deserializeAttachment() as Attachment | null;
        if (att?.spaceId === spaceId && att.socketId) {
          out.set(att.socketId, s);
        }
      }
    } catch {
      // API de hibernación indisponible: fanout vacío (replay por cursor).
    }
    return out;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/notify" && req.method === "POST") {
      if (
        req.headers.get("authorization") !==
        `Bearer ${this.env.INTERNAL_SECRET}`
      ) {
        return new Response("forbidden", { status: 403 });
      }
      const event = (await req.json()) as BroadcastEvent & {
        spaceId: string;
        installationId?: string;
      };
      const live = this.liveSockets(event.spaceId);
      if (event.type === "installation.revoked" && event.installationId) {
        for (const id of hub.evictInstallation(
          event.spaceId,
          event.installationId,
        )) {
          try {
            live.get(id)?.close(4401, "revoked");
          } catch {
            // Ya cerrado.
          }
        }
        return Response.json({ ok: true });
      }
      hub.broadcast(event.spaceId, event, (socketId, message) => {
        const s = live.get(socketId);
        if (!s) return false;
        s.send(message);
        return true;
      });
      return Response.json({ ok: true });
    }
    const ticket = url.searchParams.get("ticket");
    const upgrade = req.headers.get("upgrade");
    if (!ticket || upgrade?.toLowerCase() !== "websocket") {
      return new Response("expected websocket with ticket", { status: 426 });
    }
    const claimed = await this.consumeTicket(ticket);
    if (!claimed) return new Response("invalid ticket", { status: 401 });
    const pair = new WebSocketPair();
    const client = pair[0] as unknown as HibernatingWebSocket;
    const server = pair[1] as unknown as HibernatingWebSocket;
    this.state.acceptWebSocket(server);
    const socketId = crypto.randomUUID();
    server.serializeAttachment({
      spaceId: claimed.spaceId,
      installationId: claimed.installationId,
      socketId,
    } satisfies Attachment);
    // RFC 6455: si el cliente ofreció subprotocolo y el 101 no lo confirma,
    // el cliente DEBE tumbar la conexión. Nuestro único protocolo es pair.v1
    // (el versionado real viaja en el hello JSON). Sin este eco, ningún
    // cliente que lo ofrezca recibe push en vivo.
    const offered = (req.headers.get("sec-websocket-protocol") ?? "")
      .split(",")
      .map((s) => s.trim())
      .find((s) => s === "pair.v1");
    const init: ResponseInit & { webSocket?: unknown } = {
      status: 101,
      webSocket: client as unknown as WebSocket,
    };
    if (offered) init.headers = { "Sec-WebSocket-Protocol": offered };
    return new Response(null, init as ResponseInit) as unknown as Response;
  }

  async webSocketMessage(
    socket: HibernatingWebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const attachment = socket.deserializeAttachment() as Attachment;
    if (typeof message !== "string") {
      socket.close(4400, "text-only");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      socket.close(4400, "bad-frame");
      return;
    }
    const msg = parsed as {
      type?: string;
      lastEventSeq?: number;
      installationId?: string;
    };
    if (msg.type === "hello") {
      // El hello debe corresponder a la instalación del ticket consumido.
      if (
        msg.installationId !== attachment.installationId ||
        !attachment.spaceId
      ) {
        socket.close(4401, "identity-mismatch");
        return;
      }
      hub.join(
        attachment.spaceId,
        attachment.socketId,
        attachment.installationId,
        msg.lastEventSeq ?? 0,
      );
      const seq = await this.currentSeq(attachment.spaceId);
      socket.send(
        JSON.stringify({
          type: "ready",
          currentSeq: seq,
          serverTime: new Date().toISOString(),
        }),
      );
      return;
    }
    if (msg.type === "client.resync") {
      const seq = attachment.spaceId
        ? await this.currentSeq(attachment.spaceId)
        : 0;
      socket.send(JSON.stringify({ type: "sync.ack", currentSeq: seq }));
      return;
    }
    if (msg.type === "ping") {
      socket.send(JSON.stringify({ type: "pong" }));
    }
  }

  webSocketClose(socket: HibernatingWebSocket): void {
    const attachment = socket.deserializeAttachment() as Attachment;
    if (attachment.spaceId) hub.leave(attachment.spaceId, attachment.socketId);
  }
}
