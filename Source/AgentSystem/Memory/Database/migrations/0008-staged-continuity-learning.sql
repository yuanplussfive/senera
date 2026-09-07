ALTER TABLE continuity_learning_jobs RENAME TO continuity_learning_jobs_legacy;

CREATE TABLE continuity_learning_jobs (
  episode_uri TEXT PRIMARY KEY,
  fact_status TEXT NOT NULL CHECK(fact_status IN ('pending', 'running', 'retry', 'completed', 'failed')),
  fact_attempts INTEGER NOT NULL,
  fact_next_attempt_at_ms INTEGER NOT NULL,
  fact_last_error TEXT NOT NULL,
  facts_json TEXT NOT NULL,
  needs_rule_pass INTEGER NOT NULL CHECK(needs_rule_pass IN (0, 1)),
  rule_status TEXT NOT NULL CHECK(rule_status IN ('skipped', 'pending', 'running', 'retry', 'completed', 'failed')),
  rule_attempts INTEGER NOT NULL,
  rule_next_attempt_at_ms INTEGER NOT NULL,
  rule_last_error TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY(episode_uri) REFERENCES memory_episodes(uri) ON DELETE CASCADE
);

INSERT INTO continuity_learning_jobs (
  episode_uri,
  fact_status,
  fact_attempts,
  fact_next_attempt_at_ms,
  fact_last_error,
  facts_json,
  needs_rule_pass,
  rule_status,
  rule_attempts,
  rule_next_attempt_at_ms,
  rule_last_error,
  updated_at_ms
)
SELECT
  episode_uri,
  CASE
    WHEN status = 'completed' THEN 'completed'
    WHEN status = 'failed' THEN 'failed'
    ELSE 'pending'
  END,
  attempts,
  next_attempt_at_ms,
  last_error,
  '[]',
  0,
  'skipped',
  0,
  next_attempt_at_ms,
  '',
  updated_at_ms
FROM continuity_learning_jobs_legacy;

DROP TABLE continuity_learning_jobs_legacy;

CREATE INDEX idx_continuity_learning_jobs_fact_due
  ON continuity_learning_jobs(fact_status, fact_next_attempt_at_ms, updated_at_ms);
CREATE INDEX idx_continuity_learning_jobs_rule_due
  ON continuity_learning_jobs(rule_status, rule_next_attempt_at_ms, updated_at_ms);
