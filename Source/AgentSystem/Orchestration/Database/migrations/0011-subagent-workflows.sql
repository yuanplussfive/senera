CREATE TABLE agent_workflows (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  parent_session_id TEXT NOT NULL CHECK (length(trim(parent_session_id)) > 0),
  parent_request_id TEXT NOT NULL CHECK (length(trim(parent_request_id)) > 0),
  approval_mode TEXT NOT NULL CHECK (approval_mode IN ('always_ask', 'agent', 'full_access')),
  status TEXT NOT NULL CHECK (status IN (
    'queued', 'running', 'paused', 'completed', 'partial_completed', 'failed', 'cancelling', 'cancelled'
  )),
  definition_digest TEXT NOT NULL CHECK (length(trim(definition_digest)) > 0),
  definition_json TEXT NOT NULL CHECK (json_valid(definition_json)),
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
);

CREATE INDEX agent_workflows_parent_idx
  ON agent_workflows (parent_session_id, parent_request_id, created_at DESC);

CREATE INDEX agent_workflows_status_idx
  ON agent_workflows (status, updated_at);

CREATE TABLE agent_workflow_nodes (
  workflow_id TEXT NOT NULL REFERENCES agent_workflows(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL CHECK (length(trim(node_id)) > 0),
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'running', 'paused', 'completed', 'partial_completed', 'failed', 'skipped', 'cancelled'
  )),
  child_run_id TEXT REFERENCES child_runs(id) ON DELETE SET NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  PRIMARY KEY (workflow_id, node_id)
);

CREATE INDEX agent_workflow_nodes_child_run_idx
  ON agent_workflow_nodes (child_run_id);

CREATE INDEX agent_workflow_nodes_status_idx
  ON agent_workflow_nodes (workflow_id, status, updated_at);
