import { describe, expect, it } from "vitest";
import { RoomHub } from "./hub";

// Los handles vivos los resuelve el DO por evento (getWebSockets +
// attachment): aquí se simulan con un mapa socketId → buzón.
function livebox() {
  const sent = new Map<string, string[]>();
  const dead = new Set<string>();
  return {
    sent,
    kill(id: string): void {
      dead.add(id);
    },
    send(id: string, message: string): boolean {
      if (dead.has(id)) return false;
      const box = sent.get(id) ?? [];
      box.push(message);
      sent.set(id, box);
      return true;
    },
  };
}

describe("RoomHub", () => {
  it("fanout entrega a miembros del espacio y aísla espacios", () => {
    const hub = new RoomHub();
    const live = livebox();
    hub.join("s1", "a", "ins-a", 0);
    hub.join("s1", "b", "ins-b", 0);
    hub.join("s2", "c", "ins-c", 0);
    const res = hub.broadcast(
      "s1",
      { type: "drawing.created", seq: 1, eventId: "e1" },
      (id, msg) => live.send(id, msg),
    );
    expect(res).toEqual({ delivered: 2, dropped: 0 });
    expect(live.sent.get("a")).toHaveLength(1);
    expect(live.sent.get("c")).toBeUndefined();
    expect(hub.memberCount("s1")).toBe(2);
    hub.leave("s1", "a");
    expect(hub.memberCount("s1")).toBe(1);
  });

  it("handle muerto sale del room sin romper el resto", () => {
    const hub = new RoomHub();
    const live = livebox();
    live.kill("slow");
    hub.join("s1", "slow", "ins-s", 0);
    hub.join("s1", "ok", "ins-o", 0);
    const res = hub.broadcast(
      "s1",
      { type: "drawing.created", seq: 2 },
      (id, msg) => live.send(id, msg),
    );
    expect(res).toEqual({ delivered: 1, dropped: 1 });
    expect(hub.memberCount("s1")).toBe(1);
  });

  it("revocar instalación devuelve sus socketIds para cerrar", () => {
    const hub = new RoomHub();
    hub.join("s1", "a1", "ins-a", 0);
    hub.join("s1", "a2", "ins-a", 0);
    hub.join("s1", "b", "ins-b", 0);
    expect(hub.evictInstallation("s1", "ins-a")).toEqual(["a1", "a2"]);
    expect(hub.memberCount("s1")).toBe(1);
  });

  it("payload gigante no se distribuye", () => {
    const hub = new RoomHub();
    const live = livebox();
    hub.join("s1", "a", "ins-a", 0);
    const res = hub.broadcast(
      "s1",
      { type: "drawing.created", blob: "x".repeat(70 * 1024) },
      (id, msg) => live.send(id, msg),
    );
    expect(res.delivered).toBe(0);
  });
});
