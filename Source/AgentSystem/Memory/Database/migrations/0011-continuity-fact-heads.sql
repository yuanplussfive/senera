CREATE TABLE continuity_fact_heads (
  scope_kind TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  observation_uri TEXT NOT NULL,
  claim TEXT NOT NULL,
  normalized_claim TEXT NOT NULL,
  authority TEXT NOT NULL,
  confidence REAL NOT NULL,
  valid_until TEXT,
  source_refs_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'superseded', 'retracted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(scope_kind, scope_id, fact_key),
  FOREIGN KEY(observation_uri) REFERENCES continuity_observations(uri) ON DELETE CASCADE
);

CREATE TABLE continuity_fact_history (
  id TEXT PRIMARY KEY,
  scope_kind TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  observation_uri TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('created', 'reinforced', 'superseded', 'retracted')),
  claim TEXT NOT NULL,
  authority TEXT NOT NULL,
  confidence REAL NOT NULL,
  occurred_at TEXT NOT NULL,
  source_refs_json TEXT NOT NULL,
  FOREIGN KEY(observation_uri) REFERENCES continuity_observations(uri) ON DELETE CASCADE
);

CREATE INDEX idx_continuity_fact_heads_active
  ON continuity_fact_heads(scope_kind, scope_id, status, updated_at DESC);
CREATE INDEX idx_continuity_fact_history_key_time
  ON continuity_fact_history(scope_kind, scope_id, fact_key, occurred_at DESC);
