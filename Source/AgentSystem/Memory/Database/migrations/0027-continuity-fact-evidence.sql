-- Fact evidence ledger: independent episode support for each current claim version.

ALTER TABLE continuity_fact_heads ADD COLUMN support_count INTEGER NOT NULL DEFAULT 0
  CHECK (support_count >= 0);

ALTER TABLE continuity_fact_heads ADD COLUMN support_mass REAL NOT NULL DEFAULT 0
  CHECK (support_mass >= 0 AND support_mass <= 1);

ALTER TABLE continuity_fact_heads ADD COLUMN maturity TEXT NOT NULL DEFAULT 'active'
  CHECK (maturity IN ('candidate', 'active', 'established'));

ALTER TABLE continuity_fact_history ADD COLUMN superseded_by TEXT;

CREATE TABLE continuity_fact_evidence (
  scope_kind TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  claim_key TEXT NOT NULL,
  evidence_key TEXT NOT NULL,
  source_refs_json TEXT NOT NULL,
  authority TEXT NOT NULL CHECK(authority IN ('user_explicit', 'tool_verified', 'system_observed', 'model_inferred')),
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  observed_at TEXT NOT NULL,
  PRIMARY KEY(scope_kind, scope_id, fact_key, claim_key, evidence_key)
);

CREATE INDEX idx_continuity_fact_evidence_head
  ON continuity_fact_evidence(scope_kind, scope_id, fact_key, claim_key, observed_at DESC);

CREATE INDEX idx_continuity_fact_evidence_source
  ON continuity_fact_evidence(evidence_key);

INSERT INTO continuity_fact_evidence (
  scope_kind, scope_id, fact_key, claim_key, evidence_key,
  source_refs_json, authority, confidence, observed_at
)
SELECT head.scope_kind,
       head.scope_id,
       head.fact_key,
       head.normalized_claim,
       'legacy:' || COALESCE(source.episode_uri, refs.value),
       json_group_array(DISTINCT refs.value),
       head.authority,
       head.confidence,
       head.updated_at
FROM continuity_fact_heads head
JOIN json_each(head.source_refs_json) refs
LEFT JOIN memory_sources source ON source.uri = refs.value
GROUP BY head.scope_kind,
         head.scope_id,
         head.fact_key,
         head.normalized_claim,
         COALESCE(source.episode_uri, refs.value),
         head.authority,
         head.confidence,
         head.updated_at;

UPDATE continuity_fact_heads
SET support_count = (
      SELECT COUNT(*)
      FROM continuity_fact_evidence evidence
      WHERE evidence.scope_kind = continuity_fact_heads.scope_kind
        AND evidence.scope_id = continuity_fact_heads.scope_id
        AND evidence.fact_key = continuity_fact_heads.fact_key
        AND evidence.claim_key = continuity_fact_heads.normalized_claim
    );

WITH RECURSIVE ranked AS (
  SELECT evidence.scope_kind,
         evidence.scope_id,
         evidence.fact_key,
         evidence.claim_key,
         evidence.confidence,
         ROW_NUMBER() OVER (
           PARTITION BY evidence.scope_kind, evidence.scope_id, evidence.fact_key, evidence.claim_key
           ORDER BY evidence.evidence_key
         ) AS position
  FROM continuity_fact_evidence evidence
), accumulated AS (
  SELECT scope_kind, scope_id, fact_key, claim_key, position, confidence AS mass
  FROM ranked
  WHERE position = 1
  UNION ALL
  SELECT next.scope_kind,
         next.scope_id,
         next.fact_key,
         next.claim_key,
         next.position,
         1 - (1 - current.mass) * (1 - next.confidence)
  FROM accumulated current
  JOIN ranked next
    ON next.scope_kind = current.scope_kind
   AND next.scope_id = current.scope_id
   AND next.fact_key = current.fact_key
   AND next.claim_key = current.claim_key
   AND next.position = current.position + 1
)
UPDATE continuity_fact_heads
SET support_mass = COALESCE((
      SELECT mass
      FROM accumulated
      WHERE accumulated.scope_kind = continuity_fact_heads.scope_kind
        AND accumulated.scope_id = continuity_fact_heads.scope_id
        AND accumulated.fact_key = continuity_fact_heads.fact_key
        AND accumulated.claim_key = continuity_fact_heads.normalized_claim
      ORDER BY position DESC
      LIMIT 1
    ), 0);

UPDATE continuity_fact_history
SET superseded_by = (
  SELECT head.superseded_by
  FROM continuity_fact_heads head
  WHERE head.scope_kind = continuity_fact_history.scope_kind
    AND head.scope_id = continuity_fact_history.scope_id
    AND head.fact_key = continuity_fact_history.fact_key
    AND head.status = 'superseded'
)
WHERE superseded_by IS NULL;
