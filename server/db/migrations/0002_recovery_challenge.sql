-- 0002_recovery_challenge.sql — H2: challenges de recuperación de corta vida.
CREATE TABLE recovery_challenges (
  id TEXT PRIMARY KEY,
  pair_space_id TEXT NOT NULL REFERENCES pair_spaces(id),
  installation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE INDEX recovery_challenges_space ON recovery_challenges(pair_space_id, expires_at);
