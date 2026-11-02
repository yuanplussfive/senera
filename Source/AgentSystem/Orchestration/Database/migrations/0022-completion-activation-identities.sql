ALTER TABLE child_run_completion_deliveries RENAME TO child_run_completion_deliveries_previous;
DROP INDEX child_run_completion_deliveries_due_idx;
DROP INDEX child_run_completion_deliveries_run_idx;

CREATE TABLE child_run_completion_deliveries (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  child_run_id TEXT NOT NULL REFERENCES child_runs(id) ON DELETE CASCADE,
  child_request_id TEXT NOT NULL,
  record_json TEXT CHECK (record_json IS NULL OR json_valid(record_json)),
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
  UNIQUE (child_run_id, child_request_id, port_id)
);

INSERT INTO child_run_completion_deliveries
  (id, child_run_id, child_request_id, record_json, port_id, delivery_status, attempt,
   available_at, claim_id, claim_until, last_error, created_at, updated_at, delivered_at)
SELECT d.id, d.child_run_id, r.child_request_id, NULL, d.port_id, d.delivery_status, d.attempt,
  d.available_at, d.claim_id, d.claim_until, d.last_error, d.created_at, d.updated_at, d.delivered_at
FROM child_run_completion_deliveries_previous d JOIN child_runs r ON r.id = d.child_run_id;

DROP TABLE child_run_completion_deliveries_previous;
CREATE INDEX child_run_completion_deliveries_due_idx
  ON child_run_completion_deliveries (port_id, delivery_status, available_at, claim_until, created_at);
CREATE INDEX child_run_completion_deliveries_run_idx
  ON child_run_completion_deliveries (child_run_id, child_request_id, port_id);
