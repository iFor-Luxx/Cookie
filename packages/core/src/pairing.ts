// @cookie/core — casos de uso de pairing (H2). Puros: IO solo vía puertos.
import {
  type Installation,
  type Invite,
  LOGIN_ATTEMPT_TTL_SECONDS,
  type LoginAttempt,
  MAX_ACTIVE_MEMBERS,
  type Membership,
  type PairSpace,
  type Platform,
  RECOVERY_CHALLENGE_TTL_SECONDS,
  type RecoveryChallenge,
  type RecoveryCredential,
  type User,
} from "./entities";
import type { ClockPort, CryptoPort, PairingStore, Result } from "./ports";
import { normalizeInviteToken } from "./invite-token";

function validDisplayName(name: string): boolean {
  return name.length >= 1 && name.length <= 32;
}

function isoPlusSeconds(nowIso: string, seconds: number): string {
  return new Date(new Date(nowIso).getTime() + seconds * 1000).toISOString();
}

export interface RegisteredInstallation {
  readonly user: User;
  readonly installation: Installation;
  /** Secreto en claro: devolver UNA vez al cliente, jamás persistirlo. */
  readonly installationSecret: string;
}

export async function registerInstallation(
  store: PairingStore,
  crypto: CryptoPort,
  clock: ClockPort,
  input: { platform: Platform; displayName: string },
): Promise<Result<RegisteredInstallation>> {
  if (!validDisplayName(input.displayName)) {
    return { ok: false, code: "VALIDATION_ERROR" };
  }
  const now = clock.nowIso();
  const user: User = {
    id: crypto.newId(),
    displayName: input.displayName,
    avatarKey: null,
    createdAt: now,
    updatedAt: now,
  };
  const secret = crypto.newSecret();
  const installation: Installation = {
    id: crypto.newId(),
    userId: user.id,
    platform: input.platform,
    credentialHash: await crypto.hashSecret(secret),
    createdAt: now,
    lastSeenAt: now,
    revokedAt: null,
  };
  await store.insertUser(user);
  await store.insertInstallation(installation);
  return {
    ok: true,
    value: { user, installation, installationSecret: secret },
  };
}

export interface CreatedPairSpace {
  readonly space: PairSpace;
  /** Secreto de recovery: mostrar UNA vez. Sin él no hay recuperación. */
  readonly recoverySecret: string;
}

export async function createPairSpace(
  store: PairingStore,
  crypto: CryptoPort,
  clock: ClockPort,
  input: { userId: string; recoverySecret?: string },
): Promise<Result<CreatedPairSpace>> {
  const user = await store.findUser(input.userId);
  if (!user) return { ok: false, code: "NOT_FOUND" };
  if (
    input.recoverySecret !== undefined &&
    (input.recoverySecret.length < 8 || input.recoverySecret.length > 128)
  ) {
    return { ok: false, code: "VALIDATION_ERROR" };
  }
  const now = clock.nowIso();
  const space: PairSpace = {
    id: crypto.newId(),
    status: "active",
    createdAt: now,
  };
  const membership: Membership = {
    pairSpaceId: space.id,
    userId: user.id,
    role: "owner",
    joinedAt: now,
    leftAt: null,
  };
  const secret = input.recoverySecret ?? crypto.newSecret();
  const recovery: RecoveryCredential = {
    id: crypto.newId(),
    pairSpaceId: space.id,
    secretHash: await crypto.hashSecret(secret),
    createdAt: now,
    usedAt: null,
    revokedAt: null,
  };
  await store.insertPairSpace(space);
  await store.insertMembership(membership);
  await store.insertRecoveryCredential(recovery);
  return { ok: true, value: { space, recoverySecret: secret } };
}

export interface CreatedInvite {
  readonly invite: Invite;
  /** Token en claro: reutilizable, no caduca (solo se invalida al generar otro). */
  readonly inviteToken: string;
}

/**
 * Invitaciones indefinidas: no caducan y no se queman al usarse. Cada código
 * generado vale para siempre (unirse o recuperar con contraseña). Generar
 * otro NO invalida los anteriores.
 */
export const INVITE_EXPIRES_AT_INDEFINITE = "9999-12-31T23:59:59.999Z";

export async function createInvite(
  store: PairingStore,
  crypto: CryptoPort,
  clock: ClockPort,
  input: { spaceId: string; actorUserId: string; ttlSeconds?: number },
): Promise<Result<CreatedInvite>> {
  const space = await store.findPairSpace(input.spaceId);
  if (!space || space.status !== "active")
    return { ok: false, code: "NOT_FOUND" };
  const membership = await store.findMembership(
    input.spaceId,
    input.actorUserId,
  );
  if (!membership || membership.leftAt !== null) {
    return { ok: false, code: "FORBIDDEN" };
  }
  const now = clock.nowIso();
  // ttlSeconds se ignora por compat: las invitaciones no caducan.
  const token = crypto.newInviteToken();
  const invite: Invite = {
    id: crypto.newId(),
    pairSpaceId: input.spaceId,
    tokenHash: await crypto.lookupHash(token),
    createdBy: input.actorUserId,
    createdAt: now,
    expiresAt: INVITE_EXPIRES_AT_INDEFINITE,
    consumedAt: null,
    consumedBy: null,
  };
  await store.insertInvite(invite);
  return { ok: true, value: { invite, inviteToken: token } };
}

async function findInviteByToken(
  store: PairingStore,
  crypto: CryptoPort,
  token: string,
): Promise<Invite | null> {
  // Lookup determinista por SHA-256 (ver CryptoPort.lookupHash).
  // Acepta minúsculas (el token corto es insensible a mayúsculas) y
  // mantiene compatibilidad con tokens largos anteriores (sensibles).
  const trimmed = token.trim();
  const found =
    await store.findInviteByTokenHash(await crypto.lookupHash(trimmed));
  if (found) return found;
  const upper = normalizeInviteToken(trimmed);
  if (upper === trimmed) return null;
  return store.findInviteByTokenHash(await crypto.lookupHash(upper));
}

export async function consumeInvite(
  store: PairingStore,
  crypto: CryptoPort,
  clock: ClockPort,
  input: { token: string; userId: string },
): Promise<Result<{ pairSpaceId: string }>> {
  const invite = await findInviteByToken(store, crypto, input.token);
  if (!invite) return { ok: false, code: "NOT_FOUND" };
  // Indefinidas: se ignoran consumedAt/expiresAt (valen códigos viejos de
  // un solo uso o con TTL corto generados antes de este cambio).
  const now = clock.nowIso();
  const space = await store.findPairSpace(invite.pairSpaceId);
  if (!space || space.status !== "active")
    return { ok: false, code: "NOT_FOUND" };
  const user = await store.findUser(input.userId);
  if (!user) return { ok: false, code: "NOT_FOUND" };
  // Idempotente: si ya es miembro, devolver sin quemar el token.
  const existing = await store.findMembership(space.id, user.id);
  if (existing && existing.leftAt === null) {
    return { ok: true, value: { pairSpaceId: space.id } };
  }
  // Modelo de un espacio por usuario (igual que createPairSpace).
  const spaces = await store.userSpaces(user.id);
  if (spaces.length > 0) return { ok: false, code: "VALIDATION_ERROR" };
  const members = await store.activeMemberships(invite.pairSpaceId);
  if (members.length >= MAX_ACTIVE_MEMBERS) {
    return { ok: false, code: "PAIRSPACE_FULL" };
  }
  const membership: Membership = {
    pairSpaceId: space.id,
    userId: user.id,
    role: "member",
    joinedAt: now,
    leftAt: null,
  };
  await store.insertMembership(membership);
  // El código NO se quema: reutilizable hasta que se genere otro.
  return { ok: true, value: { pairSpaceId: space.id } };
}

export async function updateProfile(
  store: PairingStore,
  clock: ClockPort,
  input: { userId: string; displayName?: string },
): Promise<Result<User>> {
  const user = await store.findUser(input.userId);
  if (!user) return { ok: false, code: "NOT_FOUND" };
  if (input.displayName !== undefined && !validDisplayName(input.displayName)) {
    return { ok: false, code: "VALIDATION_ERROR" };
  }
  const updated: User = {
    ...user,
    displayName: input.displayName ?? user.displayName,
    updatedAt: clock.nowIso(),
  };
  await store.updateUser(updated);
  return { ok: true, value: updated };
}

export async function revokeInstallation(
  store: PairingStore,
  clock: ClockPort,
  input: { actorUserId: string; installationId: string; confirm: boolean },
): Promise<Result<Installation>> {
  if (!input.confirm) return { ok: false, code: "VALIDATION_ERROR" };
  const installation = await store.findInstallation(input.installationId);
  if (!installation) return { ok: false, code: "NOT_FOUND" };
  if (installation.userId !== input.actorUserId) {
    return { ok: false, code: "FORBIDDEN" };
  }
  if (installation.revokedAt !== null) return { ok: true, value: installation };
  const revoked: Installation = { ...installation, revokedAt: clock.nowIso() };
  await store.updateInstallation(revoked);
  return { ok: true, value: revoked };
}

export async function startRecovery(
  store: PairingStore,
  crypto: CryptoPort,
  clock: ClockPort,
  input: { spaceId: string; installationId: string },
): Promise<Result<RecoveryChallenge>> {
  const space = await store.findPairSpace(input.spaceId);
  if (!space || space.status !== "active")
    return { ok: false, code: "NOT_FOUND" };
  const now = clock.nowIso();
  const challenge: RecoveryChallenge = {
    id: crypto.newId(),
    pairSpaceId: space.id,
    installationId: input.installationId,
    createdAt: now,
    expiresAt: isoPlusSeconds(now, RECOVERY_CHALLENGE_TTL_SECONDS),
    consumedAt: null,
  };
  await store.insertRecoveryChallenge(challenge);
  return { ok: true, value: challenge };
}

/**
 * Challenge por código de invitación (sin saber el ID del espacio).
 * El código debe ser el actual de una sala activa; si no,
 * NOT_FOUND indistinguible (el llamante responde challenge ficticio).
 */
export interface RoomMember {
  readonly userId: string;
  readonly displayName: string;
}

/**
 * Challenge por código de invitación (sin saber el ID del espacio).
 * Devuelve también los miembros activos para elegir quién vuelve.
 */
export async function startRecoveryByInvite(
  store: PairingStore,
  crypto: CryptoPort,
  clock: ClockPort,
  input: { installationId: string; inviteToken: string },
): Promise<Result<{ challenge: RecoveryChallenge; members: RoomMember[] }>> {
  const invite = await findInviteByToken(store, crypto, input.inviteToken);
  const now = clock.nowIso();
  if (!invite) {
    return { ok: false, code: "NOT_FOUND" };
  }
  const space = await store.findPairSpace(invite.pairSpaceId);
  if (!space || space.status !== "active") {
    return { ok: false, code: "NOT_FOUND" };
  }
  const challenge: RecoveryChallenge = {
    id: crypto.newId(),
    pairSpaceId: space.id,
    installationId: input.installationId,
    createdAt: now,
    expiresAt: isoPlusSeconds(now, RECOVERY_CHALLENGE_TTL_SECONDS),
    consumedAt: null,
  };
  await store.insertRecoveryChallenge(challenge);
  const members: RoomMember[] = [];
  for (const m of await store.activeMemberships(space.id)) {
    const user = await store.findUser(m.userId);
    if (user) members.push({ userId: user.id, displayName: user.displayName });
  }
  return { ok: true, value: { challenge, members } };
}

export async function completeRecovery(
  store: PairingStore,
  crypto: CryptoPort,
  clock: ClockPort,
  input: {
    challengeId: string;
    recoverySecret: string;
    platform: Platform;
    inviteToken?: string;
    asUserId?: string;
  },
): Promise<Result<RegisteredInstallation>> {
  const challenge = await store.findRecoveryChallenge(input.challengeId);
  const now = clock.nowIso();
  if (
    !challenge ||
    challenge.consumedAt !== null ||
    challenge.expiresAt <= now
  ) {
    return { ok: false, code: "NOT_FOUND" };
  }
  const credential = await store.activeRecoveryCredential(
    challenge.pairSpaceId,
  );
  if (
    !credential ||
    !(await crypto.verifySecret(input.recoverySecret, credential.secretHash))
  ) {
    return { ok: false, code: "NOT_FOUND" };
  }
  // La instalación nueva se ata al miembro con menos instalaciones activas
  // (el que perdió su dispositivo). Si todos tienen activas, no hay nada
  // que recuperar... salvo que traiga código de invitación: un miembro con
  // sesión lo generó para autorizar esta entrada y se entra igual
  // (vale en sala llena). El código NO se quema: vale hasta generar otro.
  const members = await store.activeMemberships(challenge.pairSpaceId);
  if (members.length === 0) return { ok: false, code: "NOT_FOUND" };
  const counts = await store.countActiveInstallations(challenge.pairSpaceId);
  const ranked = members
    .map((m) => ({ m, n: counts.get(m.userId) ?? 0 }))
    .sort((a, b) => a.n - b.n || (a.m.joinedAt < b.m.joinedAt ? -1 : 1));
  const target = ranked[0];
  if (!target) return { ok: false, code: "NOT_FOUND" };
  let userId = target.m.userId;
  if (input.inviteToken !== undefined) {
    const invite = await findInviteByToken(store, crypto, input.inviteToken);
    if (!invite || invite.pairSpaceId !== challenge.pairSpaceId) {
      return { ok: false, code: "NOT_FOUND" };
    }
    if (input.asUserId !== undefined) {
      // Picker estilo Netflix: quien vuelve elige su identidad. Debe ser
      // miembro activo de ESTA sala; si no, indistinguible.
      const chosen = members.find(
        (m) => m.userId === input.asUserId && m.leftAt === null,
      );
      if (!chosen) return { ok: false, code: "NOT_FOUND" };
      userId = chosen.userId;
    } else {
      // Sin elección: el código lo generó el miembro que ayuda; quien
      // vuelve es el OTRO. (En empate el ranking iría al creador.)
      const other = ranked.find((r) => r.m.userId !== invite.createdBy);
      userId = (other ?? target).m.userId;
    }
  } else if (target.n > 0) {
    return { ok: false, code: "FORBIDDEN" };
  }
  const secret = crypto.newSecret();
  const installation: Installation = {
    id: challenge.installationId,
    userId,
    platform: input.platform,
    credentialHash: await crypto.hashSecret(secret),
    createdAt: now,
    lastSeenAt: now,
    revokedAt: null,
  };
  const existing = await store.findInstallation(installation.id);
  if (existing) return { ok: false, code: "VALIDATION_ERROR" };
  await store.insertInstallation(installation);
  await store.updateRecoveryChallenge({ ...challenge, consumedAt: now });
  const user = await store.findUser(userId);
  if (!user) return { ok: false, code: "NOT_FOUND" };
  return {
    ok: true,
    value: { user, installation, installationSecret: secret },
  };
}

export interface CreatedLoginAttempt {
  readonly attempt: LoginAttempt;
  /** Código en claro del QR: solo referencia el intento, no es credencial. */
  readonly code: string;
}

/**
 * Crea una solicitud de entrada (H9, estilo WhatsApp Web). La crea el
 * dispositivo SIN sesión: solo abre la espera. No autoriza nada por sí sola.
 */
export async function createLoginAttempt(
  store: PairingStore,
  crypto: CryptoPort,
  clock: ClockPort,
  input: { platform: Platform; ttlSeconds: number },
): Promise<Result<CreatedLoginAttempt>> {
  if (
    input.ttlSeconds < 60 ||
    input.ttlSeconds > LOGIN_ATTEMPT_TTL_SECONDS * 2
  ) {
    return { ok: false, code: "VALIDATION_ERROR" };
  }
  const now = clock.nowIso();
  const code = crypto.newSecret();
  const attempt: LoginAttempt = {
    id: crypto.newId(),
    codeHash: await crypto.lookupHash(code),
    platform: input.platform,
    createdAt: now,
    expiresAt: isoPlusSeconds(now, input.ttlSeconds),
    approvedAt: null,
    approvedUserId: null,
    approvedByInstallationId: null,
    consumedAt: null,
  };
  await store.insertLoginAttempt(attempt);
  return { ok: true, value: { attempt, code } };
}

async function findAttemptByCode(
  store: PairingStore,
  crypto: CryptoPort,
  attemptId: string,
  code: string,
): Promise<LoginAttempt | null> {
  const attempt = await store.findLoginAttempt(attemptId);
  if (!attempt) return null;
  if ((await crypto.lookupHash(code)) !== attempt.codeHash) return null;
  return attempt;
}

/**
 * Aprueba una solicitud con sesión activa (= aprobación de un miembro,
 * FR-10): vincula el intento pendiente a MI usuario. Escanear = aprobar.
 */
export async function approveLoginAttempt(
  store: PairingStore,
  crypto: CryptoPort,
  clock: ClockPort,
  input: {
    attemptId: string;
    code: string;
    approverUserId: string;
    approverInstallationId: string;
  },
): Promise<Result<{ platform: Platform }>> {
  const attempt = await findAttemptByCode(
    store,
    crypto,
    input.attemptId,
    input.code,
  );
  if (!attempt) return { ok: false, code: "NOT_FOUND" };
  const now = clock.nowIso();
  if (attempt.expiresAt <= now) return { ok: false, code: "LOGIN_EXPIRED" };
  if (attempt.approvedAt !== null || attempt.consumedAt !== null) {
    return { ok: false, code: "LOGIN_ALREADY_USED" };
  }
  const installation = await store.findInstallation(
    input.approverInstallationId,
  );
  if (
    !installation ||
    installation.userId !== input.approverUserId ||
    installation.revokedAt !== null
  ) {
    return { ok: false, code: "FORBIDDEN" };
  }
  const user = await store.findUser(input.approverUserId);
  if (!user) return { ok: false, code: "NOT_FOUND" };
  await store.updateLoginAttempt({
    ...attempt,
    approvedAt: now,
    approvedUserId: user.id,
    approvedByInstallationId: installation.id,
  });
  return { ok: true, value: { platform: attempt.platform } };
}

export type LoginPollResult =
  | { readonly status: "pending" }
  | (RegisteredInstallation & {
      readonly status: "approved";
      readonly pairSpaceId: string | null;
    });

/**
 * Sondea la solicitud (la llama el dispositivo que mostró el QR). Al
 * aprobarse, crea la instalación del solicitante bajo el usuario que aprobó:
 * misma identidad y misma sala, sin duplicar nada.
 */
export async function pollLoginAttempt(
  store: PairingStore,
  crypto: CryptoPort,
  clock: ClockPort,
  input: { attemptId: string; code: string },
): Promise<Result<LoginPollResult>> {
  const attempt = await findAttemptByCode(
    store,
    crypto,
    input.attemptId,
    input.code,
  );
  if (!attempt) return { ok: false, code: "NOT_FOUND" };
  const now = clock.nowIso();
  if (attempt.expiresAt <= now) return { ok: false, code: "LOGIN_EXPIRED" };
  if (attempt.approvedAt === null || attempt.approvedUserId === null) {
    return { ok: true, value: { status: "pending" } };
  }
  if (attempt.consumedAt !== null)
    return { ok: false, code: "LOGIN_ALREADY_USED" };
  const user = await store.findUser(attempt.approvedUserId);
  if (!user) return { ok: false, code: "NOT_FOUND" };
  const secret = crypto.newSecret();
  const installation: Installation = {
    id: crypto.newId(),
    userId: user.id,
    platform: attempt.platform,
    credentialHash: await crypto.hashSecret(secret),
    createdAt: now,
    lastSeenAt: now,
    revokedAt: null,
  };
  await store.insertInstallation(installation);
  await store.updateLoginAttempt({ ...attempt, consumedAt: now });
  const spaces = await store.userSpaces(user.id);
  return {
    ok: true,
    value: {
      status: "approved",
      user,
      installation,
      installationSecret: secret,
      pairSpaceId: spaces[0]?.pairSpaceId ?? null,
    },
  };
}
