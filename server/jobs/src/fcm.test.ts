import { describe, expect, it } from "vitest";
import { sendSpacePush, serviceAccountJwt } from "./fcm";

async function testAccount(): Promise<{
  clientEmail: string;
  privateKeyPem: string;
}> {
  const key = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign"],
  );
  const der = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", key.privateKey),
  );
  let bin = "";
  for (const b of der) bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  const lines = b64.match(/.{1,64}/g) ?? [b64];
  return {
    clientEmail: "test@test.iam.gserviceaccount.com",
    privateKeyPem: `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----`,
  };
}

describe("fcm H8", () => {
  it("JWT de cuenta de servicio con 3 partes firmadas", async () => {
    const account = await testAccount();
    const jwt = await serviceAccountJwt(account, 1_700_000_000);
    expect(jwt.split(".")).toHaveLength(3);
    const part = jwt.split(".")[1];
    expect(part).toBeTypeOf("string");
    const payload = JSON.parse(
      atob((part as string).replace(/-/g, "+").replace(/_/g, "/")),
    ) as { iss: string; iat: number; exp: number };
    expect(payload.iss).toBe(account.clientEmail);
    expect(payload.exp - payload.iat).toBe(3600);
  });

  it("envía data-only, dedupea tokens y cuenta fallos", async () => {
    const seen: Array<{ url: string; body: string }> = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      const body = init?.body as string;
      seen.push({ url, body });
      const token = (JSON.parse(body) as { message: { token: string } }).message
        .token;
      return { ok: token !== "bad" } as Response;
    }) as typeof fetch;
    const res = await sendSpacePush(
      "proj",
      "at",
      ["a", "b", "a", "", "bad"],
      { spaceId: "s1", seq: 9 },
      fetchFn,
    );
    expect(res).toEqual({ sent: 2, failed: 1 });
    expect(seen).toHaveLength(3);
    const first = JSON.parse(seen[0]?.body ?? "{}") as {
      message: { token: string; data: Record<string, string> };
    };
    expect(first.message.data).toEqual({ spaceId: "s1", seq: "9" });
    expect(first.message).not.toHaveProperty("notification");
    expect(seen[0]?.url).toContain("/projects/proj/messages:send");
  });
});
