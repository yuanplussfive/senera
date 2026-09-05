-- Profile ledger: version lineage and independent episode evidence, matching
-- the fact head and rule consolidation semantics.
-- Structural only; legacy evidence is regrouped and re-scored by the host so
-- maturity thresholds stay in the shared consolidation policy.

ALTER TABLE resident_profile_records ADD COLUMN superseded_by TEXT;

ALTER TABLE resident_profile_records ADD COLUMN support_count INTEGER NOT NULL DEFAULT 1;

CREATE TABLE resident_profile_evidence (
  profile_id TEXT NOT NULL,
  evidence_key TEXT NOT NULL,
  source_refs_json TEXT NOT NULL,
  authority TEXT NOT NULL CHECK(authority IN ('user_explicit', 'tool_verified', 'system_observed', 'model_inferred')),
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  observed_at TEXT NOT NULL,
  PRIMARY KEY(profile_id, evidence_key),
  FOREIGN KEY(profile_id) REFERENCES resident_profile_records(id) ON DELETE CASCADE
);

CREATE INDEX idx_resident_profile_evidence_profile
  ON resident_profile_evidence(profile_id, observed_at DESC);

CREATE INDEX idx_resident_profile_records_superseded_by
  ON resident_profile_records(superseded_by);

INSERT INTO resident_profile_evidence (profile_id, evidence_key, source_refs_json, authority, confidence, observed_at)
SELECT id, 'legacy_' || id, source_refs_json, authority, confidence, updated_at
FROM resident_profile_records
WHERE json_array_length(source_refs_json) > 0;
