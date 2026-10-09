-- 0005_ws_tickets.sql — H5: tickets WS de un solo uso, TTL segundos.
CREATE TABLE ws_tickets (
  id TEXT PRIMARY KEY,
  pair_space_id TEXT NOT NULL REFERENCES pair_spaces(id),
  installation_id TEXT NOT NULL REFERENCES installations(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE INDEX ws_tickets_space ON ws_tickets(pair_space_id, expires_at);
