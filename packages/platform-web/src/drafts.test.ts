import { createBlankDocument } from "@cookie/drawing";
import { describe, expect, it } from "vitest";
import { createDraftStore, memoryBackend } from "./drafts";

describe("draft store (memory backend)", () => {
  it("guarda, carga y limpia borrador", async () => {
    const store = createDraftStore(memoryBackend());
    expect(await store.loadDraft("a")).toBeNull();
    const doc = createBlankDocument(256, 256);
    await store.saveDraft("a", doc);
    expect(await store.loadDraft("a")).toEqual(doc);
    await store.clearDraft("a");
    expect(await store.loadDraft("a")).toBeNull();
  });

  it("dato corrupto devuelve null en vez de romper", async () => {
    const backend = memoryBackend();
    const store = createDraftStore(backend);
    await backend.set("draft:bad", "{no-json");
    expect(await store.loadDraft("bad")).toBeNull();
  });
});
