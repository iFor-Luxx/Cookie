// @cookie/server-realtime — PairRoom Durable Object (un actor por PairSpace).
// Wrapper fino sobre RoomHub. En prod corre en Cloudflare con WebSocket
// Hibernation; `state`/`env` son estructurales para no atar el repo al SDK.
//
// Flujo: cliente pide ticket en API (auth + membresía) → conecta al DO con
// ?ticket= → el DO consume el ticket vía endpoint interno → hello/ready.
// Cableado wrangler (pendiente deploy):
//   const stub = env.PAIR_ROOM.get(env.PAIR_ROOM.idFromName(spaceId));
//   wss://…/realtime?ticket=…
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
  API_INTERNAL_SECRET: string;
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
          authorization: `Bearer ${this.env.API_INTERNAL_SECRET}`,
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
          headers: { authorization: `Bearer ${this.env.API_INTERNAL_SECRET}` },
        },
      );
      if (!res.ok) return 0;
      const body = (await res.json()) as { currentSeq?: number };
      return typeof body.currentSeq === "number" ? body.currentSeq : 0;
    } catch {
      return 0;
    }
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/notify" && req.method === "POST") {
      if (
        req.headers.get("authorization") !==
        `Bearer ${this.env.API_INTERNAL_SECRET}`
      ) {
        return new Response("forbidden", { status: 403 });
      }
      const event = (await req.json()) as BroadcastEvent & {
        spaceId: string;
        installationId?: string;
      };
      if (event.type === "installation.revoked" && event.installationId) {
        hub.evictInstallation(event.spaceId, event.installationId);
        return Response.json({ ok: true });
      }
      hub.broadcast(event.spaceId, event);
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
    return new Response(null, {
      status: 101,
      webSocket: client as unknown as WebSocket,
    } as ResponseInit) as unknown as Response;
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
        wrapSocket(socket),
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

function wrapSocket(socket: HibernatingWebSocket): import("./hub").RoomSocket {
  const attachment = socket.deserializeAttachment() as Attachment;
  return {
    id: attachment.socketId,
    send: (message: string) => socket.send(message),
    close: (code: number, reason: string) => socket.close(code, reason),
  };
}
