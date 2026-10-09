// server/api — límites, métricas y logs. Sin secretos en logs (SDD §11).
// Rate limit en memoria por isolate: defensa conservadora, no garantía
// distribuida. El throttle por IP real va en el edge al desplegar.

export interface RateLimit {
  readonly limit: number;
  readonly windowMs: number;
}

/** Ventanas conservadoras iniciales (H7, ajustar con métricas). */
export const RATE_LIMITS = {
  inviteCreate: { limit: 10, windowMs: 60_000 },
  inviteConsume: { limit: 20, windowMs: 60_000 },
  loginAttemptCreate: { limit: 20, windowMs: 60_000 },
  loginAttemptApprove: { limit: 20, windowMs: 60_000 },
  loginAttemptPoll: { limit: 60, windowMs: 60_000 },
  recovery: { limit: 10, windowMs: 60_000 },
  publish: { limit: 60, windowMs: 60_000 },
  uploadIntent: { limit: 120, windowMs: 60_000 },
  ticket: { limit: 60, windowMs: 60_000 },
} as const satisfies Record<string, RateLimit>;

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  /** True si pasa; false si excede (con segundos hasta reset para Retry-After). */
  check(
    key: string,
    rule: RateLimit,
  ): { ok: true } | { ok: false; retryAfterSeconds: number } {
    const t = this.now();
    const windowStart = t - rule.windowMs;
    const list = (this.hits.get(key) ?? []).filter((h) => h > windowStart);
    if (list.length >= rule.limit) {
      const oldest = list[0] ?? t;
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((oldest + rule.windowMs - t) / 1000),
      );
      this.hits.set(key, list);
      return { ok: false, retryAfterSeconds };
    }
    list.push(t);
    if (this.hits.size > 10_000) {
      const first = this.hits.keys().next().value;
      if (first !== undefined) this.hits.delete(first);
    }
    this.hits.set(key, list);
    return { ok: true };
  }
}

export function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export interface RequestLog {
  readonly requestId: string;
  readonly method: string;
  readonly route: string;
  readonly status: number;
  readonly ms: number;
}

/** Una línea JSON por request: sin headers, body, tokens ni contenido. */
export function logRequest(entry: RequestLog): void {
  try {
    const env = (globalThis as { process?: { env?: Record<string, string> } })
      .process?.env;
    if (env?.VITEST === "true" || env?.NODE_ENV === "test") return;
  } catch {
    // Sin process (Workers): loguear siempre.
  }
  console.log(
    JSON.stringify({
      msg: "http",
      requestId: entry.requestId,
      method: entry.method,
      route: entry.route,
      status: entry.status,
      ms: entry.ms,
    }),
  );
}

export class Metrics {
  private readonly counts = new Map<string, number>();
  private readonly startedAt = Date.now();

  record(route: string, status: number): void {
    const key = `${route} ${status}`;
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  snapshot(): { counts: Record<string, number>; uptimeMs: number } {
    return {
      counts: Object.fromEntries(this.counts),
      uptimeMs: Date.now() - this.startedAt,
    };
  }
}

/** Plantilla de ruta para métricas/logs (sin IDs: cardinalidad acotada). */
export function routeTemplate(method: string, pathname: string): string {
  const t = (pattern: RegExp, template: string): string | null =>
    pattern.test(pathname) ? `${method} ${template}` : null;
  return (
    t(/^\/v1\/health$/, "/v1/health") ??
    t(/^\/v1\/installations$/, "/v1/installations") ??
    t(/^\/v1\/installations\/push-token$/, "/v1/installations/push-token") ??
    t(/^\/v1\/installations\/[^/]+\/revoke$/, "/v1/installations/:id/revoke") ??
    t(/^\/v1\/sessions\/refresh$/, "/v1/sessions/refresh") ??
    t(/^\/v1\/sessions\/current$/, "/v1/sessions/current") ??
    t(/^\/v1\/me$/, "/v1/me") ??
    t(/^\/v1\/pair-spaces$/, "/v1/pair-spaces") ??
    t(/^\/v1\/pair-spaces\/[^/]+\/invites$/, "/v1/pair-spaces/:id/invites") ??
    t(/^\/v1\/pair-spaces\/[^/]+\/drawings$/, "/v1/pair-spaces/:id/drawings") ??
    t(/^\/v1\/pair-spaces\/[^/]+\/events$/, "/v1/pair-spaces/:id/events") ??
    t(/^\/v1\/pair-spaces\/[^/]+\/realtime$/, "/v1/pair-spaces/:id/realtime") ??
    t(
      /^\/v1\/pair-spaces\/[^/]+\/recovery-challenges$/,
      "/v1/pair-spaces/:id/recovery-challenges",
    ) ??
    t(/^\/v1\/pair-spaces\/[^/]+\/export$/, "/v1/pair-spaces/:id/export") ??
    t(/^\/v1\/invites\/consume$/, "/v1/invites/consume") ??
    t(/^\/v1\/login-attempts$/, "/v1/login-attempts") ??
    t(/^\/v1\/login-attempts\/approve$/, "/v1/login-attempts/approve") ??
    t(/^\/v1\/login-attempts\/poll$/, "/v1/login-attempts/poll") ??
    t(/^\/v1\/recovery\/complete$/, "/v1/recovery/complete") ??
    t(/^\/v1\/uploads\/intents$/, "/v1/uploads/intents") ??
    t(/^\/v1\/uploads\/[^/]+$/, "/v1/uploads/:id") ??
    t(/^\/v1\/drawings\/[^/]+$/, "/v1/drawings/:id") ??
    t(
      /^\/v1\/drawings\/[^/]+\/(document|preview)$/,
      "/v1/drawings/:id/:blob",
    ) ??
    t(/^\/internal\//, "/internal/*") ??
    `${method} other`
  );
}

/** CORS mínimo: orígenes configurados + Capacitor + localhost dev. */
export function corsHeaders(
  req: Request,
  allowedOrigins: readonly string[],
): Headers {
  const headers = new Headers();
  const origin = req.headers.get("origin");
  if (origin && allowedOrigins.includes(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "origin");
    headers.set(
      "access-control-allow-headers",
      "authorization, content-type, idempotency-key, x-protocol-version, x-client-version",
    );
    headers.set(
      "access-control-allow-methods",
      "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    );
    headers.set("access-control-max-age", "86400");
  }
  return headers;
}
