// server/api — router H2 (pairing). Handlers delgados: parse+validate+auth,
// caso de uso en core, mapeo de errores a HTTP. Sin framework.
import {
  type ClockPort,
  type CryptoPort,
  completeRecovery,
  consumeInvite,
  createInvite,
  createPairSpace,
  type DomainErrorCode,
  type Installation,
  type PairingStore,
  registerInstallation,
  revokeInstallation,
  startRecovery,
  type User,
  updateProfile,
} from "@cookie/core";
import {
  consumeInviteRequest,
  createInstallationRequest,
  createInviteRequest,
  type errorCodeSchema,
  recoveryChallengeRequest,
  recoveryCompleteRequest,
  updateMeRequest,
} from "@cookie/protocol";
import type { SessionStore } from "@cookie/server-db";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  signAccessToken,
  verifyAccessToken,
} from "./tokens";

export interface AppDeps {
  store: PairingStore & SessionStore;
  crypto: CryptoPort;
  clock: ClockPort;
  accessSecret: Uint8Array;
}

type ErrorCode = ReturnType<typeof errorCodeSchema.parse>;

function err(
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

const domainStatus: Record<
  DomainErrorCode,
  { status: number; code: ErrorCode }
> = {
  VALIDATION_ERROR: { status: 400, code: "VALIDATION_ERROR" },
  UNAUTHENTICATED: { status: 401, code: "UNAUTHENTICATED" },
  FORBIDDEN: { status: 403, code: "FORBIDDEN" },
  NOT_FOUND: { status: 404, code: "NOT_FOUND" },
  PAIRSPACE_FULL: { status: 409, code: "PAIRSPACE_FULL" },
  INVITE_EXPIRED: { status: 410, code: "INVITE_EXPIRED" },
  INVITE_ALREADY_USED: { status: 409, code: "INVITE_ALREADY_USED" },
};

function domainErr(
  requestId: string,
  code: DomainErrorCode,
  message: string,
): Response {
  const m = domainStatus[code];
  return err(requestId, m.code, message, m.status);
}

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  const m = /^Bearer (.+)$/.exec(h ?? "");
  return m?.[1] ?? null;
}

async function json(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

interface Authed {
  installation: Installation;
  user: User;
}

async function auth(deps: AppDeps, req: Request): Promise<Authed | null> {
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

async function issueSession(
  deps: AppDeps,
  installationId: string,
  userId: string,
  nowIso: string,
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}> {
  const refreshToken = deps.crypto.newSecret();
  const ms = new Date(nowIso).getTime();
  await deps.store.insertSession({
    id: deps.crypto.newId(),
    installation_id: installationId,
    refresh_hash: await deps.crypto.lookupHash(refreshToken),
    created_at: nowIso,
    expires_at: new Date(ms + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(),
    consumed_at: null,
    revoked_at: null,
  });
  return {
    accessToken: await signAccessToken(deps.accessSecret, {
      installationId,
      userId,
    }),
    refreshToken,
    expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
  };
}

export function createApp(deps: AppDeps): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const requestId = deps.crypto.newId();
    if (!url.pathname.startsWith("/v1/"))
      return err(requestId, "NOT_FOUND", "Ruta desconocida", 404);
    const proto = req.headers.get("x-protocol-version");
    if (proto !== null && proto !== "1") {
      return err(
        requestId,
        "VALIDATION_ERROR",
        "Versión de protocolo no soportada",
        400,
      );
    }

    // GET /v1/health — público reducido.
    if (req.method === "GET" && url.pathname === "/v1/health") {
      return Response.json({ ok: true, protocol: 1, requestId });
    }

    // POST /v1/installations — registro inicial (throttle por IP: pendiente H7).
    if (req.method === "POST" && url.pathname === "/v1/installations") {
      const parsed = createInstallationRequest.safeParse(await json(req));
      if (!parsed.success) {
        return err(requestId, "VALIDATION_ERROR", "Petición inválida", 400);
      }
      const res = await registerInstallation(
        deps.store,
        deps.crypto,
        deps.clock,
        {
          platform: parsed.data.platform,
          displayName: parsed.data.displayName,
        },
      );
      if (!res.ok)
        return domainErr(requestId, res.code, "No se pudo registrar");
      const now = deps.clock.nowIso();
      const session = await issueSession(
        deps,
        res.value.installation.id,
        res.value.user.id,
        now,
      );
      return Response.json(
        {
          installationId: res.value.installation.id,
          userId: res.value.user.id,
          installationSecret: res.value.installationSecret,
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          expiresInSeconds: session.expiresInSeconds,
        },
        { status: 201 },
      );
    }

    // POST /v1/sessions/refresh — rotación con detección de reuse.
    if (req.method === "POST" && url.pathname === "/v1/sessions/refresh") {
      const presented = bearer(req);
      if (!presented) {
        return err(requestId, "UNAUTHENTICATED", "Falta refresh token", 401);
      }
      const session = await deps.store.findSessionByRefreshHash(
        await deps.crypto.lookupHash(presented),
      );
      const now = deps.clock.nowIso();
      if (
        !session ||
        session.revoked_at !== null ||
        session.expires_at <= now
      ) {
        return err(requestId, "UNAUTHENTICATED", "Sesión inválida", 401);
      }
      const installation = await deps.store.findInstallation(
        session.installation_id,
      );
      if (!installation || installation.revokedAt !== null) {
        return err(requestId, "UNAUTHENTICATED", "Sesión inválida", 401);
      }
      if (session.consumed_at !== null) {
        // Reuse: posible robo. Revocar familia completa.
        await deps.store.revokeInstallationSessions(installation.id, now);
        return err(requestId, "UNAUTHENTICATED", "Sesión inválida", 401);
      }
      await deps.store.updateSession({ ...session, consumed_at: now });
      const next = await issueSession(
        deps,
        installation.id,
        installation.userId,
        now,
      );
      return Response.json({
        accessToken: next.accessToken,
        refreshToken: next.refreshToken,
        expiresInSeconds: next.expiresInSeconds,
      });
    }

    // Rutas autenticadas con access token.
    const me = await auth(deps, req);
    const UNAUTH = (): Response =>
      err(requestId, "UNAUTHENTICATED", "Autenticación requerida", 401);

    // DELETE /v1/sessions/current
    if (req.method === "DELETE" && url.pathname === "/v1/sessions/current") {
      if (!me) return UNAUTH();
      await deps.store.revokeInstallationSessions(
        me.installation.id,
        deps.clock.nowIso(),
      );
      return Response.json({ ok: true, requestId });
    }

    // GET /v1/me
    if (req.method === "GET" && url.pathname === "/v1/me") {
      if (!me) return UNAUTH();
      const spaces = await deps.store.userSpaces(me.user.id);
      return Response.json({
        userId: me.user.id,
        displayName: me.user.displayName,
        avatarVersion: null,
        pairSpaceId: spaces[0]?.pairSpaceId ?? null,
      });
    }

    // PATCH /v1/me
    if (req.method === "PATCH" && url.pathname === "/v1/me") {
      if (!me) return UNAUTH();
      const parsed = updateMeRequest.safeParse(await json(req));
      if (!parsed.success) {
        return err(requestId, "VALIDATION_ERROR", "Petición inválida", 400);
      }
      const res = await updateProfile(
        deps.store,
        deps.clock,
        parsed.data.displayName === undefined
          ? { userId: me.user.id }
          : { userId: me.user.id, displayName: parsed.data.displayName },
      );
      if (!res.ok)
        return domainErr(requestId, res.code, "No se pudo actualizar");
      const spaces = await deps.store.userSpaces(me.user.id);
      return Response.json({
        userId: res.value.id,
        displayName: res.value.displayName,
        avatarVersion: null,
        pairSpaceId: spaces[0]?.pairSpaceId ?? null,
      });
    }

    // POST /v1/pair-spaces
    if (req.method === "POST" && url.pathname === "/v1/pair-spaces") {
      if (!me) return UNAUTH();
      const existing = await deps.store.userSpaces(me.user.id);
      if (existing.length > 0) {
        return err(
          requestId,
          "VALIDATION_ERROR",
          "Ya pertenece a un espacio activo",
          409,
        );
      }
      const res = await createPairSpace(deps.store, deps.crypto, deps.clock, {
        userId: me.user.id,
      });
      if (!res.ok)
        return domainErr(requestId, res.code, "No se pudo crear el espacio");
      return Response.json(
        {
          pairSpaceId: res.value.space.id,
          recoverySecret: res.value.recoverySecret,
        },
        { status: 201 },
      );
    }

    // POST /v1/pair-spaces/{id}/invites
    const inviteMatch = /^\/v1\/pair-spaces\/([^/]+)\/invites$/.exec(
      url.pathname,
    );
    if (req.method === "POST" && inviteMatch) {
      if (!me) return UNAUTH();
      const spaceId = inviteMatch[1];
      if (!spaceId) return err(requestId, "NOT_FOUND", "Ruta desconocida", 404);
      const parsed = createInviteRequest.safeParse((await json(req)) ?? {});
      if (!parsed.success) {
        return err(requestId, "VALIDATION_ERROR", "Petición inválida", 400);
      }
      const res = await createInvite(deps.store, deps.crypto, deps.clock, {
        spaceId,
        actorUserId: me.user.id,
        ttlSeconds: parsed.data.ttlSeconds,
      });
      if (!res.ok)
        return domainErr(requestId, res.code, "No se pudo crear la invitación");
      return Response.json(
        {
          inviteId: res.value.invite.id,
          inviteToken: res.value.inviteToken,
          expiresAt: res.value.invite.expiresAt,
        },
        { status: 201 },
      );
    }

    // POST /v1/pair-spaces/{id}/recovery-challenges — respuesta indistinguible.
    const challengeMatch =
      /^\/v1\/pair-spaces\/([^/]+)\/recovery-challenges$/.exec(url.pathname);
    if (req.method === "POST" && challengeMatch) {
      const spaceId = challengeMatch[1];
      if (!spaceId) return err(requestId, "NOT_FOUND", "Ruta desconocida", 404);
      const parsed = recoveryChallengeRequest.safeParse(
        (await json(req)) ?? {},
      );
      if (!parsed.success) {
        return err(requestId, "VALIDATION_ERROR", "Petición inválida", 400);
      }
      const res = await startRecovery(deps.store, deps.crypto, deps.clock, {
        spaceId,
        installationId: parsed.data.installationId,
      });
      if (!res.ok) {
        // Indistinguible: challenge ficticio con forma válida (complete fallará).
        const now = deps.clock.nowIso();
        return Response.json(
          {
            challengeId: deps.crypto.newId(),
            expiresAt: new Date(
              new Date(now).getTime() + 600_000,
            ).toISOString(),
          },
          { status: 201 },
        );
      }
      return Response.json(
        { challengeId: res.value.id, expiresAt: res.value.expiresAt },
        { status: 201 },
      );
    }

    // POST /v1/installations/{id}/revoke — confirmación explícita requerida.
    const revokeMatch = /^\/v1\/installations\/([^/]+)\/revoke$/.exec(
      url.pathname,
    );
    if (req.method === "POST" && revokeMatch) {
      if (!me) return UNAUTH();
      const installationId = revokeMatch[1];
      if (!installationId)
        return err(requestId, "NOT_FOUND", "Ruta desconocida", 404);
      const body = (await json(req)) as { confirm?: unknown };
      const res = await revokeInstallation(deps.store, deps.clock, {
        actorUserId: me.user.id,
        installationId,
        confirm: body?.confirm === true,
      });
      if (!res.ok) return domainErr(requestId, res.code, "No se pudo revocar");
      await deps.store.revokeInstallationSessions(
        res.value.id,
        deps.clock.nowIso(),
      );
      return Response.json({ ok: true, requestId });
    }

    // POST /v1/invites/consume — sin auth (el segundo miembro aún no tiene credenciales).
    if (req.method === "POST" && url.pathname === "/v1/invites/consume") {
      const parsed = consumeInviteRequest.safeParse(await json(req));
      if (!parsed.success) {
        return err(requestId, "VALIDATION_ERROR", "Petición inválida", 400);
      }
      const res = await consumeInvite(deps.store, deps.crypto, deps.clock, {
        token: parsed.data.inviteToken,
        displayName: parsed.data.displayName,
        platform: parsed.data.platform,
      });
      if (!res.ok)
        return domainErr(
          requestId,
          res.code,
          "No se pudo consumir la invitación",
        );
      const now = deps.clock.nowIso();
      const session = await issueSession(
        deps,
        res.value.installation.id,
        res.value.user.id,
        now,
      );
      return Response.json(
        {
          pairSpaceId: res.value.pairSpaceId,
          userId: res.value.user.id,
          installationId: res.value.installation.id,
          installationSecret: res.value.installationSecret,
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          expiresInSeconds: session.expiresInSeconds,
        },
        { status: 201 },
      );
    }

    // POST /v1/recovery/complete
    if (req.method === "POST" && url.pathname === "/v1/recovery/complete") {
      const parsed = recoveryCompleteRequest.safeParse(await json(req));
      if (!parsed.success) {
        return err(requestId, "VALIDATION_ERROR", "Petición inválida", 400);
      }
      const res = await completeRecovery(deps.store, deps.crypto, deps.clock, {
        challengeId: parsed.data.challengeId,
        recoverySecret: parsed.data.recoverySecret,
        platform: parsed.data.platform,
      });
      if (!res.ok) {
        return err(
          requestId,
          "VALIDATION_ERROR",
          "No se pudo completar la recuperación",
          400,
        );
      }
      const now = deps.clock.nowIso();
      const session = await issueSession(
        deps,
        res.value.installation.id,
        res.value.user.id,
        now,
      );
      return Response.json(
        {
          userId: res.value.user.id,
          installationId: res.value.installation.id,
          installationSecret: res.value.installationSecret,
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          expiresInSeconds: session.expiresInSeconds,
        },
        { status: 201 },
      );
    }

    return err(requestId, "NOT_FOUND", "Ruta desconocida", 404);
  };
}
