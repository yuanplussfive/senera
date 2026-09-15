CREATE TABLE agent_goal_evidence (
  id TEXT PRIMARY KEY,
  uri TEXT NOT NULL UNIQUE,
  goal_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('tool', 'artifact', 'execution', 'gate')),
  source_uri TEXT NOT NULL,
  label TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  UNIQUE(goal_id, source_uri),
  FOREIGN KEY(goal_id) REFERENCES agent_goals(id) ON DELETE CASCADE
);

CREATE INDEX idx_agent_goal_evidence_goal_time
  ON agent_goal_evidence(goal_id, observed_at, id);

CREATE INDEX idx_agent_goal_evidence_request
  ON agent_goal_evidence(session_id, request_id, observed_at);
