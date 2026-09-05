ALTER TABLE scheduled_tasks ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'at_due_time'
  CHECK (execution_mode IN ('at_due_time', 'execute_now_deliver_at'));

ALTER TABLE scheduled_task_runs ADD COLUMN deliver_at TEXT;

UPDATE scheduled_task_runs
SET deliver_at = scheduled_for
WHERE deliver_at IS NULL;

DROP INDEX IF EXISTS scheduled_task_runs_delivery_idx;

CREATE INDEX scheduled_task_runs_delivery_idx
  ON scheduled_task_runs (execution_status, delivery_status, deliver_at, delivery_claim_until, completed_at);
