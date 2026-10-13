// @cookie/server-realtime — RoomHub: coordinación de sockets por PairSpace.
// Puro y testeable: el Durable Object es un wrapper fino (ver pair-room.ts).
// Reglas SDD §6.2: solo eventos confirmados, payloads pequeños, sin documento.
//
// Hibernación: el DO se desalja de memoria en inactividad y el estado en
// memoria SE PIERDE (los sockets siguen abiertos). Por eso el hub guarda
// SOLO metadatos (socketId → instalación/cursor): los handles vivos se
// resuelven por evento vía `state.getWebSockets()` + attachment (que sí
// sobrevive). Guardar sockets aquí rompía el fanout tras hibernar.

export interface BroadcastEvent {
  readonly type: string;
  readonly seq?: number;
  readonly eventId?: string;
  readonly [key: string]: unknown;
}

interface Member {
  installationId: string;
  lastSeenSeq: number;
}

export class RoomHub {
  private readonly rooms = new Map<string, Map<string, Member>>();

  join(
    spaceId: string,
    socketId: string,
    installationId: string,
    lastSeenSeq: number,
  ): number {
    let room = this.rooms.get(spaceId);
    if (!room) {
      room = new Map();
      this.rooms.set(spaceId, room);
    }
    room.set(socketId, { installationId, lastSeenSeq });
    return room.size;
  }

  leave(spaceId: string, socketId: string): number {
    const room = this.rooms.get(spaceId);
    if (!room) return 0;
    room.delete(socketId);
    if (room.size === 0) this.rooms.delete(spaceId);
    return room.size;
  }

  /**
   * Fanout a conexiones del espacio. `send` resuelve el handle vivo por
   * evento (ver Hibernación arriba); devuelve false si ya no existe.
   */
  broadcast(
    spaceId: string,
    event: BroadcastEvent,
    send: (socketId: string, message: string) => boolean,
  ): { delivered: number; dropped: number } {
    const room = this.rooms.get(spaceId);
    if (!room) return { delivered: 0, dropped: 0 };
    const message = JSON.stringify(event);
    if (message.length > 64 * 1024) return { delivered: 0, dropped: room.size };
    let delivered = 0;
    let dropped = 0;
    for (const id of room.keys()) {
      try {
        if (send(id, message)) delivered++;
        else {
          room.delete(id);
          dropped++;
        }
      } catch {
        // Handle muerto: fuera del room; el runtime limpia al cerrar.
        room.delete(id);
        dropped++;
      }
    }
    if (room.size === 0) this.rooms.delete(spaceId);
    return { delivered, dropped };
  }

  /** Expulsa sockets de una instalación; devuelve sus socketIds (el DO los cierra). */
  evictInstallation(spaceId: string, installationId: string): string[] {
    const room = this.rooms.get(spaceId);
    if (!room) return [];
    const out: string[] = [];
    for (const [id, member] of room) {
      if (member.installationId === installationId) {
        room.delete(id);
        out.push(id);
      }
    }
    if (room.size === 0) this.rooms.delete(spaceId);
    return out;
  }

  memberCount(spaceId: string): number {
    return this.rooms.get(spaceId)?.size ?? 0;
  }
}
