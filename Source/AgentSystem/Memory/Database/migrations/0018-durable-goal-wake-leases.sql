ALTER TABLE agent_goals ADD COLUMN continuation_context_json TEXT;
ALTER TABLE agent_goals ADD COLUMN wake_claim_id TEXT;
ALTER TABLE agent_goals ADD COLUMN wake_claim_until TEXT;
ALTER TABLE agent_goals ADD COLUMN wake_request_id TEXT;
ALTER TABLE agent_goals ADD COLUMN wake_failures INTEGER NOT NULL DEFAULT 0 CHECK(wake_failures >= 0);
ALTER TABLE agent_goals ADD COLUMN wake_last_error TEXT;

CREATE INDEX idx_agent_goals_wake_claim
  ON agent_goals(status, wake_claim_until, updated_at)
  WHERE wait_barrier_json IS NOT NULL AND continuation_context_json IS NOT NULL;
