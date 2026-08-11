CREATE TABLE child_runs_v9 (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  owner_run_id TEXT NOT NULL CHECK (length(trim(owner_run_id)) > 0),
  node_id TEXT NOT NULL CHECK (length(trim(node_id)) > 0),
  parent_session_id TEXT NOT NULL CHECK (length(trim(parent_session_id)) > 0),
  parent_request_id TEXT NOT NULL CHECK (length(trim(parent_request_id)) > 0),
  child_session_id TEXT NOT NULL UNIQUE CHECK (length(trim(child_session_id)) > 0),
  child_request_id TEXT NOT NULL UNIQUE CHECK (length(trim(child_request_id)) > 0),
  agent_name TEXT NOT NULL CHECK (length(trim(agent_name)) > 0),
  task TEXT NOT NULL CHECK (length(trim(task)) > 0),
  context_mode TEXT NOT NULL CHECK (context_mode IN ('fresh', 'fork')),
  approval_mode TEXT NOT NULL CHECK (approval_mode IN ('always_ask', 'agent', 'full_access')),
  model_provider_id TEXT,
  status TEXT NOT NULL CHECK (
    status IN (
      'queued', 'running', 'wrapping_up', 'cancelling', 'awaiting_supervisor',
      'completed', 'partial_completed', 'interrupted', 'timed_out', 'failed', 'cancelled'
    )
  ),
  launch_contract_digest TEXT NOT NULL CHECK (length(trim(launch_contract_digest)) > 0),
  launch_contract_json TEXT NOT NULL CHECK (json_valid(launch_contract_json)),
  allowed_tool_names_json TEXT NOT NULL CHECK (json_valid(allowed_tool_names_json)),
  snapshot_json TEXT CHECK (snapshot_json IS NULL OR json_valid(snapshot_json)),
  checkpoint_json TEXT CHECK (checkpoint_json IS NULL OR json_valid(checkpoint_json)),
  final_answer TEXT,
  usage_json TEXT CHECK (usage_json IS NULL OR json_valid(usage_json)),
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  model_selection_source TEXT CHECK (
    model_selection_source IS NULL OR
    model_selection_source IN ('request', 'extension_default', 'role', 'parent', 'runtime_default')
  ),
  selected_skills_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(selected_skills_json)),
  configuration_revision INTEGER CHECK (configuration_revision IS NULL OR configuration_revision >= 0),
  execution_contract_json TEXT NOT NULL CHECK (json_valid(execution_contract_json)),
  UNIQUE (owner_run_id, node_id)
);

CREATE TABLE child_run_messages_v9 (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE CHECK (length(trim(id)) > 0),
  child_run_id TEXT NOT NULL REFERENCES child_runs_v9(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('child_to_parent', 'parent_to_child')),
  kind TEXT NOT NULL CHECK (kind IN ('decision', 'progress', 'response', 'steering')),
  content TEXT NOT NULL CHECK (length(trim(content)) > 0),
  created_at TEXT NOT NULL
);

INSERT INTO child_runs_v9 (
  id, owner_run_id, node_id, parent_session_id, parent_request_id, child_session_id, child_request_id,
  agent_name, task, context_mode, approval_mode, model_provider_id, status,
  launch_contract_digest, launch_contract_json, allowed_tool_names_json,
  snapshot_json, checkpoint_json, final_answer, usage_json, error,
  created_at, started_at, completed_at, updated_at, revision,
  model_selection_source, selected_skills_json, configuration_revision, execution_contract_json
)
SELECT
  id, parent_request_id, id, parent_session_id, parent_request_id, child_session_id, child_request_id,
  agent_name, task, context_mode, approval_mode, model_provider_id, status,
  launch_contract_digest, launch_contract_json, allowed_tool_names_json,
  snapshot_json, checkpoint_json, final_answer, usage_json, error,
  created_at, started_at, completed_at, updated_at, revision,
  model_selection_source, selected_skills_json, configuration_revision, execution_contract_json
FROM child_runs;

INSERT INTO child_run_messages_v9 (sequence, id, child_run_id, direction, kind, content, created_at)
SELECT sequence, id, child_run_id, direction, kind, content, created_at
FROM child_run_messages
ORDER BY sequence;

DROP TABLE child_run_messages;
DROP TABLE child_runs;
ALTER TABLE child_runs_v9 RENAME TO child_runs;
ALTER TABLE child_run_messages_v9 RENAME TO child_run_messages;

CREATE INDEX child_runs_owner_node_idx
  ON child_runs (owner_run_id, node_id);

CREATE INDEX child_runs_parent_idx
  ON child_runs (parent_session_id, parent_request_id, created_at DESC);

CREATE INDEX child_runs_status_idx
  ON child_runs (status, updated_at);

CREATE INDEX child_run_messages_run_idx
  ON child_run_messages (child_run_id, sequence);
