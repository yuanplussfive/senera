CREATE TABLE continuity_observations (
  id TEXT PRIMARY KEY,
  uri TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  source_refs_json TEXT NOT NULL,
  watermark TEXT NOT NULL,
  scope_kind TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  authority TEXT NOT NULL,
  confidence REAL NOT NULL,
  occurred_at TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX idx_continuity_observations_scope_time
  ON continuity_observations(scope_kind, scope_id, created_at_ms);
CREATE INDEX idx_continuity_observations_kind_time
  ON continuity_observations(kind, created_at_ms);

CREATE TABLE continuity_assertions (
  id TEXT PRIMARY KEY,
  uri TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  claim TEXT NOT NULL,
  how_to_apply TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  source_observation_uris_json TEXT NOT NULL,
  scope_kind TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  authority TEXT NOT NULL,
  confidence REAL NOT NULL,
  temporal_kind TEXT NOT NULL,
  valid_from TEXT,
  valid_until TEXT,
  time_zone TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_continuity_assertions_active_scope
  ON continuity_assertions(status, scope_kind, scope_id, updated_at);
CREATE INDEX idx_continuity_assertions_subject
  ON continuity_assertions(subject, status, updated_at);

CREATE TABLE continuity_signals (
  scope_kind TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  signal_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  value_type TEXT NOT NULL,
  authority TEXT NOT NULL,
  confidence REAL NOT NULL,
  observed_at TEXT NOT NULL,
  expires_at TEXT,
  source_observation_uris_json TEXT NOT NULL,
  PRIMARY KEY(scope_kind, scope_id, namespace, signal_key)
);
CREATE INDEX idx_continuity_signals_expiry
  ON continuity_signals(expires_at);

CREATE TABLE continuity_rules (
  id TEXT PRIMARY KEY,
  uri TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  condition_json TEXT NOT NULL,
  action_json TEXT NOT NULL,
  scope_kind TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  authority TEXT NOT NULL,
  confidence REAL NOT NULL,
  temporal_kind TEXT NOT NULL,
  valid_from TEXT,
  valid_until TEXT,
  time_zone TEXT NOT NULL,
  source_observation_uris_json TEXT NOT NULL,
  status TEXT NOT NULL,
  last_evaluated_at TEXT,
  last_triggered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_continuity_rules_scope_status
  ON continuity_rules(scope_kind, scope_id, status, valid_until);

CREATE TABLE continuity_learning_jobs (
  episode_uri TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'retry', 'completed', 'failed')),
  attempts INTEGER NOT NULL,
  next_attempt_at_ms INTEGER NOT NULL,
  last_error TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY(episode_uri) REFERENCES memory_episodes(uri) ON DELETE CASCADE
);
CREATE INDEX idx_continuity_learning_jobs_due
  ON continuity_learning_jobs(status, next_attempt_at_ms, updated_at_ms);
