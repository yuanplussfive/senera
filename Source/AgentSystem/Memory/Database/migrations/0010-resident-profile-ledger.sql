CREATE TABLE resident_profile_records (
  id             TEXT PRIMARY KEY,
  uri            TEXT NOT NULL UNIQUE,
  subject        TEXT NOT NULL CHECK(subject IN ('agent', 'user')),
  profile_key    TEXT NOT NULL,
  value_json     TEXT NOT NULL,
  value_type     TEXT NOT NULL CHECK(value_type IN ('boolean', 'number', 'string')),
  scope_kind     TEXT NOT NULL CHECK(scope_kind IN ('user', 'session', 'workspace', 'world', 'account', 'runtime')),
  scope_id       TEXT NOT NULL,
  authority      TEXT NOT NULL CHECK(authority IN ('user_explicit', 'tool_verified', 'system_observed', 'model_inferred')),
  confidence     REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  valid_until    TEXT NOT NULL,
  time_zone      TEXT NOT NULL,
  source_refs_json TEXT NOT NULL,
  status         TEXT NOT NULL CHECK(status IN ('active', 'superseded', 'retracted')),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX idx_resident_profile_active_scope
  ON resident_profile_records(scope_kind, scope_id, subject, profile_key, status, updated_at DESC);

CREATE INDEX idx_resident_profile_valid_until
  ON resident_profile_records(status, valid_until);
