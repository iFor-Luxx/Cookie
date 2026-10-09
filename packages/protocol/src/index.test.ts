import { describe, expect, it } from "vitest";
import { DRAWING_SCHEMA_VERSION, PROTOCOL_VERSION } from "./index";

describe("protocol versions", () => {
  it("pins v1 contract", () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(DRAWING_SCHEMA_VERSION).toBe(1);
  });
});
