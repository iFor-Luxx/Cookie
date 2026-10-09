-- 0006_login_codes.sql — H9: códigos QR de entrada (mismo usuario, otro
-- dispositivo). Un solo uso, TTL corto. Aprobación de miembro (FR-10).
-- Tiempos en ISO-8601 UTC (TEXT). Hashes, nunca secretos en claro.
CREATE TABLE login_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_by_installation_id TEXT NOT NULL REFERENCES installations(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  consumed_by_installation_id TEXT REFERENCES installations(id)
);
CREATE INDEX login_codes_user ON login_codes(user_id, consumed_at);
