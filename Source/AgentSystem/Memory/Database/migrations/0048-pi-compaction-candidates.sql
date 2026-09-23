-- Derived Pi compaction checkpoints. These rows are never a source of truth:
-- the Pi JSONL branch, Artifacts, and continuity ledger remain recoverable
-- without them. They only let a restarted runtime reuse a fully validated
-- background checkpoint before a formal Pi compaction is appended.

CREATE TABLE pi_compaction_candidates (
  candidate_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  branch_epoch TEXT,
  snapshot_leaf_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  candidate_json TEXT NOT NULL
);

CREATE INDEX idx_pi_compaction_candidates_session_created
  ON pi_compaction_candidates (session_id, created_at DESC, candidate_id DESC);

CREATE INDEX idx_pi_compaction_candidates_epoch
  ON pi_compaction_candidates (session_id, branch_epoch, created_at DESC);
