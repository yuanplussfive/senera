-- Profile history and maturity complete the resident profile evidence ledger.

ALTER TABLE resident_profile_records ADD COLUMN maturity TEXT NOT NULL DEFAULT 'active'
  CHECK(maturity IN ('candidate', 'active', 'established'));

CREATE TABLE resident_profile_history (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('created', 'reinforced', 'superseded', 'retracted')),
  source_refs_json TEXT NOT NULL,
  authority TEXT NOT NULL CHECK(authority IN ('user_explicit', 'tool_verified', 'system_observed', 'model_inferred')),
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY(profile_id) REFERENCES resident_profile_records(id) ON DELETE CASCADE
);

CREATE INDEX idx_resident_profile_history_profile_time
  ON resident_profile_history(profile_id, occurred_at DESC, id ASC);

INSERT INTO resident_profile_history (
  id, profile_id, operation, source_refs_json, authority, confidence, occurred_at
)
SELECT 'legacy_' || id, id, 'created', source_refs_json, authority, confidence, created_at
FROM resident_profile_records
WHERE json_array_length(source_refs_json) > 0;
