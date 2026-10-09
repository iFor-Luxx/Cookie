// @cookie/server-realtime — RoomHub: coordinación de sockets por PairSpace.
// Puro y testeable: el Durable Object es un wrapper fino (ver pair-room.ts).
// Reglas SDD §6.2: solo eventos confirmados, payloads pequeños, sin documento.

export interface RoomSocket {
  readonly id: string;
  send(message: string): void;
  close(code: number, reason: string): void;
}

/** Cierre recuperable: el cliente reconecta y pide replay por cursor. */
export const RECOVERABLE_CLOSE = 4100 as const;

export interface BroadcastEvent {
  readonly type: string;
  readonly seq?: number;
  readonly eventId?: string;
  readonly [key: string]: unknown;
}

interface Member {
  socket: RoomSocket;
  installationId: string;
  lastSeenSeq: number;
}

export class RoomHub {
  private readonly rooms = new Map<string, Map<string, Member>>();

  join(
    spaceId: string,
    socket: RoomSocket,
    installationId: string,
    lastSeenSeq: number,
  ): number {
    let room = this.rooms.get(spaceId);
    if (!room) {
      room = new Map();
      this.rooms.set(spaceId, room);
    }
    room.set(socket.id, { socket, installationId, lastSeenSeq });
    return room.size;
  }

  leave(spaceId: string, socketId: string): number {
    const room = this.rooms.get(spaceId);
    if (!room) return 0;
    room.delete(socketId);
    if (room.size === 0) this.rooms.delete(spaceId);
    return room.size;
  }

  /** Fanout a conexiones del espacio. Devuelve entregados/fallidos. */
  broadcast(
    spaceId: string,
    event: BroadcastEvent,
  ): { delivered: number; dropped: number } {
    const room = this.rooms.get(spaceId);
    if (!room) return { delivered: 0, dropped: 0 };
    const message = JSON.stringify(event);
    if (message.length > 64 * 1024) return { delivered: 0, dropped: room.size };
    let delivered = 0;
    let dropped = 0;
    for (const [id, member] of room) {
      try {
        member.socket.send(message);
        delivered++;
      } catch {
        // Backpressure/socket muerto: cerrar recuperable, replay por API.
        try {
          member.socket.close(RECOVERABLE_CLOSE, "slow-consumer");
        } catch {
          // Cierre también falló: nada más que hacer.
        }
        room.delete(id);
        dropped++;
      }
    }
    return { delivered, dropped };
  }

  /** Cierra sockets cuya instalación fue revocada. */
  evictInstallation(spaceId: string, installationId: string): number {
    const room = this.rooms.get(spaceId);
    if (!room) return 0;
    let evicted = 0;
    for (const [id, member] of room) {
      if (member.installationId === installationId) {
        try {
          member.socket.close(4401, "revoked");
        } catch {
          // Ya cerrado.
        }
        room.delete(id);
        evicted++;
      }
    }
    return evicted;
  }

  memberCount(spaceId: string): number {
    return this.rooms.get(spaceId)?.size ?? 0;
  }
}
