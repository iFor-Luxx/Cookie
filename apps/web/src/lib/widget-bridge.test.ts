import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<{ method: string; opts?: unknown }> = [];

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => "android",
  },
  registerPlugin: () => ({
    refreshWidget: (opts: unknown) => {
      calls.push({ method: "refreshWidget", opts });
      return Promise.resolve();
    },
    clearWidget: () => {
      calls.push({ method: "clearWidget" });
      return Promise.resolve();
    },
  }),
}));

type Timeline = {
  drawings: Array<{ id: string; createdAt: string }>;
  nextCursor: string | null;
};

let timeline: Timeline = { drawings: [], nextCursor: null };
let doc = "";

vi.mock("./api", () => ({
  api: {
    timeline: () => Promise.resolve(timeline),
    documentText: () => Promise.resolve(doc),
  },
}));

import { syncNativeWidget, widgetBridgeSupported } from "./widget-bridge";

beforeEach(() => {
  calls.length = 0;
  timeline = { drawings: [], nextCursor: null };
  doc = "";
});

describe("widget-bridge", () => {
  it("soportado en android nativo", () => {
    expect(widgetBridgeSupported()).toBe(true);
  });

  it("pinta la cabeza del timeline al instante", async () => {
    timeline = {
      drawings: [{ id: "d1", createdAt: "2026-10-13T00:00:00.000Z" }],
      nextCursor: null,
    };
    doc = '{"schemaVersion":1}';
    await syncNativeWidget("space-1", 7);
    expect(calls).toEqual([
      {
        method: "refreshWidget",
        opts: {
          drawingId: "d1",
          createdAt: "2026-10-13T00:00:00.000Z",
          cursor: 7,
          doc: '{"schemaVersion":1}',
        },
      },
    ]);
  });

  it("vacía el widget si no hay dibujos", async () => {
    await syncNativeWidget("space-1", 9);
    expect(calls).toEqual([{ method: "clearWidget" }]);
  });
});
