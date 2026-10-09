import { describe, expect, it } from "vitest";
import type {
  Installation,
  Invite,
  Membership,
  PairSpace,
  RecoveryChallenge,
  RecoveryCredential,
  User,
} from "./entities";
import {
  completeRecovery,
  consumeInvite,
  createInvite,
  createPairSpace,
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

    const b = await consumeInvite(store, crypto, clock, {
      token: inv.value.inviteToken,
      displayName: "B",
      platform: "android",
    });
    expect(b.ok).toBe(true);

    // Reusar el mismo token falla.
    const reuse = await consumeInvite(store, crypto, clock, {
      token: inv.value.inviteToken,
      displayName: "C",
      platform: "web",
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
      displayName: "C",
      platform: "web",
    });
    expect(c).toEqual({ ok: false, code: "PAIRSPACE_FULL" });
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
    const res = await consumeInvite(store, crypto, clock, {
      token: inv.value.inviteToken,
      displayName: "B",
      platform: "web",
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
    const b = await consumeInvite(store, crypto, clock, {
      token: inv.value.inviteToken,
      displayName: "B",
      platform: "android",
    });
    if (!b.ok) return;
    // B pierde su dispositivo: revoca su instalación.
    await revokeInstallation(store, clock, {
      actorUserId: b.value.user.id,
      installationId: b.value.installation.id,
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
    if (done.ok) expect(done.value.user.id).toBe(b.value.user.id);
  });
});
