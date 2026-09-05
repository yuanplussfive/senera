ALTER TABLE agent_goal_events RENAME TO agent_goal_events_legacy;
ALTER TABLE agent_goal_steps RENAME TO agent_goal_steps_legacy;
ALTER TABLE agent_goals RENAME TO agent_goals_legacy;

CREATE TABLE agent_goals (
  id TEXT PRIMARY KEY,
  uri TEXT NOT NULL UNIQUE,
  scope_kind TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'paused', 'blocked', 'completed', 'cancelled')),
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE agent_execution_runs (
  id TEXT PRIMARY KEY,
  uri TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  goal_id TEXT,
  objective TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'paused', 'blocked', 'completed', 'cancelled')),
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(session_id, request_id),
  FOREIGN KEY(goal_id) REFERENCES agent_goals(id) ON DELETE SET NULL
);

CREATE TABLE agent_execution_steps (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  plan_revision INTEGER NOT NULL,
  step_index INTEGER NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('planned', 'running', 'completed', 'failed', 'blocked')),
  dependency_ids_json TEXT NOT NULL,
  call_id TEXT,
  failure TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(execution_id, node_id),
  FOREIGN KEY(execution_id) REFERENCES agent_execution_runs(id) ON DELETE CASCADE
);

CREATE TABLE agent_execution_events (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL,
  event_kind TEXT NOT NULL,
  step_id TEXT,
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY(execution_id) REFERENCES agent_execution_runs(id) ON DELETE CASCADE,
  FOREIGN KEY(step_id) REFERENCES agent_execution_steps(id) ON DELETE SET NULL
);

INSERT INTO agent_execution_runs
  (id, uri, session_id, request_id, goal_id, objective, status, reason, created_at, updated_at, completed_at)
SELECT
  id,
  'senera://execution/' || id,
  session_id,
  request_id,
  NULL,
  objective,
  status,
  reason,
  created_at,
  updated_at,
  completed_at
FROM agent_goals_legacy;

INSERT INTO agent_execution_steps
  (id, execution_id, node_id, plan_id, plan_revision, step_index, title, detail, status,
   dependency_ids_json, call_id, failure, created_at, updated_at)
SELECT
  id,
  goal_id,
  node_id,
  plan_id,
  plan_revision,
  step_index,
  title,
  detail,
  status,
  dependency_ids_json,
  call_id,
  failure,
  created_at,
  updated_at
FROM agent_goal_steps_legacy;

INSERT INTO agent_execution_events
  (id, execution_id, event_kind, step_id, session_id, request_id, payload_json, occurred_at)
SELECT
  id,
  goal_id,
  REPLACE(event_kind, 'goal.', 'execution.'),
  step_id,
  session_id,
  request_id,
  payload_json,
  occurred_at
FROM agent_goal_events_legacy;

DROP INDEX idx_agent_goal_events_goal_time;
DROP INDEX idx_agent_goal_steps_goal_status;
DROP INDEX idx_agent_goals_session_status;
DROP TABLE agent_goal_events_legacy;
DROP TABLE agent_goal_steps_legacy;
DROP TABLE agent_goals_legacy;

CREATE INDEX idx_agent_goals_scope_status
  ON agent_goals(scope_kind, scope_id, status, updated_at);
CREATE INDEX idx_agent_execution_runs_session_status
  ON agent_execution_runs(session_id, status, updated_at);
CREATE INDEX idx_agent_execution_steps_execution_status
  ON agent_execution_steps(execution_id, status, step_index);
CREATE INDEX idx_agent_execution_events_execution_time
  ON agent_execution_events(execution_id, occurred_at);
