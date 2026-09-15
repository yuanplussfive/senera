DROP INDEX IF EXISTS idx_agent_goals_wake_claim;
DROP TABLE IF EXISTS agent_goal_evidence;

ALTER TABLE agent_goals DROP COLUMN contract_json;
ALTER TABLE agent_goals DROP COLUMN gates_json;
ALTER TABLE agent_goals DROP COLUMN turn_budget;
ALTER TABLE agent_goals DROP COLUMN turns_used;
ALTER TABLE agent_goals DROP COLUMN last_verdict;
ALTER TABLE agent_goals DROP COLUMN last_reason;
ALTER TABLE agent_goals DROP COLUMN paused_reason;
ALTER TABLE agent_goals DROP COLUMN consecutive_judge_failures;
ALTER TABLE agent_goals DROP COLUMN wait_barrier_json;
ALTER TABLE agent_goals DROP COLUMN continuation_context_json;
ALTER TABLE agent_goals DROP COLUMN wake_claim_id;
ALTER TABLE agent_goals DROP COLUMN wake_claim_until;
ALTER TABLE agent_goals DROP COLUMN wake_request_id;
ALTER TABLE agent_goals DROP COLUMN wake_failures;
ALTER TABLE agent_goals DROP COLUMN wake_last_error;
