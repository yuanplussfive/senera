CREATE TABLE agent_goals (
  id TEXT PRIMARY KEY,
  uri TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'paused', 'blocked', 'completed', 'cancelled')),
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(session_id, request_id)
);

CREATE TABLE agent_goal_steps (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL,
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
  UNIQUE(goal_id, node_id),
  FOREIGN KEY(goal_id) REFERENCES agent_goals(id) ON DELETE CASCADE
);

CREATE TABLE agent_goal_events (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL,
  event_kind TEXT NOT NULL,
  step_id TEXT,
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY(goal_id) REFERENCES agent_goals(id) ON DELETE CASCADE,
  FOREIGN KEY(step_id) REFERENCES agent_goal_steps(id) ON DELETE SET NULL
);

CREATE INDEX idx_agent_goals_session_status ON agent_goals(session_id, status, updated_at);
CREATE INDEX idx_agent_goal_steps_goal_status ON agent_goal_steps(goal_id, status, step_index);
CREATE INDEX idx_agent_goal_events_goal_time ON agent_goal_events(goal_id, occurred_at);
