-- 0003_sessions.sql — H2: refresh rotation con detección de reuse.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id),
  refresh_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  revoked_at TEXT
);
CREATE INDEX sessions_installation ON sessions(installation_id, revoked_at);
