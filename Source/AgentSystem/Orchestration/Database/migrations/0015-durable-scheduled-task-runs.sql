DROP INDEX IF EXISTS scheduled_task_runs_task_idx;

ALTER TABLE scheduled_task_runs RENAME TO scheduled_task_runs_legacy;

CREATE TABLE scheduled_task_runs (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  task_id TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
  scheduled_for TEXT NOT NULL,
  execution_status TEXT NOT NULL CHECK (execution_status IN ('queued', 'claimed', 'running', 'succeeded', 'failed')),
  delivery_status TEXT NOT NULL CHECK (delivery_status IN ('pending', 'delivered', 'not_required')),
  execution_session_id TEXT NOT NULL CHECK (length(trim(execution_session_id)) > 0),
  claim_id TEXT,
  claim_until TEXT,
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  result TEXT,
  error TEXT,
  delivery_claim_id TEXT,
  delivery_claim_until TEXT,
  delivery_attempt INTEGER NOT NULL DEFAULT 0 CHECK (delivery_attempt >= 0),
  delivery_error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  delivered_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (task_id, scheduled_for)
);

INSERT INTO scheduled_task_runs (
  id, task_id, scheduled_for, execution_status, delivery_status, execution_session_id,
  attempt, result, error, created_at, started_at, completed_at, delivered_at, updated_at
)
SELECT
  legacy.id,
  legacy.task_id,
  legacy.created_at,
  CASE legacy.status
    WHEN 'running' THEN 'queued'
    WHEN 'error' THEN 'failed'
    WHEN 'success' THEN 'succeeded'
    ELSE 'succeeded'
  END,
  CASE legacy.status
    WHEN 'running' THEN 'pending'
    ELSE 'not_required'
  END,
  COALESCE(legacy.session_id, 'legacy:' || legacy.id),
  CASE WHEN legacy.status IN ('running', 'success', 'error') THEN 1 ELSE 0 END,
  CASE WHEN legacy.status = 'success' THEN legacy.message ELSE NULL END,
  CASE WHEN legacy.status = 'error' THEN legacy.message ELSE NULL END,
  legacy.created_at,
  CASE WHEN legacy.status = 'running' THEN NULL ELSE legacy.created_at END,
  CASE WHEN legacy.status IN ('success', 'error') THEN legacy.updated_at ELSE NULL END,
  NULL,
  legacy.updated_at
FROM scheduled_task_runs_legacy AS legacy;

DROP TABLE scheduled_task_runs_legacy;

DROP TABLE scheduler_leases;

CREATE INDEX scheduled_task_runs_task_idx
  ON scheduled_task_runs (task_id, created_at DESC);

CREATE INDEX scheduled_task_runs_claim_idx
  ON scheduled_task_runs (execution_status, claim_until, scheduled_for);

CREATE INDEX scheduled_task_runs_delivery_idx
  ON scheduled_task_runs (execution_status, delivery_status, delivery_claim_until, completed_at);
