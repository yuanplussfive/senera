CREATE TABLE memory_temporal_segment_decisions (
  episode_uri TEXT PRIMARY KEY,
  scope_key TEXT NOT NULL,
  session_id TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  completed_at_ms INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'resolved', 'failed')),
  relation TEXT CHECK(relation IS NULL OR relation IN ('start', 'continue', 'boundary')),
  confidence REAL CHECK(confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  predecessor_digest_uri TEXT,
  assigned_digest_uri TEXT,
  next_attempt_at_ms INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (episode_uri) REFERENCES memory_episodes(uri) ON DELETE CASCADE
) STRICT;

CREATE INDEX idx_memory_temporal_segment_decisions_due
  ON memory_temporal_segment_decisions(status, next_attempt_at_ms, completed_at_ms, episode_uri);
CREATE INDEX idx_memory_temporal_segment_decisions_session
  ON memory_temporal_segment_decisions(session_id, completed_at_ms, episode_uri);
