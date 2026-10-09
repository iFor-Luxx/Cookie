import type {
  Installation,
  Invite,
  Membership,
  PairingStore,
  PairSpace,
  RecoveryChallenge,
  RecoveryCredential,
  User,
} from "@cookie/core";
import type { Db } from "./db";

type UserRow = {
  id: string;
  display_name: string;
  avatar_key: string | null;
  created_at: string;
  updated_at: string;
};

type InstallationRow = {
  id: string;
  user_id: string;
  platform: string;
  credential_hash: string;
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
};

type PairSpaceRow = {
  id: string;
  status: string;
  created_at: string;
};

type MembershipRow = {
  pair_space_id: string;
  user_id: string;
  role: string;
  joined_at: string;
  left_at: string | null;
};

type InviteRow = {
  id: string;
  pair_space_id: string;
  token_hash: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  consumed_by: string | null;
};

type RecoveryRow = {
  id: string;
  pair_space_id: string;
  secret_hash: string;
  created_at: string;
  used_at: string | null;
  revoked_at: string | null;
};

type ChallengeRow = {
  id: string;
  pair_space_id: string;
  installation_id: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
};

const toUser = (r: UserRow): User => ({
  id: r.id,
  displayName: r.display_name,
  avatarKey: r.avatar_key,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toInstallation = (r: InstallationRow): Installation => ({
  id: r.id,
  userId: r.user_id,
  platform: r.platform as Installation["platform"],
  credentialHash: r.credential_hash,
  createdAt: r.created_at,
  lastSeenAt: r.last_seen_at,
  revokedAt: r.revoked_at,
});

const toSpace = (r: PairSpaceRow): PairSpace => ({
  id: r.id,
  status: r.status as PairSpace["status"],
  createdAt: r.created_at,
});

const toMembership = (r: MembershipRow): Membership => ({
  pairSpaceId: r.pair_space_id,
  userId: r.user_id,
  role: r.role as Membership["role"],
  joinedAt: r.joined_at,
  leftAt: r.left_at,
});

const toInvite = (r: InviteRow): Invite => ({
  id: r.id,
  pairSpaceId: r.pair_space_id,
  tokenHash: r.token_hash,
  createdBy: r.created_by,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  consumedAt: r.consumed_at,
  consumedBy: r.consumed_by,
});

const toRecovery = (r: RecoveryRow): RecoveryCredential => ({
  id: r.id,
  pairSpaceId: r.pair_space_id,
  secretHash: r.secret_hash,
  createdAt: r.created_at,
  usedAt: r.used_at,
  revokedAt: r.revoked_at,
});

const toChallenge = (r: ChallengeRow): RecoveryChallenge => ({
  id: r.id,
  pairSpaceId: r.pair_space_id,
  installationId: r.installation_id,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  consumedAt: r.consumed_at,
});

export interface SessionRow {
  id: string;
  installation_id: string;
  refresh_hash: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
}

/** PairingStore SQL. Transacciones H2 críticas (consume) vía `immediate`. */
export function sqlPairingStore(db: Db): PairingStore & SessionStore {
  return {
    insertUser: async (u) => {
      await db.run(
        "INSERT INTO users(id, display_name, avatar_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        u.id,
        u.displayName,
        u.avatarKey,
        u.createdAt,
        u.updatedAt,
      );
    },
    findUser: async (id) => {
      const r = await db.get<UserRow>("SELECT * FROM users WHERE id = ?", id);
      return r ? toUser(r) : null;
    },
    updateUser: async (u) => {
      await db.run(
        "UPDATE users SET display_name = ?, avatar_key = ?, updated_at = ? WHERE id = ?",
        u.displayName,
        u.avatarKey,
        u.updatedAt,
        u.id,
      );
    },
    insertInstallation: async (i) => {
      await db.run(
        "INSERT INTO installations(id, user_id, platform, credential_hash, created_at, last_seen_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        i.id,
        i.userId,
        i.platform,
        i.credentialHash,
        i.createdAt,
        i.lastSeenAt,
        i.revokedAt,
      );
    },
    findInstallation: async (id) => {
      const r = await db.get<InstallationRow>(
        "SELECT * FROM installations WHERE id = ?",
        id,
      );
      return r ? toInstallation(r) : null;
    },
    updateInstallation: async (i) => {
      await db.run(
        "UPDATE installations SET credential_hash = ?, last_seen_at = ?, revoked_at = ? WHERE id = ?",
        i.credentialHash,
        i.lastSeenAt,
        i.revokedAt,
        i.id,
      );
    },
    insertPairSpace: async (s) => {
      await db.run(
        "INSERT INTO pair_spaces(id, status, created_at, next_event_seq) VALUES (?, ?, ?, 1)",
        s.id,
        s.status,
        s.createdAt,
      );
    },
    findPairSpace: async (id) => {
      const r = await db.get<PairSpaceRow>(
        "SELECT * FROM pair_spaces WHERE id = ?",
        id,
      );
      return r ? toSpace(r) : null;
    },
    insertMembership: async (m) => {
      await db.run(
        "INSERT INTO memberships(pair_space_id, user_id, role, joined_at, left_at) VALUES (?, ?, ?, ?, ?)",
        m.pairSpaceId,
        m.userId,
        m.role,
        m.joinedAt,
        m.leftAt,
      );
    },
    activeMemberships: async (spaceId) => {
      const rows = await db.all<MembershipRow>(
        "SELECT * FROM memberships WHERE pair_space_id = ? AND left_at IS NULL",
        spaceId,
      );
      return rows.map(toMembership);
    },
    findMembership: async (spaceId, userId) => {
      const r = await db.get<MembershipRow>(
        "SELECT * FROM memberships WHERE pair_space_id = ? AND user_id = ?",
        spaceId,
        userId,
      );
      return r ? toMembership(r) : null;
    },
    userSpaces: async (userId) => {
      const rows = await db.all<MembershipRow>(
        "SELECT * FROM memberships WHERE user_id = ? AND left_at IS NULL",
        userId,
      );
      return rows.map(toMembership);
    },
    insertInvite: async (i) => {
      await db.run(
        "INSERT INTO invites(id, pair_space_id, token_hash, created_by, created_at, expires_at, consumed_at, consumed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        i.id,
        i.pairSpaceId,
        i.tokenHash,
        i.createdBy,
        i.createdAt,
        i.expiresAt,
        i.consumedAt,
        i.consumedBy,
      );
    },
    findInviteByTokenHash: async (hash) => {
      const r = await db.get<InviteRow>(
        "SELECT * FROM invites WHERE token_hash = ?",
        hash,
      );
      return r ? toInvite(r) : null;
    },
    updateInvite: async (i) => {
      await db.run(
        "UPDATE invites SET consumed_at = ?, consumed_by = ?, expires_at = ? WHERE id = ?",
        i.consumedAt,
        i.consumedBy,
        i.expiresAt,
        i.id,
      );
    },
    expireActiveInvites: async (spaceId, nowIso) => {
      await db.run(
        "UPDATE invites SET expires_at = ? WHERE pair_space_id = ? AND consumed_at IS NULL AND expires_at > ?",
        nowIso,
        spaceId,
        nowIso,
      );
    },
    insertRecoveryCredential: async (r) => {
      await db.run(
        "INSERT INTO recovery_credentials(id, pair_space_id, secret_hash, created_at, used_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?)",
        r.id,
        r.pairSpaceId,
        r.secretHash,
        r.createdAt,
        r.usedAt,
        r.revokedAt,
      );
    },
    activeRecoveryCredential: async (spaceId) => {
      const r = await db.get<RecoveryRow>(
        "SELECT * FROM recovery_credentials WHERE pair_space_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",
        spaceId,
      );
      return r ? toRecovery(r) : null;
    },
    insertRecoveryChallenge: async (c) => {
      await db.run(
        "INSERT INTO recovery_challenges(id, pair_space_id, installation_id, created_at, expires_at, consumed_at) VALUES (?, ?, ?, ?, ?, ?)",
        c.id,
        c.pairSpaceId,
        c.installationId,
        c.createdAt,
        c.expiresAt,
        c.consumedAt,
      );
    },
    findRecoveryChallenge: async (id) => {
      const r = await db.get<ChallengeRow>(
        "SELECT * FROM recovery_challenges WHERE id = ?",
        id,
      );
      return r ? toChallenge(r) : null;
    },
    updateRecoveryChallenge: async (c) => {
      await db.run(
        "UPDATE recovery_challenges SET consumed_at = ? WHERE id = ?",
        c.consumedAt,
        c.id,
      );
    },
    countActiveInstallations: async (spaceId) => {
      const rows = await db.all<{ user_id: string; n: number }>(
        `SELECT m.user_id AS user_id, COUNT(i.id) AS n
         FROM memberships m LEFT JOIN installations i
           ON i.user_id = m.user_id AND i.revoked_at IS NULL
         WHERE m.pair_space_id = ? AND m.left_at IS NULL
         GROUP BY m.user_id`,
        spaceId,
      );
      return new Map(rows.map((r) => [r.user_id, r.n]));
    },
    // sessions
    insertSession: async (s) => {
      await db.run(
        "INSERT INTO sessions(id, installation_id, refresh_hash, created_at, expires_at, consumed_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        s.id,
        s.installation_id,
        s.refresh_hash,
        s.created_at,
        s.expires_at,
        s.consumed_at,
        s.revoked_at,
      );
    },
    findSessionByRefreshHash: async (hash) => {
      const r = await db.get<SessionRow>(
        "SELECT * FROM sessions WHERE refresh_hash = ?",
        hash,
      );
      return r ?? null;
    },
    updateSession: async (s) => {
      await db.run(
        "UPDATE sessions SET consumed_at = ?, revoked_at = ? WHERE id = ?",
        s.consumed_at,
        s.revoked_at,
        s.id,
      );
    },
    revokeInstallationSessions: async (installationId, nowIso) => {
      await db.run(
        "UPDATE sessions SET revoked_at = ? WHERE installation_id = ? AND revoked_at IS NULL",
        nowIso,
        installationId,
      );
    },
  };
}

export interface SessionStore {
  insertSession(s: SessionRow): Promise<void>;
  findSessionByRefreshHash(hash: string): Promise<SessionRow | null>;
  updateSession(s: SessionRow): Promise<void>;
  revokeInstallationSessions(
    installationId: string,
    nowIso: string,
  ): Promise<void>;
}
