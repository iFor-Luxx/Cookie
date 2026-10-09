-- 0007_login_attempts.sql — H9: entrada estilo WhatsApp Web. El PC sin
-- sesión abre la espera y muestra su QR; el celular con sesión la aprueba.
-- El QR no es credencial: solo referencia el intento pendiente. Un solo uso.
-- Tiempos en ISO-8601 UTC (TEXT). Hashes, nunca secretos en claro.
CREATE TABLE login_attempts (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('web', 'android')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  approved_at TEXT,
  approved_user_id TEXT REFERENCES users(id),
  approved_by_installation_id TEXT REFERENCES installations(id),
  consumed_at TEXT
);
CREATE INDEX login_attempts_expiry ON login_attempts(expires_at, consumed_at);
