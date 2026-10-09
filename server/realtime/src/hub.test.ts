import { describe, expect, it } from "vitest";
import { RECOVERABLE_CLOSE, RoomHub, type RoomSocket } from "./hub";

function fakeSocket(
  id: string,
  failOnSend = false,
): RoomSocket & { sent: string[]; closed: number | null } {
  return {
    id,
    sent: [],
    closed: null,
    send(message: string): void {
      if (failOnSend) throw new Error("buffer lleno");
      this.sent.push(message);
    },
    close(code: number): void {
      this.closed = code;
    },
  };
}

describe("RoomHub", () => {
  it("fanout entrega a miembros del espacio y aísla espacios", () => {
    const hub = new RoomHub();
    const a = fakeSocket("a");
    const b = fakeSocket("b");
    const other = fakeSocket("c");
    hub.join("s1", a, "ins-a", 0);
    hub.join("s1", b, "ins-b", 0);
    hub.join("s2", other, "ins-c", 0);
    const res = hub.broadcast("s1", {
      type: "drawing.created",
      seq: 1,
      eventId: "e1",
    });
    expect(res).toEqual({ delivered: 2, dropped: 0 });
    expect(a.sent).toHaveLength(1);
    expect(other.sent).toHaveLength(0);
    expect(hub.memberCount("s1")).toBe(2);
    hub.leave("s1", "a");
    expect(hub.memberCount("s1")).toBe(1);
  });

  it("socket lento se cierra recuperable y sale del room", () => {
    const hub = new RoomHub();
    const slow = fakeSocket("slow", true);
    const ok = fakeSocket("ok");
    hub.join("s1", slow, "ins-s", 0);
    hub.join("s1", ok, "ins-o", 0);
    const res = hub.broadcast("s1", { type: "drawing.created", seq: 2 });
    expect(res).toEqual({ delivered: 1, dropped: 1 });
    expect(slow.closed).toBe(RECOVERABLE_CLOSE);
    expect(hub.memberCount("s1")).toBe(1);
  });

  it("revocar instalación expulsa sus sockets", () => {
    const hub = new RoomHub();
    hub.join("s1", fakeSocket("a1"), "ins-a", 0);
    hub.join("s1", fakeSocket("a2"), "ins-a", 0);
    hub.join("s1", fakeSocket("b"), "ins-b", 0);
    expect(hub.evictInstallation("s1", "ins-a")).toBe(2);
    expect(hub.memberCount("s1")).toBe(1);
  });

  it("payload gigante no se distribuye", () => {
    const hub = new RoomHub();
    hub.join("s1", fakeSocket("a"), "ins-a", 0);
    const res = hub.broadcast("s1", {
      type: "drawing.created",
      blob: "x".repeat(70 * 1024),
    });
    expect(res.delivered).toBe(0);
  });
});
