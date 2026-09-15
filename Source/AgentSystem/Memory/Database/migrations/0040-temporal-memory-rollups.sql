CREATE TABLE memory_temporal_digests (
  id TEXT PRIMARY KEY,
  uri TEXT NOT NULL UNIQUE,
  scope_key TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  account_id TEXT,
  user_id TEXT,
  world_id TEXT,
  granularity TEXT NOT NULL CHECK(granularity IN ('segment', 'day', 'month')),
  digest_key TEXT NOT NULL,
  session_id TEXT NOT NULL DEFAULT '',
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  period_start_ms INTEGER NOT NULL,
  period_end_ms INTEGER NOT NULL CHECK(period_end_ms >= period_start_ms),
  time_zone TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open', 'pending', 'sealed', 'failed', 'stale')),
  summary TEXT NOT NULL DEFAULT '',
  topics_json TEXT NOT NULL DEFAULT '[]',
  open_loops_json TEXT NOT NULL DEFAULT '[]',
  source_revision TEXT NOT NULL,
  child_count INTEGER NOT NULL DEFAULT 0 CHECK(child_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(scope_key, granularity, digest_key)
) STRICT;

CREATE TABLE memory_temporal_digest_members (
  digest_id TEXT NOT NULL,
  member_uri TEXT NOT NULL,
  member_kind TEXT NOT NULL CHECK(member_kind IN ('episode', 'digest')),
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  occurred_at TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  PRIMARY KEY (digest_id, member_uri),
  FOREIGN KEY (digest_id) REFERENCES memory_temporal_digests(id) ON DELETE CASCADE
) STRICT;

CREATE TABLE memory_temporal_digest_jobs (
  digest_id TEXT PRIMARY KEY,
  next_attempt_at_ms INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  last_error TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (digest_id) REFERENCES memory_temporal_digests(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX idx_memory_temporal_digests_scope_period
  ON memory_temporal_digests(scope_key, granularity, period_start_ms, period_end_ms, status);
CREATE INDEX idx_memory_temporal_digest_members_source
  ON memory_temporal_digest_members(member_uri, digest_id);
CREATE INDEX idx_memory_temporal_digest_jobs_due
  ON memory_temporal_digest_jobs(next_attempt_at_ms, digest_id);
CREATE INDEX idx_memory_episodes_completed_range
  ON memory_episodes(completed_at_ms, session_id, id);
