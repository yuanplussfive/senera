CREATE TABLE agent_job_notifications (
  job_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  state TEXT NOT NULL CHECK (state IN ('pending', 'admitted', 'observed')),
  wake INTEGER CHECK (wake IN (0, 1))
);
CREATE INDEX agent_job_notifications_pending ON agent_job_notifications(state, session_id);
CREATE TABLE agent_job_observations (
  job_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  acknowledges INTEGER NOT NULL CHECK (acknowledges IN (0, 1)),
  PRIMARY KEY(session_id, request_id, tool_call_id)
);
CREATE INDEX agent_job_observations_job ON agent_job_observations(job_id);
CREATE TABLE agent_job_wake_budgets (
  session_id TEXT PRIMARY KEY,
  consecutive INTEGER NOT NULL CHECK (consecutive >= 0),
  last_human_request TEXT,
  last_wake_request TEXT
);
