ALTER TABLE child_runs
  ADD COLUMN work_item_id TEXT;

ALTER TABLE child_runs
  ADD COLUMN task_digest TEXT;

ALTER TABLE child_runs
  ADD COLUMN result_consumed_at TEXT;

ALTER TABLE child_runs
  ADD COLUMN parent_wake_consumed INTEGER NOT NULL DEFAULT 0
  CHECK (parent_wake_consumed IN (0, 1));

UPDATE child_runs
SET work_item_id = 'node:' || owner_run_id || ':' || node_id
WHERE work_item_id IS NULL;

UPDATE child_runs
SET task_digest = 'legacy:' || launch_contract_digest
WHERE task_digest IS NULL;

CREATE UNIQUE INDEX child_runs_parent_work_item_idx
  ON child_runs (parent_session_id, work_item_id);

CREATE INDEX child_runs_task_digest_idx
  ON child_runs (parent_session_id, task_digest, created_at DESC);
