CREATE TABLE agent_job_activations (
  id TEXT PRIMARY KEY NOT NULL,
  parent_session_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json))
);
CREATE INDEX agent_job_activations_owner ON agent_job_activations(parent_session_id);
