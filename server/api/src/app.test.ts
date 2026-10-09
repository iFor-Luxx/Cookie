import {
  openMemoryDb,
  sqliteDb,
  sqlLibraryStore,
  sqlPairingStore,
  sqlWsTicketStore,
} from "@cookie/server-db";
import { memoryObjectStore } from "@cookie/storage";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { webCryptoPort } from "./crypto";
import type { AppDeps } from "./http";
import { Metrics, RateLimiter } from "./middleware";

function testApp(notified: Array<Record<string, unknown>> = []): {
  app: (req: Request) => Promise<Response>;
  notified: Array<Record<string, unknown>>;
} {
  const raw = openMemoryDb();
  const db = sqliteDb(raw);
  const deps: AppDeps = {
    store: sqlPairingStore(db),
    library: sqlLibraryStore(db),
    tickets: sqlWsTicketStore(db),
    objects: memoryObjectStore(),
    crypto: webCryptoPort(),
    clock: { nowIso: () => new Date().toISOString() },
    accessSecret: crypto.getRandomValues(new Uint8Array(32)),
    internalSecret: "test-internal",
    notify: async (n) => void notified.push({ ...n }),
    limiter: new RateLimiter(),
    metrics: new Metrics(),
    allowedOrigins: [],
  };
  return { app: createApp(deps), notified };
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
    const app = testApp().app;
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

    const bReg = await call(app, "POST", "/v1/installations", {
      body: { platform: "android", displayName: "B" },
    });
    expect(bReg.status).toBe(201);
    const b = await call(app, "POST", "/v1/invites/consume", {
      token: bReg.json.accessToken as string,
      body: { inviteToken: token },
    });
    expect(b.status).toBe(201);
    expect(b.json.pairSpaceId).toBe(spaceId);

    const meB = await call(app, "GET", "/v1/me", {
      token: bReg.json.accessToken as string,
    });
    expect(meB.json.pairSpaceId).toBe(spaceId);
    expect(meB.json.displayName).toBe("B");

    const reuse = await call(app, "POST", "/v1/invites/consume", {
      token: accessA,
      body: { inviteToken: token },
    });
    expect(reuse.status).toBe(409);
  }, 30_000);

  it("login por QR: el PC muestra, el celular aprueba, misma sala", async () => {
    const app = testApp().app;
    const a = await call(app, "POST", "/v1/installations", {
      body: { platform: "android", displayName: "A" },
    });
    const accessA = a.json.accessToken as string;
    const space = await call(app, "POST", "/v1/pair-spaces", {
      token: accessA,
    });
    const spaceId = space.json.pairSpaceId as string;
    // El PC (sin sesión) abre la espera.
    const attempt = await call(app, "POST", "/v1/login-attempts", {
      body: { platform: "web" },
    });
    expect(attempt.status).toBe(201);
    const attemptId = attempt.json.attemptId as string;
    const code = attempt.json.loginCode as string;
    // Antes de aprobar: pendiente.
    const pending = await call(app, "POST", "/v1/login-attempts/poll", {
      body: { attemptId, loginCode: code },
    });
    expect(pending.status).toBe(200);
    expect(pending.json.status).toBe("pending");
    // Aprobar exige sesión.
    const anonApprove = await call(app, "POST", "/v1/login-attempts/approve", {
      body: { attemptId, loginCode: code },
    });
    expect(anonApprove.status).toBe(401);
    // El celular aprueba con su sesión.
    const approve = await call(app, "POST", "/v1/login-attempts/approve", {
      token: accessA,
      body: { attemptId, loginCode: code },
    });
    expect(approve.status).toBe(200);
    // El PC sondea y entra: misma identidad, instalación nueva, misma sala.
    const join = await call(app, "POST", "/v1/login-attempts/poll", {
      body: { attemptId, loginCode: code },
    });
    expect(join.status).toBe(201);
    expect(join.json.status).toBe("approved");
    expect(join.json.userId).toBe(a.json.userId);
    expect(join.json.installationId).not.toBe(a.json.installationId);
    expect(join.json.pairSpaceId).toBe(spaceId);
    // Un solo uso.
    const reusePoll = await call(app, "POST", "/v1/login-attempts/poll", {
      body: { attemptId, loginCode: code },
    });
    expect(reusePoll.status).toBe(409);
  }, 30_000);

  it("refresh rota y el reuse revoca la familia", async () => {
    const app = testApp().app;
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
    const app = testApp().app;
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
    const app = testApp().app;
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
    const app = testApp().app;
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
    const bReg = await call(app, "POST", "/v1/installations", {
      body: { platform: "android", displayName: "B" },
    });
    const b = await call(app, "POST", "/v1/invites/consume", {
      token: bReg.json.accessToken as string,
      body: {
        inviteToken: inv.json.inviteToken,
      },
    });
    expect(b.status).toBe(201);
    // B pierde el dispositivo.
    await call(
      app,
      "POST",
      `/v1/installations/${bReg.json.installationId}/revoke`,
      {
        token: bReg.json.accessToken as string,
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
    expect(done.json.userId).toBe(bReg.json.userId);
  }, 30_000);

  it("health y versión de protocolo", async () => {
    const app = testApp().app;
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

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);

function drawingDoc(): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      schemaVersion: 1,
      canvas: { width: 1024, height: 1024, background: "#FFFFFF" },
      strokes: [],
    }),
  );
}

interface Paired {
  app: (req: Request) => Promise<Response>;
  accessA: string;
  accessB: string;
  spaceId: string;
}

async function registerPair(): Promise<Paired> {
  const app = testApp().app;
  const a = await call(app, "POST", "/v1/installations", {
    body: { platform: "web", displayName: "A" },
  });
  const space = await call(app, "POST", "/v1/pair-spaces", {
    token: a.json.accessToken as string,
  });
  const spaceId = space.json.pairSpaceId as string;
  const inv = await call(app, "POST", `/v1/pair-spaces/${spaceId}/invites`, {
    token: a.json.accessToken as string,
    body: {},
  });
  const bReg = await call(app, "POST", "/v1/installations", {
    body: { platform: "android", displayName: "B" },
  });
  const b = await call(app, "POST", "/v1/invites/consume", {
    token: bReg.json.accessToken as string,
    body: {
      inviteToken: inv.json.inviteToken,
    },
  });
  expect(b.status).toBe(201);
  return {
    app,
    accessA: a.json.accessToken as string,
    accessB: bReg.json.accessToken as string,
    spaceId,
  };
}

async function putBytes(
  app: (req: Request) => Promise<Response>,
  uploadId: string,
  token: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await app(
    new Request(`https://test/v1/uploads/${uploadId}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": contentType,
      },
      body: bytes as BodyInit,
    }),
  );
  return {
    status: res.status,
    json: (await res.json()) as Record<string, unknown>,
  };
}

async function publishOne(
  paired: Paired,
  drawingId: string,
  key: string,
  token: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const { app, spaceId } = paired;
  const doc = drawingDoc();
  const docHash = await sha256Hex(doc);
  const previewHash = await sha256Hex(PNG_BYTES);
  const intentDoc = await call(app, "POST", "/v1/uploads/intents", {
    token,
    body: {
      drawingId,
      purpose: "drawing-doc",
      contentHash: docHash,
      byteSize: doc.length,
      contentType: "application/json",
    },
  });
  expect(intentDoc.status).toBe(201);
  const putDoc = await putBytes(
    app,
    intentDoc.json.uploadId as string,
    token,
    doc,
    "application/json",
  );
  expect(putDoc.status).toBe(200);
  const intentPrev = await call(app, "POST", "/v1/uploads/intents", {
    token,
    body: {
      drawingId,
      purpose: "drawing-preview",
      contentHash: previewHash,
      byteSize: PNG_BYTES.length,
      contentType: "image/png",
    },
  });
  expect(intentPrev.status).toBe(201);
  const putPrev = await putBytes(
    app,
    intentPrev.json.uploadId as string,
    token,
    PNG_BYTES,
    "image/png",
  );
  expect(putPrev.status).toBe(200);
  const body = { drawingId, contentHash: docHash, width: 1024, height: 1024 };
  const res = await app(
    new Request(`https://test/v1/pair-spaces/${spaceId}/drawings`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": key,
        "x-protocol-version": "1",
      },
      body: JSON.stringify(body),
    }),
  );
  return {
    status: res.status,
    json: (await res.json()) as Record<string, unknown>,
  };
}

describe("API biblioteca H4", () => {
  it("publica, reintenta idempotente y timeline/eventos convergen", async () => {
    const paired = await registerPair();
    const { app, accessA, accessB, spaceId } = paired;

    const p1 = await publishOne(paired, "draw-1", "key-1", accessA);
    expect(p1.status).toBe(201);
    const drawing = p1.json.drawing as Record<string, unknown>;
    expect(drawing.id).toBe("draw-1");
    expect(drawing.eventSeq).toBe(1);

    // Reintento misma key + mismo body → mismo resultado, sin duplicar.
    const retry = await publishOne(paired, "draw-1", "key-1", accessA);
    expect(retry.status).toBe(201);

    // Misma key + body distinto → 409.
    const conflict = await app(
      new Request(`https://test/v1/pair-spaces/${spaceId}/drawings`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessA}`,
          "idempotency-key": "key-1",
          "x-protocol-version": "1",
        },
        body: JSON.stringify({
          drawingId: "draw-1",
          contentHash: "0".repeat(64),
          width: 64,
          height: 64,
        }),
      }),
    );
    expect(conflict.status).toBe(409);

    // Sin Idempotency-Key → 400.
    const noKey = await call(
      app,
      "POST",
      `/v1/pair-spaces/${spaceId}/drawings`,
      {
        token: accessA,
        body: {
          drawingId: "x",
          contentHash: "0".repeat(64),
          width: 1,
          height: 1,
        },
      },
    );
    expect(noKey.status).toBe(400);

    // Segunda publicación por B.
    const p2 = await publishOne(paired, "draw-2", "key-2", accessB);
    expect(p2.status).toBe(201);

    // Timeline paginado: limit=1 → cursor.
    const page1 = await call(
      app,
      "GET",
      `/v1/pair-spaces/${spaceId}/drawings?limit=1`,
      {
        token: accessB,
      },
    );
    expect(page1.status).toBe(200);
    const items1 = page1.json.drawings as unknown[];
    expect(items1).toHaveLength(1);
    expect(page1.json.nextCursor).toBeTypeOf("string");
    const page2 = await call(
      app,
      "GET",
      `/v1/pair-spaces/${spaceId}/drawings?limit=1&cursor=${page1.json.nextCursor}`,
      { token: accessA },
    );
    expect(page2.json.drawings as unknown[]).toHaveLength(1);
    expect(page2.json.nextCursor).toBeNull();

    // Eventos: replay desde 0 trae 2; desde current vacío.
    const ev = await call(
      app,
      "GET",
      `/v1/pair-spaces/${spaceId}/events?afterSeq=0`,
      {
        token: accessA,
      },
    );
    expect(ev.status).toBe(200);
    expect(ev.json.events as unknown[]).toHaveLength(2);
    expect(ev.json.currentSeq).toBe(2);
    expect(ev.json.snapshotRequired).toBe(false);
    const evEmpty = await call(
      app,
      "GET",
      `/v1/pair-spaces/${spaceId}/events?afterSeq=2`,
      {
        token: accessA,
      },
    );
    expect(evEmpty.json.events as unknown[]).toHaveLength(0);

    // Bytes del documento y preview.
    const docRes = await app(
      new Request("https://test/v1/drawings/draw-1/document", {
        headers: { authorization: `Bearer ${accessB}` },
      }),
    );
    expect(docRes.status).toBe(200);
    expect(docRes.headers.get("content-type")).toContain("application/json");
    const prevRes = await app(
      new Request("https://test/v1/drawings/draw-1/preview", {
        headers: { authorization: `Bearer ${accessA}` },
      }),
    );
    expect(prevRes.status).toBe(200);
  }, 60_000);

  it("upload con hash erróneo se rechaza y ajeno no lee", async () => {
    const paired = await registerPair();
    const { app, accessA, spaceId } = paired;
    const doc = drawingDoc();
    const intent = await call(app, "POST", "/v1/uploads/intents", {
      token: accessA,
      body: {
        drawingId: "draw-x",
        purpose: "drawing-doc",
        contentHash: "f".repeat(64),
        byteSize: doc.length,
        contentType: "application/json",
      },
    });
    expect(intent.status).toBe(201);
    const bad = await putBytes(
      app,
      intent.json.uploadId as string,
      accessA,
      doc,
      "application/json",
    );
    expect(bad.status).toBe(400);

    const c = await call(app, "POST", "/v1/installations", {
      body: { platform: "web", displayName: "C" },
    });
    const forbiddenTimeline = await call(
      app,
      "GET",
      `/v1/pair-spaces/${spaceId}/drawings`,
      {
        token: c.json.accessToken as string,
      },
    );
    expect(forbiddenTimeline.status).toBe(403);
  }, 60_000);

  it("borrado: miembro no autor ni owner falla; autor borra; re-borrado ok", async () => {
    const paired = await registerPair();
    const { app, accessA, accessB } = paired;
    await publishOne(paired, "draw-9", "key-9", accessA);

    const byMember = await call(app, "DELETE", "/v1/drawings/draw-9", {
      token: accessB,
    });
    expect(byMember.status).toBe(403);

    const del = await call(app, "DELETE", "/v1/drawings/draw-9", {
      token: accessA,
    });
    expect(del.status).toBe(200);

    const again = await call(app, "DELETE", "/v1/drawings/draw-9", {
      token: accessA,
    });
    expect(again.status).toBe(200);

    const gone = await call(app, "GET", "/v1/drawings/draw-9", {
      token: accessA,
    });
    expect(gone.status).toBe(404);

    const timeline = await call(
      app,
      "GET",
      `/v1/pair-spaces/${paired.spaceId}/drawings`,
      {
        token: accessA,
      },
    );
    expect(timeline.json.drawings as unknown[]).toHaveLength(0);

    const ev = await call(
      app,
      "GET",
      `/v1/pair-spaces/${paired.spaceId}/events?afterSeq=0`,
      {
        token: accessB,
      },
    );
    const types = (ev.json.events as Array<{ type: string }>).map(
      (e) => e.type,
    );
    expect(types).toEqual(["drawing.created", "drawing.deleted"]);
  }, 60_000);
});

describe("API realtime H5", () => {
  it("ticket exige membresía; consumo interno un solo uso; publish notifica", async () => {
    const notified: Array<Record<string, unknown>> = [];
    const { app } = testApp(notified);
    const a = await call(app, "POST", "/v1/installations", {
      body: { platform: "web", displayName: "A" },
    });
    const space = await call(app, "POST", "/v1/pair-spaces", {
      token: a.json.accessToken as string,
    });
    const spaceId = space.json.pairSpaceId as string;

    const c = await call(app, "POST", "/v1/installations", {
      body: { platform: "web", displayName: "C" },
    });
    const forbidden = await call(
      app,
      "GET",
      `/v1/pair-spaces/${spaceId}/realtime`,
      {
        token: c.json.accessToken as string,
      },
    );
    expect(forbidden.status).toBe(403);

    const ticket = await call(
      app,
      "GET",
      `/v1/pair-spaces/${spaceId}/realtime`,
      {
        token: a.json.accessToken as string,
      },
    );
    expect(ticket.status).toBe(200);
    const ticketValue = ticket.json.ticket as string;

    const badSecret = await app(
      new Request("https://test/internal/tickets/consume", {
        method: "POST",
        headers: {
          authorization: "Bearer wrong",
          "content-type": "application/json",
        },
        body: JSON.stringify({ ticket: ticketValue }),
      }),
    );
    expect(badSecret.status).toBe(403);

    const consume = async (): Promise<number> =>
      (
        await app(
          new Request("https://test/internal/tickets/consume", {
            method: "POST",
            headers: {
              authorization: "Bearer test-internal",
              "content-type": "application/json",
            },
            body: JSON.stringify({ ticket: ticketValue }),
          }),
        )
      ).status;
    expect(await consume()).toBe(200);
    expect(await consume()).toBe(404); // un solo uso

    // Publicar dispara notify post-commit.
    const inv = await call(app, "POST", `/v1/pair-spaces/${spaceId}/invites`, {
      token: a.json.accessToken as string,
      body: {},
    });
    const bReg = await call(app, "POST", "/v1/installations", {
      body: { platform: "android", displayName: "B" },
    });
    const b = await call(app, "POST", "/v1/invites/consume", {
      token: bReg.json.accessToken as string,
      body: {
        inviteToken: inv.json.inviteToken,
      },
    });
    expect(b.status).toBe(201);
    const paired = {
      app,
      accessA: a.json.accessToken as string,
      accessB: bReg.json.accessToken as string,
      spaceId,
    };
    const before = notified.length;
    const pub = await publishOne(paired, "draw-rt", "key-rt", paired.accessA);
    expect(pub.status).toBe(201);
    expect(notified.length).toBe(before + 1);
    expect(notified[notified.length - 1]).toMatchObject({
      spaceId,
      type: "drawing.created",
    });

    const del = await call(app, "DELETE", "/v1/drawings/draw-rt", {
      token: paired.accessA,
    });
    expect(del.status).toBe(200);
    expect(notified[notified.length - 1]).toMatchObject({
      type: "drawing.deleted",
    });
  }, 60_000);
});

describe("API push token H6", () => {
  it("registra y limpia el token FCM con la sesión", async () => {
    const { app } = testApp();
    const a = await call(app, "POST", "/v1/installations", {
      body: { platform: "android", displayName: "A" },
    });
    const token = a.json.accessToken as string;
    const bad = await call(app, "POST", "/v1/installations/push-token", {
      token,
      body: {},
    });
    expect(bad.status).toBe(400);
    const ok = await call(app, "POST", "/v1/installations/push-token", {
      token,
      body: { token: "fcm:abc123" },
    });
    expect(ok.status).toBe(200);
    const anon = await call(app, "POST", "/v1/installations/push-token", {
      body: { token: "fcm:abc123" },
    });
    expect(anon.status).toBe(401);
  }, 30_000);
});

describe("API hardening H7", () => {
  it("rate limit en consume: sin auth 401; ráfaga autenticada → 429", async () => {
    const { app } = testApp();
    const anon = await app(
      new Request("https://test/v1/invites/consume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inviteToken: "x" }),
      }),
    );
    expect(anon.status).toBe(401);
    const a = await call(app, "POST", "/v1/installations", {
      body: { platform: "web", displayName: "A" },
    });
    const token = a.json.accessToken as string;
    let limited = 0;
    for (let i = 0; i < 25; i++) {
      const res = await app(
        new Request("https://test/v1/invites/consume", {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "x-protocol-version": "1",
          },
          body: JSON.stringify({ inviteToken: "x" }),
        }),
      );
      if (res.status === 429) {
        limited++;
        expect(res.headers.get("retry-after")).toBeTypeOf("string");
        const body = (await res.json()) as {
          error: { code: string; retryable: boolean };
        };
        expect(body.error.code).toBe("RATE_LIMITED");
        expect(body.error.retryable).toBe(true);
      }
    }
    expect(limited).toBeGreaterThan(0);
  }, 30_000);

  it("cuerpo JSON gigante → 413 y CORS preflight 204", async () => {
    const { app } = testApp();
    const big = await app(
      new Request("https://test/v1/installations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": "9999999",
        },
        body: JSON.stringify({ platform: "web", displayName: "A" }),
      }),
    );
    expect(big.status).toBe(413);
    const preflight = await app(
      new Request("https://test/v1/me", {
        method: "OPTIONS",
        headers: { origin: "capacitor://localhost" },
      }),
    );
    // Sin orígenes configurados en tests: 204 sin reflejo.
    expect(preflight.status).toBe(204);
  }, 30_000);

  it("export devuelve manifiesto y GC limpia vencidos; revoke notifica evict", async () => {
    const notified: Array<Record<string, unknown>> = [];
    const { app } = testApp(notified);
    const a = await call(app, "POST", "/v1/installations", {
      body: { platform: "web", displayName: "A" },
    });
    const accessA = a.json.accessToken as string;
    const space = await call(app, "POST", "/v1/pair-spaces", {
      token: accessA,
    });
    const spaceId = space.json.pairSpaceId as string;

    const empty = await call(app, "GET", `/v1/pair-spaces/${spaceId}/export`, {
      token: accessA,
    });
    expect(empty.status).toBe(200);
    expect(empty.json.version).toBe(1);
    expect(empty.json.drawings).toEqual([]);

    const c = await call(app, "POST", "/v1/installations", {
      body: { platform: "web", displayName: "C" },
    });
    const forbiddenExport = await call(
      app,
      "GET",
      `/v1/pair-spaces/${spaceId}/export`,
      {
        token: c.json.accessToken as string,
      },
    );
    expect(forbiddenExport.status).toBe(403);

    // GC con secreto erróneo → 403; con bueno → contadores.
    const gcBad = await app(
      new Request("https://test/internal/maintenance/gc", {
        method: "POST",
        headers: { authorization: "Bearer wrong" },
      }),
    );
    expect(gcBad.status).toBe(403);
    const gc = await app(
      new Request("https://test/internal/maintenance/gc", {
        method: "POST",
        headers: { authorization: "Bearer test-internal" },
      }),
    );
    expect(gc.status).toBe(200);
    const gcBody = (await gc.json()) as {
      uploadIntents: number;
      tickets: number;
    };
    expect(gcBody.uploadIntents).toBe(0);

    // Revoke notifica evict del socket en el espacio.
    const instId = a.json.installationId as string;
    const before = notified.length;
    const revoke = await call(
      app,
      "POST",
      `/v1/installations/${instId}/revoke`,
      {
        token: accessA,
        body: { confirm: true },
      },
    );
    expect(revoke.status).toBe(200);
    expect(
      notified.slice(before).filter((n) => n.type === "installation.revoked"),
    ).toHaveLength(1);
  }, 60_000);
});
