import { describe, expect, it } from "vitest";
import { RateLimiter, routeTemplate } from "./middleware";

describe("RateLimiter", () => {
  it("permite hasta el límite y luego 429 con retry-after", () => {
    let now = 0;
    const limiter = new RateLimiter(() => now);
    const rule = { limit: 3, windowMs: 60_000 };
    expect(limiter.check("k", rule)).toEqual({ ok: true });
    expect(limiter.check("k", rule)).toEqual({ ok: true });
    expect(limiter.check("k", rule)).toEqual({ ok: true });
    const blocked = limiter.check("k", rule);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    now += 60_001;
    expect(limiter.check("k", rule)).toEqual({ ok: true });
  });

  it("claves independientes no interfieren", () => {
    const limiter = new RateLimiter(() => 0);
    const rule = { limit: 1, windowMs: 60_000 };
    expect(limiter.check("a", rule).ok).toBe(true);
    expect(limiter.check("a", rule).ok).toBe(false);
    expect(limiter.check("b", rule).ok).toBe(true);
  });
});

describe("routeTemplate", () => {
  it("anonimiza IDs para métricas", () => {
    expect(routeTemplate("POST", "/v1/pair-spaces/abc123/drawings")).toBe(
      "POST /v1/pair-spaces/:id/drawings",
    );
    expect(routeTemplate("GET", "/v1/drawings/x/preview")).toBe(
      "GET /v1/drawings/:id/:blob",
    );
    expect(routeTemplate("GET", "/v1/nope")).toBe("GET other");
    expect(routeTemplate("POST", "/internal/tickets/consume")).toBe(
      "POST /internal/*",
    );
  });
});
