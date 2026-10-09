import { describe, expect, it } from "vitest";
import {
  INVITE_QR_SCHEME,
  inviteQrPayload,
  LOGIN_QR_SCHEME,
  loginQrPayload,
  parseQrPayload,
} from "./invite-qr";

describe("invite QR payload", () => {
  it("construye y reparsea el payload", () => {
    const payload = inviteQrPayload("abc123");
    expect(payload).toBe(`${INVITE_QR_SCHEME}abc123`);
    expect(parseQrPayload(payload)).toEqual({
      kind: "invite",
      token: "abc123",
    });
  });

  it("acepta el token pelado y rechaza vacío", () => {
    expect(parseQrPayload("  abc123  ")).toEqual({
      kind: "invite",
      token: "abc123",
    });
    expect(parseQrPayload("")).toBeNull();
    expect(parseQrPayload("cookie://invite/")).toBeNull();
  });

  it("distingue el QR de entrada (mismo usuario)", () => {
    const payload = loginQrPayload("attempt-1", "xyz789");
    expect(payload).toBe(`${LOGIN_QR_SCHEME}attempt-1/xyz789`);
    expect(parseQrPayload(payload)).toEqual({
      kind: "login",
      attemptId: "attempt-1",
      code: "xyz789",
    });
    expect(parseQrPayload("cookie://login/")).toBeNull();
    expect(parseQrPayload("cookie://login/solo-id")).toBeNull();
  });
});
