import type {
  DrawingRecord,
  IdempotencyRecord,
  Installation,
  Invite,
  LibraryStore,
  Membership,
  PairEvent,
  PairingStore,
  PairSpace,
  RecoveryChallenge,
  RecoveryCredential,
  UploadIntent,
  User,
} from "@cookie/core";
import type { Db, DbWrite } from "./db";

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
    setPushToken: async (installationId, token) => {
      await db.run(
        "UPDATE installations SET push_token = ? WHERE id = ?",
        token,
        installationId,
      );
    },
  };
}

/** Tokens FCM vigentes de un espacio (H8 push). Sin revocations. */
export async function listSpacePushTokens(
  db: Db,
  spaceId: string,
): Promise<string[]> {
  const rows = await db.all<{ push_token: string | null }>(
    `SELECT i.push_token FROM installations i
     JOIN memberships m ON m.user_id = i.user_id
     WHERE m.pair_space_id = ? AND m.left_at IS NULL
       AND i.revoked_at IS NULL AND i.push_token IS NOT NULL`,
    spaceId,
  );
  return rows
    .map((r) => r.push_token)
    .filter((t): t is string => typeof t === "string");
}

export interface SessionStore {
  insertSession(s: SessionRow): Promise<void>;
  findSessionByRefreshHash(hash: string): Promise<SessionRow | null>;
  updateSession(s: SessionRow): Promise<void>;
  revokeInstallationSessions(
    installationId: string,
    nowIso: string,
  ): Promise<void>;
  /** Token FCM por instalación (H6). Null lo limpia (logout/revoke). */
  setPushToken(installationId: string, token: string | null): Promise<void>;
}

export interface WsTicketRow {
  id: string;
  pair_space_id: string;
  installation_id: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
}

export interface WsTicketStore {
  createTicket(t: WsTicketRow): Promise<void>;
  /** Consumo atómico: solo válido, vigente y sin consumir. */
  consumeTicket(id: string, nowIso: string): Promise<WsTicketRow | null>;
  /** Limpia tickets consumidos o vencidos (GC). Devuelve filas. */
  deleteSettledTickets(nowIso: string): Promise<number>;
}

export function sqlWsTicketStore(db: Db): WsTicketStore {
  return {
    createTicket: async (t) => {
      await db.run(
        "INSERT INTO ws_tickets(id, pair_space_id, installation_id, created_at, expires_at, consumed_at) VALUES (?, ?, ?, ?, ?, ?)",
        t.id,
        t.pair_space_id,
        t.installation_id,
        t.created_at,
        t.expires_at,
        t.consumed_at,
      );
    },
    consumeTicket: async (id, nowIso) => {
      const row = await db.get<WsTicketRow>(
        `UPDATE ws_tickets SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND expires_at > ?
         RETURNING *`,
        nowIso,
        id,
        nowIso,
      );
      return row ?? null;
    },
    deleteSettledTickets: async (nowIso) => {
      const before = await db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM ws_tickets WHERE consumed_at IS NOT NULL OR expires_at <= ?",
        nowIso,
      );
      await db.run(
        "DELETE FROM ws_tickets WHERE consumed_at IS NOT NULL OR expires_at <= ?",
        nowIso,
      );
      return before?.n ?? 0;
    },
  };
}

type DrawingRow = {
  id: string;
  pair_space_id: string;
  author_user_id: string;
  created_at: string;
  document_key: string;
  preview_key: string;
  width: number;
  height: number;
  content_hash: string;
  deleted_at: string | null;
};

type DrawingRowWithSeq = DrawingRow & { event_seq: number | null };

type EventRow = {
  pair_space_id: string;
  seq: number;
  event_id: string;
  type: string;
  actor_user_id: string;
  entity_id: string;
  payload_version: number;
  created_at: string;
  payload_json: string;
};

type IdempotencyRow = {
  scope: string;
  idempotency_key: string;
  request_hash: string;
  response_json: string;
  created_at: string;
  expires_at: string;
};

type IntentRow = {
  id: string;
  installation_id: string;
  pair_space_id: string;
  drawing_id: string;
  purpose: string;
  object_key: string;
  expected_hash: string;
  max_bytes: number;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
};

const toDrawing = (r: DrawingRow): DrawingRecord => ({
  id: r.id,
  pairSpaceId: r.pair_space_id,
  authorUserId: r.author_user_id,
  createdAt: r.created_at,
  documentKey: r.document_key,
  previewKey: r.preview_key,
  width: r.width,
  height: r.height,
  contentHash: r.content_hash,
  deletedAt: r.deleted_at,
});

const toEvent = (r: EventRow): PairEvent => ({
  seq: r.seq,
  eventId: r.event_id,
  type: r.type as PairEvent["type"],
  actorUserId: r.actor_user_id,
  entityId: r.entity_id,
  createdAt: r.created_at,
});

const toIdempotency = (r: IdempotencyRow): IdempotencyRecord => ({
  scope: r.scope,
  key: r.idempotency_key,
  requestHash: r.request_hash,
  responseJson: r.response_json,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
});

const toIntent = (r: IntentRow): UploadIntent => ({
  id: r.id,
  installationId: r.installation_id,
  pairSpaceId: r.pair_space_id,
  drawingId: r.drawing_id,
  purpose: r.purpose as UploadIntent["purpose"],
  objectKey: r.object_key,
  expectedHash: r.expected_hash,
  maxBytes: r.max_bytes,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  consumedAt: r.consumed_at,
});

/** LibraryStore SQL (H4). Publicación atómica via batch. */
export function sqlLibraryStore(db: Db): LibraryStore {
  return {
    findDrawing: async (id) => {
      const r = await db.get<DrawingRow>(
        "SELECT * FROM drawings WHERE id = ?",
        id,
      );
      return r ? toDrawing(r) : null;
    },
    insertDrawingWithEvent: async ({
      drawing,
      event,
      idempotency,
      responseForSeq,
    }) => {
      const next = await db.get<{ next: number }>(
        "SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM events WHERE pair_space_id = ?",
        drawing.pairSpaceId,
      );
      const seq = next?.next ?? 1;
      const ops: DbWrite[] = [
        {
          sql: "INSERT INTO drawings(id, pair_space_id, author_user_id, created_at, document_key, preview_key, width, height, content_hash, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          params: [
            drawing.id,
            drawing.pairSpaceId,
            drawing.authorUserId,
            drawing.createdAt,
            drawing.documentKey,
            drawing.previewKey,
            drawing.width,
            drawing.height,
            drawing.contentHash,
            drawing.deletedAt,
          ],
        },
        {
          sql: "INSERT INTO events(pair_space_id, seq, event_id, type, actor_user_id, entity_id, payload_version, created_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)",
          params: [
            drawing.pairSpaceId,
            seq,
            event.eventId,
            event.type,
            event.actorUserId,
            event.entityId,
            event.createdAt,
            JSON.stringify({
              drawingId: drawing.id,
              contentHash: drawing.contentHash,
            }),
          ],
        },
      ];
      if (idempotency) {
        ops.push({
          sql: "INSERT INTO idempotency_records(scope, idempotency_key, request_hash, response_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
          params: [
            idempotency.scope,
            idempotency.key,
            idempotency.requestHash,
            responseForSeq(seq),
            idempotency.createdAt,
            idempotency.expiresAt,
          ],
        });
      }
      await db.batch(ops);
      return seq;
    },
    tombstoneDrawingWithEvent: async (drawingId, deletedAt, event) => {
      const drawing = await db.get<DrawingRow>(
        "SELECT * FROM drawings WHERE id = ?",
        drawingId,
      );
      if (!drawing) throw new Error("drawing not found for tombstone");
      const next = await db.get<{ next: number }>(
        "SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM events WHERE pair_space_id = ?",
        drawing.pair_space_id,
      );
      const seq = next?.next ?? 1;
      await db.batch([
        {
          sql: "UPDATE drawings SET deleted_at = ? WHERE id = ?",
          params: [deletedAt, drawingId],
        },
        {
          sql: "INSERT INTO events(pair_space_id, seq, event_id, type, actor_user_id, entity_id, payload_version, created_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)",
          params: [
            drawing.pair_space_id,
            seq,
            event.eventId,
            event.type,
            event.actorUserId,
            event.entityId,
            event.createdAt,
            JSON.stringify({ drawingId, deletedAt }),
          ],
        },
      ]);
      return seq;
    },
    listDrawingsVisible: async (spaceId, after, limit) => {
      const base = `SELECT d.*, e.seq AS event_seq FROM drawings d
        LEFT JOIN events e ON e.pair_space_id = d.pair_space_id
          AND e.entity_id = d.id AND e.type = 'drawing.created'
        WHERE d.pair_space_id = ? AND d.deleted_at IS NULL`;
      const order = " ORDER BY d.created_at DESC, d.id DESC LIMIT ?";
      const rows = after
        ? await db.all<DrawingRowWithSeq>(
            `${base} AND (d.created_at < ? OR (d.created_at = ? AND d.id < ?))${order}`,
            spaceId,
            after.createdAt,
            after.createdAt,
            after.id,
            limit + 1,
          )
        : await db.all<DrawingRowWithSeq>(
            `${base}${order}`,
            spaceId,
            limit + 1,
          );
      return rows.map((r) => ({
        drawing: toDrawing(r),
        eventSeq: r.event_seq ?? 0,
      }));
    },
    listEvents: async (spaceId, afterSeq, limit) => {
      const rows = await db.all<EventRow>(
        "SELECT * FROM events WHERE pair_space_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?",
        spaceId,
        afterSeq,
        limit,
      );
      return rows.map(toEvent);
    },
    currentSeq: async (spaceId) => {
      const r = await db.get<{ current: number }>(
        "SELECT COALESCE(MAX(seq), 0) AS current FROM events WHERE pair_space_id = ?",
        spaceId,
      );
      return r?.current ?? 0;
    },
    minSeq: async (spaceId) => {
      const r = await db.get<{ min: number | null }>(
        "SELECT MIN(seq) AS min FROM events WHERE pair_space_id = ?",
        spaceId,
      );
      return r?.min ?? null;
    },
    getIdempotency: async (scope, key) => {
      const r = await db.get<IdempotencyRow>(
        "SELECT * FROM idempotency_records WHERE scope = ? AND idempotency_key = ?",
        scope,
        key,
      );
      return r ? toIdempotency(r) : null;
    },
    createUploadIntent: async (i) => {
      await db.run(
        "INSERT INTO upload_intents(id, installation_id, pair_space_id, drawing_id, purpose, object_key, expected_hash, max_bytes, created_at, expires_at, consumed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        i.id,
        i.installationId,
        i.pairSpaceId,
        i.drawingId,
        i.purpose,
        i.objectKey,
        i.expectedHash,
        i.maxBytes,
        i.createdAt,
        i.expiresAt,
        i.consumedAt,
      );
    },
    findUploadIntent: async (id) => {
      const r = await db.get<IntentRow>(
        "SELECT * FROM upload_intents WHERE id = ?",
        id,
      );
      return r ? toIntent(r) : null;
    },
    consumeUploadIntent: async (id, consumedAt) => {
      await db.run(
        "UPDATE upload_intents SET consumed_at = ? WHERE id = ?",
        consumedAt,
        id,
      );
    },
    listExpiredIntents: async (nowIso, limit) => {
      const rows = await db.all<IntentRow>(
        "SELECT * FROM upload_intents WHERE consumed_at IS NULL AND expires_at <= ? LIMIT ?",
        nowIso,
        limit,
      );
      return rows.map(toIntent);
    },
    deleteIntent: async (id) => {
      await db.run("DELETE FROM upload_intents WHERE id = ?", id);
    },
    deleteExpiredIdempotency: async (nowIso) => {
      const before = await db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM idempotency_records WHERE expires_at <= ?",
        nowIso,
      );
      await db.run(
        "DELETE FROM idempotency_records WHERE expires_at <= ?",
        nowIso,
      );
      return before?.n ?? 0;
    },
  };
}
