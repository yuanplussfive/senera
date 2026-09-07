ALTER TABLE agent_goals ADD COLUMN session_id TEXT;
ALTER TABLE agent_goals ADD COLUMN request_id TEXT;
ALTER TABLE agent_goals ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual'
  CHECK(origin IN ('manual', 'automatic'));

CREATE UNIQUE INDEX idx_agent_goals_session_request
  ON agent_goals(scope_kind, scope_id, request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX idx_agent_goals_request
  ON agent_goals(session_id, request_id)
  WHERE session_id IS NOT NULL AND request_id IS NOT NULL;
