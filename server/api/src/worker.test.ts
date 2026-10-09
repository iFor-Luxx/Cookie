import type { D1Like } from "@cookie/server-db";
import { describe, expect, it, vi } from "vitest";
import worker, { type WorkerEnv } from "./worker";

function fakeD1(): D1Like {
  return {
    prepare: () => ({
      bind: () => ({
        first: async () => null,
        all: async () => ({ results: [] }),
        run: async () => undefined,
      }),
    }),
    batch: async () => undefined,
  };
}

function setup() {
  const forwarded: string[] = [];
  const stub = {
    fetch: vi.fn(async (url: string | Request) => {
      forwarded.push(typeof url === "string" ? url : url.url);
      return new Response("do", { status: 200 });
    }),
  };
  const env: WorkerEnv = {
    DB: fakeD1(),
    BUCKET: {} as WorkerEnv["BUCKET"],
    PAIR_ROOM: { idFromName: (n: string) => `id:${n}`, get: () => stub },
    ACCESS_SECRET: "x".repeat(48),
    INTERNAL_SECRET: "internal-secret",
    ALLOWED_ORIGINS: "",
  };
  const ctx = { waitUntil: (_: Promise<unknown>) => undefined };
  return { env, ctx, stub, forwarded };
}

describe("worker", () => {
  it("enruta el upgrade WS de realtime-socket al DO del espacio", async () => {
    const { env, ctx, stub, forwarded } = setup();
    const req = new Request(
      "https://w.dev/v1/pair-spaces/space-9/realtime-socket?ticket=t1",
      { headers: { upgrade: "websocket" } },
    );
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);
    expect(stub.fetch).toHaveBeenCalledTimes(1);
    expect(forwarded[0]).toContain("space-9");
  });

  it("no enruta al DO las peticiones HTTP normales (health)", async () => {
    const { env, ctx, stub } = setup();
    const res = await worker.fetch(
      new Request("https://w.dev/v1/health"),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, protocol: 1 });
    expect(stub.fetch).not.toHaveBeenCalled();
  });
});
