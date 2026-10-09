// server/api — helpers HTTP compartidos (H2 pairing + H4 biblioteca).
import type {
  ClockPort,
  CryptoPort,
  DomainErrorCode,
  Installation,
  LibraryErrorCode,
  LibraryStore,
  PairingStore,
  User,
} from "@cookie/core";
import type { errorCodeSchema } from "@cookie/protocol";
import type { SessionStore, WsTicketStore } from "@cookie/server-db";
import type { ObjectStore } from "@cookie/storage";
import {
  clientIp,
  type Metrics,
  type RateLimit,
  type RateLimiter,
} from "./middleware";
import { verifyAccessToken } from "./tokens";

export interface RealtimeNotification {
  readonly spaceId: string;
  /** drawing.created | drawing.deleted | installation.revoked */
  readonly type: string;
  readonly seq?: number;
  readonly eventId?: string;
  readonly entityId?: string;
  readonly actorUserId?: string;
  readonly installationId?: string;
}

export interface AppDeps {
  store: PairingStore & SessionStore;
  library: LibraryStore;
  tickets: WsTicketStore;
  objects: ObjectStore;
  crypto: CryptoPort;
  clock: ClockPort;
  accessSecret: Uint8Array;
  /** Secreto interno API↔DO. En tests, valor fijo. */
  internalSecret: string;
  /** Fanout post-commit (DO en prod, memoria en tests). Best-effort. */
  notify: (n: RealtimeNotification) => Promise<void>;
  /** Límites y métricas (memoria por isolate; edge real al desplegar). */
  limiter: RateLimiter;
  metrics: Metrics;
  allowedOrigins: readonly string[];
}

export type ErrorCode = ReturnType<typeof errorCodeSchema.parse>;

export function err(
  requestId: string,
  code: ErrorCode,
  message: string,
  status: number,
  retryable = false,
): Response {
  return Response.json(
    { error: { code, message, retryable }, requestId },
    { status },
  );
}

const domainStatus: Record<string, { status: number; code: ErrorCode }> = {
  VALIDATION_ERROR: { status: 400, code: "VALIDATION_ERROR" },
  UNAUTHENTICATED: { status: 401, code: "UNAUTHENTICATED" },
  FORBIDDEN: { status: 403, code: "FORBIDDEN" },
  NOT_FOUND: { status: 404, code: "NOT_FOUND" },
  PAIRSPACE_FULL: { status: 409, code: "PAIRSPACE_FULL" },
  INVITE_EXPIRED: { status: 410, code: "INVITE_EXPIRED" },
  INVITE_ALREADY_USED: { status: 409, code: "INVITE_ALREADY_USED" },
  LOGIN_EXPIRED: { status: 410, code: "LOGIN_EXPIRED" },
  LOGIN_ALREADY_USED: { status: 409, code: "LOGIN_ALREADY_USED" },
  BLOB_NOT_FOUND: { status: 404, code: "BLOB_NOT_FOUND" },
  UPLOAD_EXPIRED: { status: 410, code: "UPLOAD_EXPIRED" },
  CURSOR_EXPIRED: { status: 410, code: "CURSOR_EXPIRED" },
  IDEMPOTENCY_CONFLICT: { status: 409, code: "IDEMPOTENCY_CONFLICT" },
};

export function domainErr(
  requestId: string,
  code: DomainErrorCode | LibraryErrorCode,
  message: string,
): Response {
  const m = domainStatus[code] ?? domainStatus.VALIDATION_ERROR;
  if (!m) return err(requestId, "VALIDATION_ERROR", message, 400);
  return err(requestId, m.code, message, m.status);
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  const m = /^Bearer (.+)$/.exec(h ?? "");
  return m?.[1] ?? null;
}

export async function readJson(
  req: Request,
  maxBytes = 256 * 1024,
): Promise<unknown> {
  try {
    const declared = req.headers.get("content-length");
    if (declared !== null && Number.parseInt(declared, 10) > maxBytes)
      return "__too_large__";
    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.length > maxBytes) return "__too_large__";
    if (buf.length === 0) return undefined;
    return JSON.parse(new TextDecoder().decode(buf));
  } catch {
    return undefined;
  }
}

export function isTooLarge(body: unknown): boolean {
  return body === "__too_large__";
}

export interface Authed {
  installation: Installation;
  user: User;
}

export async function auth(
  deps: AppDeps,
  req: Request,
): Promise<Authed | null> {
  const token = bearer(req);
  if (!token) return null;
  const claims = await verifyAccessToken(deps.accessSecret, token);
  if (!claims) return null;
  const installation = await deps.store.findInstallation(claims.installationId);
  if (!installation || installation.revokedAt !== null) return null;
  if (installation.userId !== claims.userId) return null;
  const user = await deps.store.findUser(claims.userId);
  if (!user) return null;
  await deps.store.updateInstallation({
    ...installation,
    lastSeenAt: deps.clock.nowIso(),
  });
  return { installation, user };
}

export async function requireMembership(
  deps: AppDeps,
  authed: Authed,
  spaceId: string,
  requestId: string,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const space = await deps.store.findPairSpace(spaceId);
  if (!space || space.status !== "active") {
    return {
      ok: false,
      response: err(requestId, "NOT_FOUND", "Espacio desconocido", 404),
    };
  }
  const membership = await deps.store.findMembership(spaceId, authed.user.id);
  if (!membership || membership.leftAt !== null) {
    return {
      ok: false,
      response: err(requestId, "FORBIDDEN", "Sin acceso", 403),
    };
  }
  return { ok: true };
}

/** 429 con Retry-After si excede, null si pasa. Clave con IP o instalación. */
export function checkRate(
  deps: AppDeps,
  requestId: string,
  key: string,
  rule: RateLimit,
): Response | null {
  const r = deps.limiter.check(key, rule);
  if (r.ok) return null;
  const res = err(
    requestId,
    "RATE_LIMITED",
    "Demasiadas peticiones",
    429,
    true,
  );
  res.headers.set("retry-after", String(r.retryAfterSeconds));
  return res;
}

export function rateKeyIp(req: Request, scope: string): string {
  return `${scope}:ip:${clientIp(req)}`;
}

export function rateKeyInstallation(
  installationId: string,
  scope: string,
): string {
  return `${scope}:ins:${installationId}`;
}
