// server/api — router H2 (pairing). Handlers delgados: parse+validate+auth,
// caso de uso en core, mapeo de errores a HTTP. Sin framework.
import {
  approveLoginAttempt,
  completeRecovery,
  consumeInvite,
  createInvite,
  createLoginAttempt,
  createPairSpace,
  pollLoginAttempt,
  registerInstallation,
  revokeInstallation,
  startRecovery,
  updateProfile,
} from "@cookie/core";
import {
  approveLoginAttemptRequest,
  consumeInviteRequest,
  createInstallationRequest,
  createInviteRequest,
  createLoginAttemptRequest,
  pollLoginAttemptRequest,
  pushTokenRequest,
  recoveryChallengeRequest,
  recoveryCompleteRequest,
  updateMeRequest,
} from "@cookie/protocol";
import {
  type AppDeps,
  auth,
  bearer,
  checkRate,
  domainErr,
  err,
  rateKeyInstallation,
  rateKeyIp,
  readJson,
} from "./http";
import { handleLibraryRoutes } from "./library";
import {
  corsHeaders,
  logRequest,
  RATE_LIMITS,
  routeTemplate,
} from "./middleware";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  signAccessToken,
} from "./tokens";

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
  const dispatch = async (
    req: Request,
    requestId: string,
  ): Promise<Response> => {
    const url = new URL(req.url);
    if (
      !url.pathname.startsWith("/v1/") &&
      !url.pathname.startsWith("/internal/")
    )
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
      const parsed = createInstallationRequest.safeParse(await readJson(req));
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
      await deps.store.setPushToken(me.installation.id, null);
      return Response.json({ ok: true, requestId });
    }

    // POST /v1/installations/push-token — H6: token FCM de esta instalación.
    if (
      req.method === "POST" &&
      url.pathname === "/v1/installations/push-token"
    ) {
      if (!me) return UNAUTH();
      const parsed = pushTokenRequest.safeParse(await readJson(req));
      if (!parsed.success) {
        return err(requestId, "VALIDATION_ERROR", "Petición inválida", 400);
      }
      await deps.store.setPushToken(me.installation.id, parsed.data.token);
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
      const parsed = updateMeRequest.safeParse(await readJson(req));
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
      const limited = checkRate(
        deps,
        requestId,
        rateKeyInstallation(me.installation.id, "invite-create"),
        RATE_LIMITS.inviteCreate,
      );
      if (limited) return limited;
      const spaceId = inviteMatch[1];
      if (!spaceId) return err(requestId, "NOT_FOUND", "Ruta desconocida", 404);
      const parsed = createInviteRequest.safeParse((await readJson(req)) ?? {});
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
      const limited = checkRate(
        deps,
        requestId,
        rateKeyIp(req, "recovery-challenge"),
        RATE_LIMITS.recovery,
      );
      if (limited) return limited;
      const spaceId = challengeMatch[1];
      if (!spaceId) return err(requestId, "NOT_FOUND", "Ruta desconocida", 404);
      const parsed = recoveryChallengeRequest.safeParse(
        (await readJson(req)) ?? {},
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
      const body = (await readJson(req)) as { confirm?: unknown };
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
      await deps.store.setPushToken(res.value.id, null);
      // Cerrar sockets vivos de la instalación en cada espacio del usuario.
      for (const m of await deps.store.userSpaces(me.user.id)) {
        await deps
          .notify({
            spaceId: m.pairSpaceId,
            type: "installation.revoked",
            installationId: res.value.id,
            actorUserId: me.user.id,
          })
          .catch(() => undefined);
      }
      return Response.json({ ok: true, requestId });
    }

    // POST /v1/invites/consume — autenticado: vincula al usuario existente.
    // Sin segundo nombre (el onboarding ya registró la identidad) y sin
    // sesión nueva (el cliente conserva la suya).
    if (req.method === "POST" && url.pathname === "/v1/invites/consume") {
      if (!me) return UNAUTH();
      const limited = checkRate(
        deps,
        requestId,
        rateKeyInstallation(me.installation.id, "invite-consume"),
        RATE_LIMITS.inviteConsume,
      );
      if (limited) return limited;
      const parsed = consumeInviteRequest.safeParse(await readJson(req));
      if (!parsed.success) {
        return err(requestId, "VALIDATION_ERROR", "Petición inválida", 400);
      }
      const res = await consumeInvite(deps.store, deps.crypto, deps.clock, {
        token: parsed.data.inviteToken,
        userId: me.user.id,
      });
      if (!res.ok) {
        if (res.code === "VALIDATION_ERROR") {
          return err(
            requestId,
            res.code,
            "Ya pertenece a un espacio activo",
            400,
          );
        }
        return domainErr(
          requestId,
          res.code,
          "No se pudo consumir la invitación",
        );
      }
      return Response.json(
        { pairSpaceId: res.value.pairSpaceId },
        { status: 201 },
      );
    }

    // POST /v1/login-attempts — abre una espera de entrada (sin sesión).
    // El PC la crea y muestra su QR. No autoriza nada por sí sola.
    if (req.method === "POST" && url.pathname === "/v1/login-attempts") {
      const limited = checkRate(
        deps,
        requestId,
        rateKeyIp(req, "login-attempt-create"),
        RATE_LIMITS.loginAttemptCreate,
      );
      if (limited) return limited;
      const parsed = createLoginAttemptRequest.safeParse(
        (await readJson(req)) ?? {},
      );
      if (!parsed.success) {
        return err(requestId, "VALIDATION_ERROR", "Petición inválida", 400);
      }
      const res = await createLoginAttempt(
        deps.store,
        deps.crypto,
        deps.clock,
        {
          platform: parsed.data.platform,
          ttlSeconds: parsed.data.ttlSeconds,
        },
      );
      if (!res.ok)
        return domainErr(
          requestId,
          res.code,
          "No se pudo abrir la espera de entrada",
        );
      return Response.json(
        {
          attemptId: res.value.attempt.id,
          loginCode: res.value.code,
          expiresAt: res.value.attempt.expiresAt,
        },
        { status: 201 },
      );
    }

    // POST /v1/login-attempts/approve — el celular con sesión aprueba (FR-10).
    // Escanear = aprobar: vincula el intento a mi usuario.
    if (
      req.method === "POST" &&
      url.pathname === "/v1/login-attempts/approve"
    ) {
      if (!me) return UNAUTH();
      const limited = checkRate(
        deps,
        requestId,
        rateKeyInstallation(me.installation.id, "login-attempt-approve"),
        RATE_LIMITS.loginAttemptApprove,
      );
      if (limited) return limited;
      const parsed = approveLoginAttemptRequest.safeParse(await readJson(req));
      if (!parsed.success) {
        return err(requestId, "VALIDATION_ERROR", "Petición inválida", 400);
      }
      const res = await approveLoginAttempt(
        deps.store,
        deps.crypto,
        deps.clock,
        {
          attemptId: parsed.data.attemptId,
          code: parsed.data.loginCode,
          approverUserId: me.user.id,
          approverInstallationId: me.installation.id,
        },
      );
      if (!res.ok)
        return domainErr(requestId, res.code, "No se pudo aprobar la entrada");
      return Response.json({ platform: res.value.platform });
    }

    // POST /v1/login-attempts/poll — el PC sondea hasta entrar (misma
    // identidad y misma sala, sin duplicar nada).
    if (
      req.method === "POST" &&
      url.pathname === "/v1/login-attempts/poll"
    ) {
      const limited = checkRate(
        deps,
        requestId,
        rateKeyIp(req, "login-attempt-poll"),
        RATE_LIMITS.loginAttemptPoll,
      );
      if (limited) return limited;
      const parsed = pollLoginAttemptRequest.safeParse(await readJson(req));
      if (!parsed.success) {
        return err(requestId, "VALIDATION_ERROR", "Petición inválida", 400);
      }
      const res = await pollLoginAttempt(deps.store, deps.crypto, deps.clock, {
        attemptId: parsed.data.attemptId,
        code: parsed.data.loginCode,
      });
      if (!res.ok)
        return domainErr(requestId, res.code, "Espera de entrada inválida");
      if (res.value.status === "pending") {
        return Response.json({ status: "pending" as const });
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
          status: "approved" as const,
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
      const limited = checkRate(
        deps,
        requestId,
        rateKeyIp(req, "recovery-complete"),
        RATE_LIMITS.recovery,
      );
      if (limited) return limited;
      const parsed = recoveryCompleteRequest.safeParse(await readJson(req));
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

    const libraryRes = await handleLibraryRoutes(deps, req, url, requestId);
    if (libraryRes) return libraryRes;

    return err(requestId, "NOT_FOUND", "Ruta desconocida", 404);
  };

  return async (req: Request): Promise<Response> => {
    const start = Date.now();
    const requestId = deps.crypto.newId();
    const cors = corsHeaders(req, deps.allowedOrigins);
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    // Cap global JSON 256 KiB (SDD §4.7). Binarios (PUT uploads) exentos.
    const contentType = req.headers.get("content-type") ?? "";
    if (
      contentType.includes("json") &&
      (req.method === "POST" || req.method === "PATCH" || req.method === "PUT")
    ) {
      const declared = Number.parseInt(
        req.headers.get("content-length") ?? "0",
        10,
      );
      if (Number.isInteger(declared) && declared > 256 * 1024) {
        const res = err(
          requestId,
          "QUOTA_EXCEEDED",
          "Cuerpo demasiado grande",
          413,
        );
        for (const [k, v] of cors) res.headers.set(k, v);
        return res;
      }
    }
    const url = new URL(req.url);
    const res = await dispatch(req, requestId);
    for (const [k, v] of cors) res.headers.set(k, v);
    const template = routeTemplate(req.method, url.pathname);
    deps.metrics.record(template, res.status);
    logRequest({
      requestId,
      method: req.method,
      route: template,
      status: res.status,
      ms: Date.now() - start,
    });
    return res;
  };
}
