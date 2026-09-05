ALTER TABLE agent_goals ADD COLUMN contract_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE agent_goals ADD COLUMN gates_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE agent_goals ADD COLUMN turn_budget INTEGER NOT NULL DEFAULT 20;
ALTER TABLE agent_goals ADD COLUMN turns_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_goals ADD COLUMN last_verdict TEXT;
ALTER TABLE agent_goals ADD COLUMN last_reason TEXT;
ALTER TABLE agent_goals ADD COLUMN paused_reason TEXT;
ALTER TABLE agent_goals ADD COLUMN consecutive_judge_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_goals ADD COLUMN wait_barrier_json TEXT;

CREATE TABLE agent_todos (
  id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  item_order INTEGER NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(session_id, id)
);

CREATE INDEX idx_agent_todos_session_order
  ON agent_todos(session_id, item_order, id);
