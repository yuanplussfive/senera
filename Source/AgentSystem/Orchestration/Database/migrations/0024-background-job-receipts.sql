CREATE TABLE agent_jobs (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  session_id TEXT NOT NULL CHECK (length(trim(session_id)) > 0),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  delivered INTEGER NOT NULL DEFAULT 0 CHECK (delivered IN (0, 1))
);
CREATE INDEX agent_jobs_session_idx ON agent_jobs(session_id);
