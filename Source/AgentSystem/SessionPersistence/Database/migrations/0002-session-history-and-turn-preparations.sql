CREATE TABLE session_history_mutations (
  session_id        TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  mutation_id       TEXT NOT NULL UNIQUE,
  kind              TEXT NOT NULL CHECK(kind = 'truncate'),
  from_request_id   TEXT NOT NULL,
  pi_kind           TEXT NOT NULL CHECK(pi_kind IN ('none', 'reset', 'rewind')),
  pi_entry_id       TEXT,
  model_provider_id TEXT,
  created_at        TEXT NOT NULL,
  CHECK((pi_kind = 'rewind' AND pi_entry_id IS NOT NULL) OR (pi_kind != 'rewind' AND pi_entry_id IS NULL))
);

CREATE TABLE turn_preparations (
  session_id     TEXT NOT NULL,
  request_id     TEXT NOT NULL,
  snapshot_json  TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  PRIMARY KEY (session_id, request_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX idx_turn_preparations_session ON turn_preparations(session_id, created_at);
