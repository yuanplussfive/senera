ALTER TABLE continuity_rules ADD COLUMN fingerprint TEXT NOT NULL DEFAULT '';

UPDATE continuity_rules
SET fingerprint = uri
WHERE fingerprint = '';

CREATE UNIQUE INDEX idx_continuity_rules_scope_fingerprint
  ON continuity_rules(scope_kind, scope_id, fingerprint);

CREATE TABLE continuity_migrations (
  name TEXT PRIMARY KEY,
  completed_at TEXT NOT NULL
);
