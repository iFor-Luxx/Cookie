import { describe, expect, it } from "vitest";
import type { DrawingMeta } from "./api";
import { receivedOnly } from "./received";

function meta(id: string, author: string): DrawingMeta {
  return {
    id,
    pairSpaceId: "space-1",
    authorUserId: author,
    createdAt: "2026-10-11T00:00:00.000Z",
    width: 64,
    height: 64,
    contentHash: "a".repeat(64),
    eventSeq: 1,
    deletedAt: null,
  };
}

describe("receivedOnly", () => {
  it("oculta mis enviados y muestra los recibidos", () => {
    const items = [meta("a", "yo"), meta("b", "par"), meta("c", "yo")];
    expect(receivedOnly(items, "yo").map((d) => d.id)).toEqual(["b"]);
  });

  it("sin sesión no filtra nada", () => {
    const items = [meta("a", "yo")];
    expect(receivedOnly(items, null)).toEqual(items);
  });
});
