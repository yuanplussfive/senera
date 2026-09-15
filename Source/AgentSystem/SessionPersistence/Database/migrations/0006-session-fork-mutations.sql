CREATE TABLE session_fork_mutations (
  target_session_id  TEXT PRIMARY KEY,
  mutation_id        TEXT NOT NULL UNIQUE,
  source_session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  through_request_id TEXT NOT NULL,
  pi_kind            TEXT NOT NULL CHECK(pi_kind IN ('none', 'fork')),
  pi_entry_id        TEXT,
  model_provider_id  TEXT,
  created_at         TEXT NOT NULL,
  CHECK((pi_kind = 'fork' AND pi_entry_id IS NOT NULL) OR (pi_kind = 'none' AND pi_entry_id IS NULL))
);

CREATE INDEX idx_session_fork_mutations_source
  ON session_fork_mutations(source_session_id, created_at);
