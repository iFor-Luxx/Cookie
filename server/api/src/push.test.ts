import type { Db } from "@cookie/server-db";
import { describe, expect, it, vi } from "vitest";
import { makePush, parseServiceAccount } from "./push";

const fakeDb = {} as Db;

const validSa = JSON.stringify({
  client_email: "pusher@cookie-94245.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n",
  project_id: "cookie-94245",
});

describe("parseServiceAccount", () => {
  it("devuelve null si falta o es inválida", () => {
    expect(parseServiceAccount(undefined)).toBeNull();
    expect(parseServiceAccount("")).toBeNull();
    expect(parseServiceAccount("not-json")).toBeNull();
    expect(parseServiceAccount(JSON.stringify({ project_id: "x" }))).toBeNull();
  });

  it("mapea client_email/private_key/project_id", () => {
    const parsed = parseServiceAccount(validSa);
    expect(parsed?.projectId).toBe("cookie-94245");
    expect(parsed?.account.clientEmail).toContain("iam.gserviceaccount");
    expect(parsed?.account.privateKeyPem).toContain("BEGIN PRIVATE KEY");
  });
});

describe("makePush", () => {
  it("sin cuenta de servicio no hay push", () => {
    expect(makePush(undefined, fakeDb)).toBeNull();
  });

  it("envía a los tokens del espacio con access token y proyecto", async () => {
    const send = vi.fn(async () => ({ sent: 1, failed: 0 }));
    const push = makePush(validSa, fakeDb, {
      listTokens: async () => ["tok-1", "tok-2"],
      getAccessToken: async () => "access-abc",
      send,
    });
    expect(push).not.toBeNull();
    await push?.("space-1", 7);
    expect(send).toHaveBeenCalledWith(
      "cookie-94245",
      "access-abc",
      ["tok-1", "tok-2"],
      { spaceId: "space-1", seq: 7 },
    );
  });

  it("no llama a la red si no hay tokens vigentes", async () => {
    const send = vi.fn(async () => ({ sent: 0, failed: 0 }));
    const getAccessToken = vi.fn(async () => "access-abc");
    const push = makePush(validSa, fakeDb, {
      listTokens: async () => [],
      getAccessToken,
      send,
    });
    await push?.("space-1", 7);
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
