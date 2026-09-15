CREATE TABLE continuity_signal_evidence (
  scope_kind TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  signal_key TEXT NOT NULL,
  evidence_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK(value_type IN ('boolean', 'number', 'string', 'json')),
  authority TEXT NOT NULL CHECK(authority IN ('user_explicit', 'tool_verified', 'system_observed', 'model_inferred')),
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  observed_at TEXT NOT NULL,
  expires_at TEXT,
  source_refs_json TEXT NOT NULL,
  PRIMARY KEY(scope_kind, scope_id, namespace, signal_key, evidence_key)
);

INSERT INTO continuity_signal_evidence (
  scope_kind, scope_id, namespace, signal_key, evidence_key, value_json, value_type,
  authority, confidence, observed_at, expires_at, source_refs_json
)
SELECT
  signal.scope_kind,
  signal.scope_id,
  signal.namespace,
  signal.signal_key,
  COALESCE(source.episode_uri, reference.value),
  signal.value_json,
  signal.value_type,
  signal.authority,
  signal.confidence,
  signal.observed_at,
  signal.expires_at,
  json_group_array(DISTINCT reference.value)
FROM continuity_signals AS signal
JOIN json_each(signal.source_refs_json) AS reference
LEFT JOIN memory_sources AS source ON source.uri = reference.value
WHERE reference.type = 'text' AND trim(reference.value) <> ''
GROUP BY
  signal.scope_kind,
  signal.scope_id,
  signal.namespace,
  signal.signal_key,
  COALESCE(source.episode_uri, reference.value);

CREATE INDEX idx_continuity_signal_evidence_identity
  ON continuity_signal_evidence(scope_kind, scope_id, namespace, signal_key, observed_at);

CREATE INDEX idx_continuity_signal_evidence_expiry
  ON continuity_signal_evidence(expires_at);
