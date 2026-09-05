ALTER TABLE continuity_rules ADD COLUMN semantic_key TEXT NOT NULL DEFAULT '';
ALTER TABLE continuity_rules ADD COLUMN condition_key TEXT NOT NULL DEFAULT '';
ALTER TABLE continuity_rules ADD COLUMN effect_key TEXT NOT NULL DEFAULT '';
ALTER TABLE continuity_rules ADD COLUMN support_count INTEGER NOT NULL DEFAULT 1 CHECK(support_count >= 0);
ALTER TABLE continuity_rules ADD COLUMN support_mass REAL NOT NULL DEFAULT 0 CHECK(support_mass >= 0 AND support_mass <= 1);
ALTER TABLE continuity_rules ADD COLUMN maturity TEXT NOT NULL DEFAULT 'active'
  CHECK(maturity IN ('candidate', 'active', 'established'));
ALTER TABLE continuity_rules ADD COLUMN superseded_by TEXT;

CREATE TABLE continuity_rule_evidence (
  rule_uri TEXT NOT NULL,
  evidence_key TEXT NOT NULL,
  source_refs_json TEXT NOT NULL,
  authority TEXT NOT NULL CHECK(authority IN ('user_explicit', 'tool_verified', 'system_observed', 'model_inferred')),
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  observed_at TEXT NOT NULL,
  PRIMARY KEY (rule_uri, evidence_key),
  FOREIGN KEY (rule_uri) REFERENCES continuity_rules(uri) ON DELETE CASCADE
);

CREATE TABLE continuity_rule_history (
  id TEXT PRIMARY KEY,
  rule_uri TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('created', 'reinforced', 'revised', 'superseded')),
  source_refs_json TEXT NOT NULL,
  authority TEXT NOT NULL CHECK(authority IN ('user_explicit', 'tool_verified', 'system_observed', 'model_inferred')),
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  similarity REAL NOT NULL CHECK(similarity >= 0 AND similarity <= 1),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (rule_uri) REFERENCES continuity_rules(uri) ON DELETE CASCADE
);

CREATE INDEX idx_continuity_rules_consolidation_candidates
  ON continuity_rules(scope_kind, scope_id, condition_key, status, superseded_by);

CREATE INDEX idx_continuity_rule_history_rule_time
  ON continuity_rule_history(rule_uri, occurred_at);
