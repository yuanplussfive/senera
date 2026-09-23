-- Resident state ledger: durable per-session "inner weather". The host ruleset
-- advances a single current row per session scope; the row keeps the last
-- observed time so a session's trajectory can be inspected and, if ever needed,
-- replayed deterministically.

CREATE TABLE resident_state_records (
  id TEXT PRIMARY KEY,
  scope_kind TEXT NOT NULL CHECK(scope_kind IN ('user','session','workspace','world','account','runtime')),
  scope_id TEXT NOT NULL,
  bearing TEXT NOT NULL CHECK(bearing IN ('direct','wry','gentle','excited','calm')),
  mood TEXT NOT NULL CHECK(mood IN ('relaxed','focused','trying','relieved','amused','tense')),
  footing TEXT NOT NULL CHECK(footing IN ('on_whim','data_gathering','in_the_middle_of','done')),
  target TEXT,
  observed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(scope_kind, scope_id)
);

CREATE INDEX idx_resident_state_scope_latest
  ON resident_state_records(scope_kind, scope_id, updated_at DESC);