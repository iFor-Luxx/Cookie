-- 0004_drawings.sql — H4: dibujos, eventos, idempotencia, upload intents (SDD §5).
CREATE TABLE drawings (
  id TEXT PRIMARY KEY,
  pair_space_id TEXT NOT NULL REFERENCES pair_spaces(id),
  author_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  document_key TEXT NOT NULL,
  preview_key TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX drawings_space_timeline ON drawings(pair_space_id, created_at DESC, id DESC);

CREATE TABLE events (
  pair_space_id TEXT NOT NULL REFERENCES pair_spaces(id),
  seq INTEGER NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (pair_space_id, seq)
);

CREATE TABLE idempotency_records (
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (scope, idempotency_key)
);

CREATE TABLE upload_intents (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id),
  pair_space_id TEXT NOT NULL REFERENCES pair_spaces(id),
  drawing_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('drawing-doc', 'drawing-preview')),
  -- object_key NO es UNIQUE: re-intentar un upload sobrescribe el mismo key
  -- determinista (idempotente). La validez la da consumed_at + hash verificado.
  object_key TEXT NOT NULL,
  expected_hash TEXT NOT NULL,
  max_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE INDEX upload_intents_drawing ON upload_intents(pair_space_id, drawing_id, consumed_at);
