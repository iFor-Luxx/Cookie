-- 0001_pairing.sql — H2: identidad, PairSpace, invites, recovery (SDD §5).
-- Tiempos en ISO-8601 UTC (TEXT). Hashes, nunca secretos en claro.
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 32),
  avatar_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE installations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  platform TEXT NOT NULL CHECK (platform IN ('web', 'android')),
  credential_hash TEXT NOT NULL,
  push_token TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX installations_user_active ON installations(user_id, revoked_at);

CREATE TABLE pair_spaces (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('active', 'locked', 'deleting', 'deleted')),
  created_at TEXT NOT NULL,
  next_event_seq INTEGER NOT NULL DEFAULT 1,
  retention_policy TEXT NOT NULL DEFAULT 'until_deleted'
);

CREATE TABLE memberships (
  pair_space_id TEXT NOT NULL REFERENCES pair_spaces(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  joined_at TEXT NOT NULL,
  left_at TEXT,
  PRIMARY KEY (pair_space_id, user_id)
);
CREATE INDEX memberships_user_active ON memberships(user_id, left_at);

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  pair_space_id TEXT NOT NULL REFERENCES pair_spaces(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  consumed_by TEXT REFERENCES users(id)
);
CREATE INDEX invites_space ON invites(pair_space_id, consumed_at);

CREATE TABLE recovery_credentials (
  id TEXT PRIMARY KEY,
  pair_space_id TEXT NOT NULL REFERENCES pair_spaces(id),
  secret_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX recovery_space ON recovery_credentials(pair_space_id, revoked_at);
