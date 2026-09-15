CREATE TABLE child_run_completion_deliveries (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  child_run_id TEXT NOT NULL REFERENCES child_runs(id) ON DELETE CASCADE,
  port_id TEXT NOT NULL CHECK (length(trim(port_id)) > 0),
  delivery_status TEXT NOT NULL CHECK (delivery_status IN ('pending', 'claimed', 'delivered', 'dropped')),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  available_at TEXT NOT NULL,
  claim_id TEXT,
  claim_until TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  delivered_at TEXT,
  UNIQUE (child_run_id, port_id)
);

CREATE INDEX child_run_completion_deliveries_due_idx
  ON child_run_completion_deliveries (port_id, delivery_status, available_at, claim_until, created_at);

CREATE INDEX child_run_completion_deliveries_run_idx
  ON child_run_completion_deliveries (child_run_id, port_id);
