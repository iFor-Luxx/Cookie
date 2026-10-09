import { openMemoryDb, sqliteDb, sqlPairingStore } from "@cookie/server-db";
import { describe, expect, it } from "vitest";
import { type AppDeps, createApp } from "./app";
import { webCryptoPort } from "./crypto";

function testApp(): (req: Request) => Promise<Response> {
  const raw = openMemoryDb();
  const deps: AppDeps = {
    store: sqlPairingStore(sqliteDb(raw)),
    crypto: webCryptoPort(),
    clock: { nowIso: () => new Date().toISOString() },
    accessSecret: crypto.getRandomValues(new Uint8Array(32)),
  };
  return createApp(deps);
}

async function call(
  app: (req: Request) => Promise<Response>,
  method: string,
  path: string,
  opts: { body?: unknown; token?: string } = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = { "x-protocol-version": "1" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  const res = await app(new Request(`https://test${path}`, init));
  return {
    status: res.status,
    json: (await res.json()) as Record<string, unknown>,
  };
}

describe("API pairing H2", () => {
  it("flujo E2E: registro, espacio, invite, consume, me", async () => {
    const app = testApp();
    const a = await call(app, "POST", "/v1/installations", {
      body: { platform: "web", displayName: "A" },
    });
    expect(a.status).toBe(201);
    const accessA = a.json.accessToken as string;
    expect(a.json.installationSecret).toBeTypeOf("string");

    const bad = await call(app, "POST", "/v1/installations", {
      body: { platform: "web", displayName: "" },
    });
    expect(bad.status).toBe(400);

    const me0 = await call(app, "GET", "/v1/me", { token: accessA });
    expect(me0.status).toBe(200);
    expect(me0.json.pairSpaceId).toBeNull();

    const space = await call(app, "POST", "/v1/pair-spaces", {
      token: accessA,
    });
    expect(space.status).toBe(201);
    const spaceId = space.json.pairSpaceId as string;
    expect(space.json.recoverySecret).toBeTypeOf("string");

    const dupSpace = await call(app, "POST", "/v1/pair-spaces", {
      token: accessA,
    });
    expect(dupSpace.status).toBe(409);

    const inv = await call(app, "POST", `/v1/pair-spaces/${spaceId}/invites`, {
      token: accessA,
      body: {},
    });
    expect(inv.status).toBe(201);
    const token = inv.json.inviteToken as string;

    const b = await call(app, "POST", "/v1/invites/consume", {
      body: { inviteToken: token, displayName: "B", platform: "android" },
    });
    expect(b.status).toBe(201);
    expect(b.json.pairSpaceId).toBe(spaceId);

    const meB = await call(app, "GET", "/v1/me", {
      token: b.json.accessToken as string,
    });
    expect(meB.json.pairSpaceId).toBe(spaceId);
    expect(meB.json.displayName).toBe("B");

    const reuse = await call(app, "POST", "/v1/invites/consume", {
      body: { inviteToken: token, displayName: "C" },
    });
    expect(reuse.status).toBe(409);
  }, 30_000);

  it("refresh rota y el reuse revoca la familia", async () => {
    const app = testApp();
    const a = await call(app, "POST", "/v1/installations", {
      body: { platform: "web", displayName: "A" },
    });
    const refresh1 = a.json.refreshToken as string;
    const r1 = await call(app, "POST", "/v1/sessions/refresh", {
      token: refresh1,
    });
    expect(r1.status).toBe(200);
    const refresh2 = r1.json.refreshToken as string;
    // Reuse del refresh ya consumido → 401 y familia revocada.
    const replay = await call(app, "POST", "/v1/sessions/refresh", {
      token: refresh1,
    });
    expect(replay.status).toBe(401);
    const r2 = await call(app, "POST", "/v1/sessions/refresh", {
      token: refresh2,
    });
    expect(r2.status).toBe(401);
  }, 30_000);

  it("revocar cierra el acceso y exige confirmación", async () => {
    const app = testApp();
    const a = await call(app, "POST", "/v1/installations", {
      body: { platform: "web", displayName: "A" },
    });
    const access = a.json.accessToken as string;
    const instId = a.json.installationId as string;
    const noConfirm = await call(
      app,
      "POST",
      `/v1/installations/${instId}/revoke`,
      {
        token: access,
        body: {},
      },
    );
    expect(noConfirm.status).toBe(400);
    const ok = await call(app, "POST", `/v1/installations/${instId}/revoke`, {
      token: access,
      body: { confirm: true },
    });
    expect(ok.status).toBe(200);
    const me = await call(app, "GET", "/v1/me", { token: access });
    expect(me.status).toBe(401);
  }, 30_000);

  it("miembro ajeno no invita en espacio ajeno (IDOR)", async () => {
    const app = testApp();
    const a = await call(app, "POST", "/v1/installations", {
      body: { platform: "web", displayName: "A" },
    });
    const space = await call(app, "POST", "/v1/pair-spaces", {
      token: a.json.accessToken as string,
    });
    const c = await call(app, "POST", "/v1/installations", {
      body: { platform: "web", displayName: "C" },
    });
    const forbidden = await call(
      app,
      "POST",
      `/v1/pair-spaces/${space.json.pairSpaceId}/invites`,
      {
        token: c.json.accessToken as string,
        body: {},
      },
    );
    expect(forbidden.status).toBe(403);
  }, 30_000);

  it("recovery: challenge indistinguible y complete ata a B", async () => {
    const app = testApp();
    const a = await call(app, "POST", "/v1/installations", {
      body: { platform: "web", displayName: "A" },
    });
    const space = await call(app, "POST", "/v1/pair-spaces", {
      token: a.json.accessToken as string,
    });
    const spaceId = space.json.pairSpaceId as string;
    const recoverySecret = space.json.recoverySecret as string;
    const inv = await call(app, "POST", `/v1/pair-spaces/${spaceId}/invites`, {
      token: a.json.accessToken as string,
      body: {},
    });
    const b = await call(app, "POST", "/v1/invites/consume", {
      body: {
        inviteToken: inv.json.inviteToken,
        displayName: "B",
        platform: "android",
      },
    });
    // B pierde el dispositivo.
    await call(
      app,
      "POST",
      `/v1/installations/${b.json.installationId}/revoke`,
      {
        token: b.json.accessToken as string,
        body: { confirm: true },
      },
    );
    // Espacio inexistente → misma forma 201.
    const fake = await call(
      app,
      "POST",
      "/v1/pair-spaces/noexiste/recovery-challenges",
      {
        body: { installationId: "x" },
      },
    );
    expect(fake.status).toBe(201);
    expect(fake.json.challengeId).toBeTypeOf("string");

    const ch = await call(
      app,
      "POST",
      `/v1/pair-spaces/${spaceId}/recovery-challenges`,
      {
        body: { installationId: "nueva" },
      },
    );
    expect(ch.status).toBe(201);
    const badSecret = await call(app, "POST", "/v1/recovery/complete", {
      body: {
        challengeId: ch.json.challengeId,
        recoverySecret: "incorrecto",
        platform: "android",
      },
    });
    expect(badSecret.status).toBe(400);
    const done = await call(app, "POST", "/v1/recovery/complete", {
      body: {
        challengeId: ch.json.challengeId,
        recoverySecret,
        platform: "android",
      },
    });
    expect(done.status).toBe(201);
    expect(done.json.userId).toBe(b.json.userId);
  }, 30_000);

  it("health y versión de protocolo", async () => {
    const app = testApp();
    const res = await app(new Request("https://test/v1/health"));
    expect(res.status).toBe(200);
    const badProto = await app(
      new Request("https://test/v1/health", {
        headers: { "x-protocol-version": "99" },
      }),
    );
    expect(badProto.status).toBe(400);
  });
});
