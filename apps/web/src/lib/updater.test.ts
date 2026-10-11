import { describe, expect, it } from "vitest";
import { isNewer, parseReleaseNode } from "./updater";

describe("updater", () => {
  it("isNewer solo acepta enteros positivos mayores", () => {
    expect(isNewer(1, 2)).toBe(true);
    expect(isNewer(2, 2)).toBe(false);
    expect(isNewer(3, 2)).toBe(false);
    expect(isNewer(0, 1)).toBe(false);
    expect(isNewer(1.5, 2)).toBe(false);
    expect(isNewer(Number.NaN, 2)).toBe(false);
  });

  it("parseReleaseNode acepta un nodo válido", () => {
    expect(
      parseReleaseNode({
        versionCode: 2,
        tag: "android-2",
        apkUrl: "https://github.com/x/y/releases/download/android-2/app.apk",
        sha256: "a".repeat(64),
        notes: "Arregla el zoom",
      }),
    ).toEqual({
      versionCode: 2,
      tag: "android-2",
      apkUrl: "https://github.com/x/y/releases/download/android-2/app.apk",
      sha256: "a".repeat(64),
      notes: "Arregla el zoom",
    });
  });

  it("parseReleaseNode rechaza nodos malformados o inseguros", () => {
    expect(parseReleaseNode(null)).toBeNull();
    expect(parseReleaseNode({})).toBeNull();
    expect(
      parseReleaseNode({
        versionCode: "2",
        tag: "android-2",
        apkUrl: "https://github.com/x.apk",
        sha256: "a".repeat(64),
      }),
    ).toBeNull();
    // URL no https
    expect(
      parseReleaseNode({
        versionCode: 2,
        tag: "t",
        apkUrl: "http://evil.test/app.apk",
        sha256: "a".repeat(64),
      }),
    ).toBeNull();
    // sha256 inválido
    expect(
      parseReleaseNode({
        versionCode: 2,
        tag: "t",
        apkUrl: "https://github.com/x.apk",
        sha256: "zzz",
      }),
    ).toBeNull();
  });
});
