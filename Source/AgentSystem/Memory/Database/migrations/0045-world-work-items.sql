CREATE TABLE agent_world_work_items (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN (
    'pending', 'leased', 'running', 'acknowledged', 'failed',
    'unknown', 'cancelled', 'reconciliation_required'
  )),
  lease_owner TEXT,
  lease_generation INTEGER NOT NULL DEFAULT 0 CHECK(lease_generation >= 0),
  lease_until TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  next_attempt_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  result_json TEXT,
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(world_id) REFERENCES agent_agenda_worlds(id) ON DELETE CASCADE,
  UNIQUE(world_id, source_id, candidate_id),
  CHECK((status IN ('leased', 'running') AND lease_owner IS NOT NULL AND lease_until IS NOT NULL) OR
        (status NOT IN ('leased', 'running') AND lease_owner IS NULL AND lease_until IS NULL)),
  CHECK((status IN ('acknowledged', 'unknown', 'cancelled', 'reconciliation_required') AND completed_at IS NOT NULL) OR
        (status NOT IN ('acknowledged', 'unknown', 'cancelled', 'reconciliation_required')))
) STRICT;

CREATE INDEX idx_agent_world_work_items_due
  ON agent_world_work_items(world_id, status, next_attempt_at, created_at, id);

CREATE INDEX idx_agent_world_work_items_lease
  ON agent_world_work_items(status, lease_until, updated_at);

CREATE INDEX idx_agent_world_work_items_source
  ON agent_world_work_items(world_id, source_id, status, updated_at);
