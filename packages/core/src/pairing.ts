// @cookie/core — casos de uso de pairing (H2). Puros: IO solo vía puertos.
import {
  type Installation,
  type Invite,
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
  input: { userId: string },
): Promise<Result<CreatedPairSpace>> {
  const user = await store.findUser(input.userId);
  if (!user) return { ok: false, code: "NOT_FOUND" };
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
  const secret = crypto.newSecret();
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
  /** Token en claro: un solo uso, TTL corto, canal privado. */
  readonly inviteToken: string;
}

export async function createInvite(
  store: PairingStore,
  crypto: CryptoPort,
  clock: ClockPort,
  input: { spaceId: string; actorUserId: string; ttlSeconds: number },
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
  if (input.ttlSeconds < 60 || input.ttlSeconds > 24 * 3600) {
    return { ok: false, code: "VALIDATION_ERROR" };
  }
  const now = clock.nowIso();
  // SDD: máximo un invite activo recomendado. Expirar anteriores.
  await store.expireActiveInvites(input.spaceId, now);
  const token = crypto.newSecret();
  const invite: Invite = {
    id: crypto.newId(),
    pairSpaceId: input.spaceId,
    tokenHash: await crypto.lookupHash(token),
    createdBy: input.actorUserId,
    createdAt: now,
    expiresAt: isoPlusSeconds(now, input.ttlSeconds),
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
  return store.findInviteByTokenHash(await crypto.lookupHash(token));
}

export async function consumeInvite(
  store: PairingStore,
  crypto: CryptoPort,
  clock: ClockPort,
  input: { token: string; displayName: string; platform: Platform },
): Promise<Result<RegisteredInstallation & { pairSpaceId: string }>> {
  if (!validDisplayName(input.displayName)) {
    return { ok: false, code: "VALIDATION_ERROR" };
  }
  const invite = await findInviteByToken(store, crypto, input.token);
  if (!invite) return { ok: false, code: "NOT_FOUND" };
  if (invite.consumedAt !== null)
    return { ok: false, code: "INVITE_ALREADY_USED" };
  const now = clock.nowIso();
  if (invite.expiresAt <= now) return { ok: false, code: "INVITE_EXPIRED" };
  const space = await store.findPairSpace(invite.pairSpaceId);
  if (!space || space.status !== "active")
    return { ok: false, code: "NOT_FOUND" };
  const members = await store.activeMemberships(invite.pairSpaceId);
  if (members.length >= MAX_ACTIVE_MEMBERS) {
    return { ok: false, code: "PAIRSPACE_FULL" };
  }
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
  const membership: Membership = {
    pairSpaceId: space.id,
    userId: user.id,
    role: "member",
    joinedAt: now,
    leftAt: null,
  };
  await store.insertUser(user);
  await store.insertInstallation(installation);
  await store.insertMembership(membership);
  await store.updateInvite({ ...invite, consumedAt: now, consumedBy: user.id });
  return {
    ok: true,
    value: {
      user,
      installation,
      installationSecret: secret,
      pairSpaceId: space.id,
    },
  };
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

export async function completeRecovery(
  store: PairingStore,
  crypto: CryptoPort,
  clock: ClockPort,
  input: { challengeId: string; recoverySecret: string; platform: Platform },
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
  // que recuperar.
  const members = await store.activeMemberships(challenge.pairSpaceId);
  if (members.length === 0) return { ok: false, code: "NOT_FOUND" };
  const counts = await store.countActiveInstallations(challenge.pairSpaceId);
  const ranked = members
    .map((m) => ({ m, n: counts.get(m.userId) ?? 0 }))
    .sort((a, b) => a.n - b.n || (a.m.joinedAt < b.m.joinedAt ? -1 : 1));
  const target = ranked[0];
  if (!target || target.n > 0) {
    return { ok: false, code: "FORBIDDEN" };
  }
  const secret = crypto.newSecret();
  const installation: Installation = {
    id: challenge.installationId,
    userId: target.m.userId,
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
  const user = await store.findUser(target.m.userId);
  if (!user) return { ok: false, code: "NOT_FOUND" };
  return {
    ok: true,
    value: { user, installation, installationSecret: secret },
  };
}
