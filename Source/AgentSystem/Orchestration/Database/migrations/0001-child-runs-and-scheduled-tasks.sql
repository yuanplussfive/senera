CREATE TABLE child_runs (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  parent_session_id TEXT NOT NULL CHECK (length(trim(parent_session_id)) > 0),
  parent_request_id TEXT NOT NULL CHECK (length(trim(parent_request_id)) > 0),
  child_session_id TEXT NOT NULL UNIQUE CHECK (length(trim(child_session_id)) > 0),
  child_request_id TEXT NOT NULL UNIQUE CHECK (length(trim(child_request_id)) > 0),
  agent_name TEXT NOT NULL CHECK (length(trim(agent_name)) > 0),
  task TEXT NOT NULL CHECK (length(trim(task)) > 0),
  context_mode TEXT NOT NULL CHECK (context_mode IN ('fresh', 'fork')),
  approval_mode TEXT NOT NULL CHECK (approval_mode IN ('always_ask', 'agent', 'full_access')),
  model_provider_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  launch_contract_digest TEXT NOT NULL CHECK (length(trim(launch_contract_digest)) > 0),
  launch_contract_json TEXT NOT NULL CHECK (json_valid(launch_contract_json)),
  allowed_tool_names_json TEXT NOT NULL CHECK (json_valid(allowed_tool_names_json)),
  final_answer TEXT,
  usage_json TEXT CHECK (usage_json IS NULL OR json_valid(usage_json)),
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
);

CREATE INDEX child_runs_parent_idx
  ON child_runs (parent_session_id, parent_request_id, created_at DESC);

CREATE INDEX child_runs_status_idx
  ON child_runs (status, updated_at);

CREATE TABLE scheduled_tasks (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  tenant_id TEXT,
  user_id TEXT,
  workspace_id TEXT,
  session_id TEXT NOT NULL CHECK (length(trim(session_id)) > 0),
  name TEXT,
  description TEXT,
  prompt TEXT NOT NULL CHECK (length(trim(prompt)) > 0),
  task_type TEXT NOT NULL CHECK (task_type IN ('cron', 'once', 'interval')),
  schedule_expression TEXT NOT NULL CHECK (length(trim(schedule_expression)) > 0),
  interval_seconds INTEGER NOT NULL CHECK (interval_seconds >= 0),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  model_provider TEXT NOT NULL CHECK (length(trim(model_provider)) > 0),
  model_id TEXT NOT NULL CHECK (length(trim(model_id)) > 0),
  thinking_level TEXT CHECK (thinking_level IS NULL OR thinking_level IN ('off', 'minimal', 'low', 'medium', 'high', 'xhigh')),
  auth_profile_id TEXT,
  reasoning INTEGER CHECK (reasoning IS NULL OR reasoning IN (0, 1)),
  tool_policy_profile TEXT NOT NULL CHECK (length(trim(tool_policy_profile)) > 0),
  workspace_dir TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_run_at TEXT,
  next_run_at TEXT,
  run_count INTEGER NOT NULL CHECK (run_count >= 0),
  timeout_ms INTEGER CHECK (timeout_ms IS NULL OR timeout_ms > 0),
  last_status TEXT CHECK (last_status IS NULL OR last_status IN ('success', 'error', 'running')),
  last_error TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
);

CREATE INDEX scheduled_tasks_due_idx
  ON scheduled_tasks (enabled, next_run_at);

CREATE INDEX scheduled_tasks_scope_idx
  ON scheduled_tasks (tenant_id, user_id, updated_at DESC);

CREATE TABLE scheduled_task_runs (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  task_id TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('success', 'error', 'running', 'paused', 'resumed')),
  session_id TEXT,
  message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX scheduled_task_runs_task_idx
  ON scheduled_task_runs (task_id, created_at DESC);

CREATE TABLE scheduled_task_tool_policies (
  task_id TEXT PRIMARY KEY REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
  allowed_tool_names_json TEXT NOT NULL CHECK (json_valid(allowed_tool_names_json)),
  updated_at TEXT NOT NULL
);

CREATE TABLE scheduler_leases (
  name TEXT PRIMARY KEY CHECK (length(trim(name)) > 0),
  holder_id TEXT NOT NULL CHECK (length(trim(holder_id)) > 0),
  holder_pid INTEGER NOT NULL CHECK (holder_pid > 0),
  acquired_at_ms INTEGER NOT NULL CHECK (acquired_at_ms >= 0),
  lease_until_ms INTEGER NOT NULL CHECK (lease_until_ms > acquired_at_ms),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= acquired_at_ms),
  generation INTEGER NOT NULL CHECK (generation > 0)
);
