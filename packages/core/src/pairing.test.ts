import { describe, expect, it } from "vitest";
import type {
  Installation,
  Invite,
  LoginAttempt,
  Membership,
  PairSpace,
  RecoveryChallenge,
  RecoveryCredential,
  User,
} from "./entities";
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
} from "./pairing";
import type { ClockPort, CryptoPort, PairingStore } from "./ports";

function stubClock(): ClockPort & { tick(ms: number): void } {
  let t = new Date("2026-10-09T12:00:00.000Z").getTime();
  return {
    nowIso: () => new Date(t).toISOString(),
    tick: (ms: number) => {
      t += ms;
    },
  };
}

function stubCrypto(): CryptoPort {
  let n = 0;
  const ids = () => `id-${++n}`;
  return {
    newId: ids,
    newSecret: () => `secret-${++n}`,
    // Hash reversible SOLO para tests: "h:<secret>".
    hashSecret: async (s: string) => `h:${s}`,
    verifySecret: async (s: string, h: string) => h === `h:${s}`,
    lookupHash: async (s: string) => `l:${s}`,
    sha256Hex: async (s: string) => `s:${s}`,
  };
}

function memoryStore(): PairingStore {
  const users = new Map<string, User>();
  const installations = new Map<string, Installation>();
  const spaces = new Map<string, PairSpace>();
  const memberships = new Map<string, Membership>();
  const invitesById = new Map<string, Invite>();
  const invitesByHash = new Map<string, Invite>();
  const recoveries = new Map<string, RecoveryCredential[]>();
  const challenges = new Map<string, RecoveryChallenge>();
  const attempts = new Map<string, LoginAttempt>();
  const key = (s: string, u: string) => `${s}:${u}`;
  return {
    insertUser: async (u) => void users.set(u.id, u),
    findUser: async (id) => users.get(id) ?? null,
    updateUser: async (u) => void users.set(u.id, u),
    insertInstallation: async (i) => void installations.set(i.id, i),
    findInstallation: async (id) => installations.get(id) ?? null,
    updateInstallation: async (i) => void installations.set(i.id, i),
    insertPairSpace: async (s) => void spaces.set(s.id, s),
    findPairSpace: async (id) => spaces.get(id) ?? null,
    insertMembership: async (m) =>
      void memberships.set(key(m.pairSpaceId, m.userId), m),
    activeMemberships: async (spaceId) =>
      [...memberships.values()].filter(
        (m) => m.pairSpaceId === spaceId && m.leftAt === null,
      ),
    findMembership: async (spaceId, userId) =>
      memberships.get(key(spaceId, userId)) ?? null,
    userSpaces: async (userId) =>
      [...memberships.values()].filter(
        (m) => m.userId === userId && m.leftAt === null,
      ),
    insertInvite: async (i) => {
      invitesById.set(i.id, i);
      invitesByHash.set(i.tokenHash, i);
    },
    findInviteByTokenHash: async (h) => invitesByHash.get(h) ?? null,
    updateInvite: async (i) => {
      invitesById.set(i.id, i);
      invitesByHash.set(i.tokenHash, i);
    },
    expireActiveInvites: async (spaceId, nowIso) => {
      for (const i of invitesById.values()) {
        if (
          i.pairSpaceId === spaceId &&
          i.consumedAt === null &&
          i.expiresAt > nowIso
        ) {
          const expired = { ...i, expiresAt: nowIso };
          invitesById.set(i.id, expired);
          invitesByHash.set(i.tokenHash, expired);
        }
      }
    },
    insertRecoveryCredential: async (r) => {
      const list = recoveries.get(r.pairSpaceId) ?? [];
      list.push(r);
      recoveries.set(r.pairSpaceId, list);
    },
    activeRecoveryCredential: async (spaceId) =>
      (recoveries.get(spaceId) ?? []).find((r) => r.revokedAt === null) ?? null,
    insertRecoveryChallenge: async (c) => void challenges.set(c.id, c),
    findRecoveryChallenge: async (id) => challenges.get(id) ?? null,
    updateRecoveryChallenge: async (c) => void challenges.set(c.id, c),
    insertLoginAttempt: async (a) => void attempts.set(a.id, a),
    findLoginAttempt: async (id) => attempts.get(id) ?? null,
    updateLoginAttempt: async (a) => void attempts.set(a.id, a),
    countActiveInstallations: async (spaceId) => {
      const counts = new Map<string, number>();
      for (const m of memberships.values()) {
        if (m.pairSpaceId !== spaceId || m.leftAt !== null) continue;
        const n = [...installations.values()].filter(
          (i) => i.userId === m.userId && i.revokedAt === null,
        ).length;
        counts.set(m.userId, n);
      }
      return counts;
    },
  };
}

describe("pairing H2", () => {
  it("registra instalación y valida nombre", async () => {
    const store = memoryStore();
    const crypto = stubCrypto();
    const clock = stubClock();
    const bad = await registerInstallation(store, crypto, clock, {
      platform: "web",
      displayName: "",
    });
    expect(bad.ok).toBe(false);
    const res = await registerInstallation(store, crypto, clock, {
      platform: "android",
      displayName: "Lux",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.installationSecret).toContain("secret-");
      const stored = await store.findInstallation(res.value.installation.id);
      expect(stored?.credentialHash).not.toBe(res.value.installationSecret);
    }
  });

  it("flujo completo: espacio + invite + consume + capacidad", async () => {
    const store = memoryStore();
    const crypto = stubCrypto();
    const clock = stubClock();
    const a = await registerInstallation(store, crypto, clock, {
      platform: "web",
      displayName: "A",
    });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const space = await createPairSpace(store, crypto, clock, {
      userId: a.value.user.id,
    });
    expect(space.ok).toBe(true);
    if (!space.ok) return;

    const inv = await createInvite(store, crypto, clock, {
      spaceId: space.value.space.id,
      actorUserId: a.value.user.id,
      ttlSeconds: 3600,
    });
    expect(inv.ok).toBe(true);
    if (!inv.ok) return;

    const bReg = await registerInstallation(store, crypto, clock, {
      platform: "android",
      displayName: "B",
    });
    expect(bReg.ok).toBe(true);
    if (!bReg.ok) return;

    const b = await consumeInvite(store, crypto, clock, {
      token: inv.value.inviteToken,
      userId: bReg.value.user.id,
    });
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.value.pairSpaceId).toBe(space.value.space.id);

    // Reusar el mismo token falla (otro usuario ya registrado).
    const cReg = await registerInstallation(store, crypto, clock, {
      platform: "web",
      displayName: "C",
    });
    if (!cReg.ok) return;
    const reuse = await consumeInvite(store, crypto, clock, {
      token: inv.value.inviteToken,
      userId: cReg.value.user.id,
    });
    expect(reuse).toEqual({ ok: false, code: "INVITE_ALREADY_USED" });

    // Tercer miembro excede capacidad.
    const inv2 = await createInvite(store, crypto, clock, {
      spaceId: space.value.space.id,
      actorUserId: a.value.user.id,
      ttlSeconds: 3600,
    });
    expect(inv2.ok).toBe(true);
    if (!inv2.ok) return;
    const c = await consumeInvite(store, crypto, clock, {
      token: inv2.value.inviteToken,
      userId: cReg.value.user.id,
    });
    expect(c).toEqual({ ok: false, code: "PAIRSPACE_FULL" });
  });

  it("consume idempotente si ya es miembro; rechaza segundo espacio", async () => {
    const store = memoryStore();
    const crypto = stubCrypto();
    const clock = stubClock();
    const a = await registerInstallation(store, crypto, clock, {
      platform: "web",
      displayName: "A",
    });
    if (!a.ok) return;
    const space = await createPairSpace(store, crypto, clock, {
      userId: a.value.user.id,
    });
    if (!space.ok) return;
    const inv = await createInvite(store, crypto, clock, {
      spaceId: space.value.space.id,
      actorUserId: a.value.user.id,
      ttlSeconds: 3600,
    });
    if (!inv.ok) return;
    // El creador (ya miembro) consume su propia invitación: no quema el token.
    const self = await consumeInvite(store, crypto, clock, {
      token: inv.value.inviteToken,
      userId: a.value.user.id,
    });
    expect(self).toEqual({
      ok: true,
      value: { pairSpaceId: space.value.space.id },
    });
    // El token sigue vivo para el segundo miembro.
    const bReg = await registerInstallation(store, crypto, clock, {
      platform: "web",
      displayName: "B",
    });
    if (!bReg.ok) return;
    const b = await consumeInvite(store, crypto, clock, {
      token: inv.value.inviteToken,
      userId: bReg.value.user.id,
    });
    expect(b.ok).toBe(true);
    // B ya está en un espacio: no puede unirse a otro.
    const cReg = await registerInstallation(store, crypto, clock, {
      platform: "web",
      displayName: "C",
    });
    if (!cReg.ok) return;
    const space2 = await createPairSpace(store, crypto, clock, {
      userId: cReg.value.user.id,
    });
    if (!space2.ok) return;
    const inv2 = await createInvite(store, crypto, clock, {
      spaceId: space2.value.space.id,
      actorUserId: cReg.value.user.id,
      ttlSeconds: 3600,
    });
    if (!inv2.ok) return;
    const second = await consumeInvite(store, crypto, clock, {
      token: inv2.value.inviteToken,
      userId: bReg.value.user.id,
    });
    expect(second).toEqual({ ok: false, code: "VALIDATION_ERROR" });
  });

  it("invite expirada se rechaza", async () => {
    const store = memoryStore();
    const crypto = stubCrypto();
    const clock = stubClock();
    const a = await registerInstallation(store, crypto, clock, {
      platform: "web",
      displayName: "A",
    });
    if (!a.ok) return;
    const space = await createPairSpace(store, crypto, clock, {
      userId: a.value.user.id,
    });
    if (!space.ok) return;
    const inv = await createInvite(store, crypto, clock, {
      spaceId: space.value.space.id,
      actorUserId: a.value.user.id,
      ttlSeconds: 60,
    });
    if (!inv.ok) return;
    clock.tick(61_000);
    const bReg = await registerInstallation(store, crypto, clock, {
      platform: "web",
      displayName: "B",
    });
    if (!bReg.ok) return;
    const res = await consumeInvite(store, crypto, clock, {
      token: inv.value.inviteToken,
      userId: bReg.value.user.id,
    });
    expect(res).toEqual({ ok: false, code: "INVITE_EXPIRED" });
  });

  it("revocar exige confirmación y pertenencia", async () => {
    const store = memoryStore();
    const crypto = stubCrypto();
    const clock = stubClock();
    const a = await registerInstallation(store, crypto, clock, {
      platform: "web",
      displayName: "A",
    });
    if (!a.ok) return;
    const noConfirm = await revokeInstallation(store, clock, {
      actorUserId: a.value.user.id,
      installationId: a.value.installation.id,
      confirm: false,
    });
    expect(noConfirm).toEqual({ ok: false, code: "VALIDATION_ERROR" });
    const other = await revokeInstallation(store, clock, {
      actorUserId: "otro",
      installationId: a.value.installation.id,
      confirm: true,
    });
    expect(other).toEqual({ ok: false, code: "FORBIDDEN" });
    const ok = await revokeInstallation(store, clock, {
      actorUserId: a.value.user.id,
      installationId: a.value.installation.id,
      confirm: true,
    });
    expect(ok.ok).toBe(true);
  });

  it("perfil actualiza nombre válido", async () => {
    const store = memoryStore();
    const crypto = stubCrypto();
    const clock = stubClock();
    const a = await registerInstallation(store, crypto, clock, {
      platform: "web",
      displayName: "A",
    });
    if (!a.ok) return;
    const res = await updateProfile(store, clock, {
      userId: a.value.user.id,
      displayName: "A2",
    });
    expect(res.ok && res.value.displayName).toBe("A2");
  });

  it("recovery ata la instalación al miembro sin activas", async () => {
    const store = memoryStore();
    const crypto = stubCrypto();
    const clock = stubClock();
    const a = await registerInstallation(store, crypto, clock, {
      platform: "web",
      displayName: "A",
    });
    if (!a.ok) return;
    const space = await createPairSpace(store, crypto, clock, {
      userId: a.value.user.id,
    });
    if (!space.ok) return;
    const inv = await createInvite(store, crypto, clock, {
      spaceId: space.value.space.id,
      actorUserId: a.value.user.id,
      ttlSeconds: 3600,
    });
    if (!inv.ok) return;
    const bReg = await registerInstallation(store, crypto, clock, {
      platform: "android",
      displayName: "B",
    });
    if (!bReg.ok) return;
    const b = await consumeInvite(store, crypto, clock, {
      token: inv.value.inviteToken,
      userId: bReg.value.user.id,
    });
    if (!b.ok) return;
    // B pierde su dispositivo: revoca su instalación.
    await revokeInstallation(store, clock, {
      actorUserId: bReg.value.user.id,
      installationId: bReg.value.installation.id,
      confirm: true,
    });
    const ch = await startRecovery(store, crypto, clock, {
      spaceId: space.value.space.id,
      installationId: "nueva-instalacion",
    });
    expect(ch.ok).toBe(true);
    if (!ch.ok) return;
    const done = await completeRecovery(store, crypto, clock, {
      challengeId: ch.value.id,
      recoverySecret: space.value.recoverySecret,
      platform: "android",
    });
    expect(done.ok).toBe(true);
    if (done.ok) expect(done.value.user.id).toBe(bReg.value.user.id);
  });

  it("login por QR: el PC muestra, el celular aprueba, misma sala", async () => {
    const store = memoryStore();
    const crypto = stubCrypto();
    const clock = stubClock();
    const a = await registerInstallation(store, crypto, clock, {
      platform: "android",
      displayName: "A",
    });
    if (!a.ok) return;
    const space = await createPairSpace(store, crypto, clock, {
      userId: a.value.user.id,
    });
    if (!space.ok) return;
    // El PC (sin sesión) abre la espera y muestra el QR.
    const created = await createLoginAttempt(store, crypto, clock, {
      platform: "web",
      ttlSeconds: 300,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const attemptId = created.value.attempt.id;
    const code = created.value.code;
    // Antes de aprobar: pendiente.
    const pending = await pollLoginAttempt(store, crypto, clock, {
      attemptId,
      code,
    });
    expect(pending).toEqual({ ok: true, value: { status: "pending" } });
    // El celular (con sesión) escanea y aprueba.
    const approved = await approveLoginAttempt(store, crypto, clock, {
      attemptId,
      code,
      approverUserId: a.value.user.id,
      approverInstallationId: a.value.installation.id,
    });
    expect(approved).toEqual({ ok: true, value: { platform: "web" } });
    // El PC sondea y entra: misma identidad, instalación nueva, misma sala.
    const joined = await pollLoginAttempt(store, crypto, clock, {
      attemptId,
      code,
    });
    expect(joined.ok).toBe(true);
    if (!joined.ok || joined.value.status !== "approved") return;
    expect(joined.value.user.id).toBe(a.value.user.id);
    expect(joined.value.installation.id).not.toBe(a.value.installation.id);
    expect(joined.value.pairSpaceId).toBe(space.value.space.id);
    expect((await store.activeMemberships(space.value.space.id)).length).toBe(
      1,
    );
    // Un solo uso: ni aprobar ni sondear de nuevo.
    const reuseApprove = await approveLoginAttempt(store, crypto, clock, {
      attemptId,
      code,
      approverUserId: a.value.user.id,
      approverInstallationId: a.value.installation.id,
    });
    expect(reuseApprove).toEqual({ ok: false, code: "LOGIN_ALREADY_USED" });
    const reusePoll = await pollLoginAttempt(store, crypto, clock, {
      attemptId,
      code,
    });
    expect(reusePoll).toEqual({ ok: false, code: "LOGIN_ALREADY_USED" });
  });

  it("login por QR: código erróneo, expirado e instalación revocada", async () => {
    const store = memoryStore();
    const crypto = stubCrypto();
    const clock = stubClock();
    const a = await registerInstallation(store, crypto, clock, {
      platform: "android",
      displayName: "A",
    });
    if (!a.ok) return;
    const created = await createLoginAttempt(store, crypto, clock, {
      platform: "web",
      ttlSeconds: 60,
    });
    if (!created.ok) return;
    const attemptId = created.value.attempt.id;
    // Código erróneo: indistinguible.
    const wrong = await approveLoginAttempt(store, crypto, clock, {
      attemptId,
      code: "codigo-erroneo",
      approverUserId: a.value.user.id,
      approverInstallationId: a.value.installation.id,
    });
    expect(wrong).toEqual({ ok: false, code: "NOT_FOUND" });
    clock.tick(61_000);
    const expiredApprove = await approveLoginAttempt(store, crypto, clock, {
      attemptId,
      code: created.value.code,
      approverUserId: a.value.user.id,
      approverInstallationId: a.value.installation.id,
    });
    expect(expiredApprove).toEqual({ ok: false, code: "LOGIN_EXPIRED" });
    const expiredPoll = await pollLoginAttempt(store, crypto, clock, {
      attemptId,
      code: created.value.code,
    });
    expect(expiredPoll).toEqual({ ok: false, code: "LOGIN_EXPIRED" });
    // Instalación revocada no puede aprobar entradas.
    const fresh = await createLoginAttempt(store, crypto, clock, {
      platform: "web",
      ttlSeconds: 300,
    });
    if (!fresh.ok) return;
    await revokeInstallation(store, clock, {
      actorUserId: a.value.user.id,
      installationId: a.value.installation.id,
      confirm: true,
    });
    const revoked = await approveLoginAttempt(store, crypto, clock, {
      attemptId: fresh.value.attempt.id,
      code: fresh.value.code,
      approverUserId: a.value.user.id,
      approverInstallationId: a.value.installation.id,
    });
    expect(revoked).toEqual({ ok: false, code: "FORBIDDEN" });
  });
});
