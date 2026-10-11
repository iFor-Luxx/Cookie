import { describe, expect, it } from "vitest";
import { parseMirroredSession } from "./native-session";

const GOOD = JSON.stringify({
  accessToken: "a",
  refreshToken: "r",
  installationId: "i",
  userId: "u",
  spaceId: "s",
});

describe("parseMirroredSession", () => {
  it("acepta un espejo completo e ignora el spaceId", () => {
    expect(parseMirroredSession(GOOD)).toEqual({
      accessToken: "a",
      refreshToken: "r",
      installationId: "i",
      userId: "u",
    });
  });

  it("rechaza espejos rotos o incompletos", () => {
    expect(parseMirroredSession("")).toBeNull();
    expect(parseMirroredSession("no-json")).toBeNull();
    expect(parseMirroredSession("null")).toBeNull();
    expect(parseMirroredSession(JSON.stringify({ accessToken: "a" }))).toBeNull();
    expect(
      parseMirroredSession(
        JSON.stringify({
          accessToken: "a",
          refreshToken: "",
          installationId: "i",
          userId: "u",
        }),
      ),
    ).toBeNull();
  });
});
