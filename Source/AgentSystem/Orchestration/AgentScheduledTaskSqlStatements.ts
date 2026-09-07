import type Database from "better-sqlite3";
import { agentSql } from "../Database/AgentSql.js";

export interface AgentScheduledTaskRow {
  readonly id: string;
  readonly tenant_id: string | null;
  readonly user_id: string | null;
  readonly workspace_id: string | null;
  readonly session_id: string;
  readonly source_request_id: string | null;
  readonly execution_mode: string;
  readonly name: string | null;
  readonly description: string | null;
  readonly prompt: string;
  readonly task_type: string;
  readonly schedule_expression: string;
  readonly interval_seconds: number;
  readonly enabled: number;
  readonly model_provider: string;
  readonly model_id: string;
  readonly thinking_level: string | null;
  readonly auth_profile_id: string | null;
  readonly reasoning: number | null;
  readonly tool_policy_profile: string;
  readonly workspace_dir: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly last_run_at: string | null;
  readonly next_run_at: string | null;
  readonly run_count: number;
  readonly timeout_ms: number | null;
  readonly last_status: string | null;
  readonly last_error: string | null;
  readonly revision: number;
}

export interface AgentScheduledTaskRunRow {
  readonly id: string;
  readonly task_id: string;
  readonly scheduled_for: string;
  readonly execution_status: string;
  readonly delivery_status: string;
  readonly execution_session_id: string;
  readonly deliver_at: string | null;
  readonly source_request_id: string | null;
  readonly claim_id: string | null;
  readonly claim_until: string | null;
  readonly attempt: number;
  readonly result: string | null;
  readonly error: string | null;
  readonly delivery_claim_id: string | null;
  readonly delivery_claim_until: string | null;
  readonly delivery_attempt: number;
  readonly delivery_error: string | null;
  readonly created_at: string;
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly delivered_at: string | null;
  readonly updated_at: string;
}

export interface AgentScheduledTaskSqlStatements {
  readonly listAll: Database.Statement<[], AgentScheduledTaskRow>;
  readonly listByTenant: Database.Statement<[string], AgentScheduledTaskRow>;
  readonly listByUser: Database.Statement<[string], AgentScheduledTaskRow>;
  readonly listByTenantAndUser: Database.Statement<[string, string], AgentScheduledTaskRow>;
  readonly select: Database.Statement<[string], AgentScheduledTaskRow>;
  readonly selectByTenant: Database.Statement<[string, string], AgentScheduledTaskRow>;
  readonly selectByUser: Database.Statement<[string, string], AgentScheduledTaskRow>;
  readonly selectByTenantAndUser: Database.Statement<[string, string, string], AgentScheduledTaskRow>;
  readonly insert: Database.Statement;
  readonly update: Database.Statement;
  readonly delete: Database.Statement<[string]>;
  readonly deleteByTenant: Database.Statement<[string, string]>;
  readonly deleteByUser: Database.Statement<[string, string]>;
  readonly deleteByTenantAndUser: Database.Statement<[string, string, string]>;
  readonly upsertRun: Database.Statement;
  readonly insertRun: Database.Statement;
  readonly selectRun: Database.Statement<[string], AgentScheduledTaskRunRow>;
  readonly listRunsForTask: Database.Statement<[string], AgentScheduledTaskRunRow>;
  readonly listRuns: Database.Statement<[], AgentScheduledTaskRunRow>;
  readonly selectClaimableRunIds: Database.Statement<[string, number], { id: string }>;
  readonly claimExistingRun: Database.Statement;
  readonly assignRunSourceRequestId: Database.Statement;
  readonly selectDueTaskIds: Database.Statement<[string, number], { id: string }>;
  readonly advanceDueTask: Database.Statement;
  readonly markRunRunning: Database.Statement;
  readonly markTaskRunning: Database.Statement;
  readonly renewRunClaim: Database.Statement;
  readonly releaseExecutionClaim: Database.Statement;
  readonly clearTaskRunningStatus: Database.Statement;
  readonly completeRun: Database.Statement;
  readonly completeTaskSuccess: Database.Statement;
  readonly completeTaskFailure: Database.Statement;
  readonly selectClaimableDeliveryIds: Database.Statement<[string, string, number], { id: string }>;
  readonly countPendingDeliveries: Database.Statement<[], { count: number }>;
  readonly claimDelivery: Database.Statement;
  readonly markDelivered: Database.Statement;
  readonly releaseDelivery: Database.Statement;
  readonly settleDeferredDeliveryTask: Database.Statement;
  readonly rescheduleDeferredDeliveries: Database.Statement;
  readonly cancelDeferredDeliveries: Database.Statement;
  readonly hasOutstandingRun: Database.Statement<[string], { has_outstanding_run: number }>;
  readonly upsertToolPolicy: Database.Statement;
  readonly selectToolPolicy: Database.Statement<[string], { allowed_tool_names_json: string }>;
}

const TaskColumns = agentSql`id, tenant_id, user_id, workspace_id, session_id, source_request_id, execution_mode, name, description, prompt,
  task_type, schedule_expression, interval_seconds, enabled, model_provider, model_id, thinking_level,
  auth_profile_id, reasoning, tool_policy_profile, workspace_dir, created_at, updated_at, last_run_at,
  next_run_at, run_count, timeout_ms, last_status, last_error, revision`;

const RunColumns = agentSql`id, task_id, scheduled_for, execution_status, delivery_status, execution_session_id, deliver_at, source_request_id,
  claim_id, claim_until, attempt, result, error, delivery_claim_id, delivery_claim_until, delivery_attempt,
  delivery_error, created_at, started_at, completed_at, delivered_at, updated_at`;

export function prepareAgentScheduledTaskSqlStatements(database: Database.Database): AgentScheduledTaskSqlStatements {
  return {
    listAll: database.prepare(`SELECT ${TaskColumns} FROM scheduled_tasks ORDER BY created_at, id`),
    listByTenant: database.prepare(
      `SELECT ${TaskColumns} FROM scheduled_tasks WHERE tenant_id = ? ORDER BY created_at, id`,
    ),
    listByUser: database.prepare(
      `SELECT ${TaskColumns} FROM scheduled_tasks WHERE user_id = ? ORDER BY created_at, id`,
    ),
    listByTenantAndUser: database.prepare(
      `SELECT ${TaskColumns} FROM scheduled_tasks WHERE tenant_id = ? AND user_id = ? ORDER BY created_at, id`,
    ),
    select: database.prepare(`SELECT ${TaskColumns} FROM scheduled_tasks WHERE id = ?`),
    selectByTenant: database.prepare(`SELECT ${TaskColumns} FROM scheduled_tasks WHERE id = ? AND tenant_id = ?`),
    selectByUser: database.prepare(`SELECT ${TaskColumns} FROM scheduled_tasks WHERE id = ? AND user_id = ?`),
    selectByTenantAndUser: database.prepare(
      `SELECT ${TaskColumns} FROM scheduled_tasks WHERE id = ? AND tenant_id = ? AND user_id = ?`,
    ),
    insert: database.prepare(agentSql`INSERT INTO scheduled_tasks (
      id, tenant_id, user_id, workspace_id, session_id, source_request_id, execution_mode, name, description, prompt, task_type,
      schedule_expression, interval_seconds, enabled, model_provider, model_id, thinking_level,
      auth_profile_id, reasoning, tool_policy_profile, workspace_dir, created_at, updated_at,
      last_run_at, next_run_at, run_count, timeout_ms, last_status, last_error
    ) VALUES (
      @id, @tenant_id, @user_id, @workspace_id, @session_id, @source_request_id, @execution_mode, @name, @description, @prompt, @task_type,
      @schedule_expression, @interval_seconds, @enabled, @model_provider, @model_id, @thinking_level,
      @auth_profile_id, @reasoning, @tool_policy_profile, @workspace_dir, @created_at, @updated_at,
      @last_run_at, @next_run_at, @run_count, @timeout_ms, @last_status, @last_error
    )`),
    update: database.prepare(agentSql`UPDATE scheduled_tasks SET
      tenant_id = @tenant_id, user_id = @user_id, workspace_id = @workspace_id, session_id = @session_id,
      source_request_id = @source_request_id, execution_mode = @execution_mode, name = @name, description = @description, prompt = @prompt,
      task_type = @task_type,
      schedule_expression = @schedule_expression, interval_seconds = @interval_seconds, enabled = @enabled,
      model_provider = @model_provider, model_id = @model_id, thinking_level = @thinking_level,
      auth_profile_id = @auth_profile_id, reasoning = @reasoning, tool_policy_profile = @tool_policy_profile,
      workspace_dir = @workspace_dir, updated_at = @updated_at, last_run_at = @last_run_at,
      next_run_at = @next_run_at, run_count = @run_count, timeout_ms = @timeout_ms,
      last_status = @last_status, last_error = @last_error, revision = revision + 1 WHERE id = @id`),
    delete: database.prepare(agentSql`DELETE FROM scheduled_tasks WHERE id = ?`),
    deleteByTenant: database.prepare(agentSql`DELETE FROM scheduled_tasks WHERE id = ? AND tenant_id = ?`),
    deleteByUser: database.prepare(agentSql`DELETE FROM scheduled_tasks WHERE id = ? AND user_id = ?`),
    deleteByTenantAndUser: database.prepare(
      agentSql`DELETE FROM scheduled_tasks WHERE id = ? AND tenant_id = ? AND user_id = ?`,
    ),
    upsertRun: database.prepare(agentSql`INSERT INTO scheduled_task_runs (
      id, task_id, scheduled_for, execution_status, delivery_status, execution_session_id, deliver_at, source_request_id, claim_id,
      claim_until, attempt, result, error, delivery_claim_id, delivery_claim_until, delivery_attempt,
      delivery_error, created_at, started_at, completed_at, delivered_at, updated_at
    ) VALUES (
      @id, @task_id, @scheduled_for, @execution_status, @delivery_status, @execution_session_id, @deliver_at, @source_request_id, @claim_id,
      @claim_until, @attempt, @result, @error, @delivery_claim_id, @delivery_claim_until, @delivery_attempt,
      @delivery_error, @created_at, @started_at, @completed_at, @delivered_at, @updated_at
    ) ON CONFLICT (id) DO UPDATE SET
      execution_status = excluded.execution_status, result = excluded.result, error = excluded.error,
      completed_at = excluded.completed_at, updated_at = excluded.updated_at`),
    insertRun: database.prepare(agentSql`INSERT INTO scheduled_task_runs (
      id, task_id, scheduled_for, execution_status, delivery_status, execution_session_id, deliver_at, source_request_id, claim_id,
      claim_until, attempt, result, error, delivery_claim_id, delivery_claim_until, delivery_attempt,
      delivery_error, created_at, started_at, completed_at, delivered_at, updated_at
    ) VALUES (
      @id, @task_id, @scheduled_for, @execution_status, @delivery_status, @execution_session_id, @deliver_at, @source_request_id, @claim_id,
      @claim_until, @attempt, @result, @error, @delivery_claim_id, @delivery_claim_until, @delivery_attempt,
      @delivery_error, @created_at, @started_at, @completed_at, @delivered_at, @updated_at
    )`),
    selectRun: database.prepare(`SELECT ${RunColumns} FROM scheduled_task_runs WHERE id = ?`),
    listRunsForTask: database.prepare(
      `SELECT ${RunColumns} FROM scheduled_task_runs WHERE task_id = ? ORDER BY created_at, id`,
    ),
    listRuns: database.prepare(`SELECT ${RunColumns} FROM scheduled_task_runs ORDER BY task_id, created_at, id`),
    selectClaimableRunIds: database.prepare(agentSql`SELECT id FROM scheduled_task_runs
      WHERE execution_status = 'queued' OR (execution_status IN ('claimed', 'running') AND claim_until <= ?)
      ORDER BY CASE execution_status WHEN 'queued' THEN 0 ELSE 1 END, scheduled_for, created_at, id LIMIT ?`),
    claimExistingRun: database.prepare(agentSql`UPDATE scheduled_task_runs SET
      execution_status = 'claimed', execution_session_id = @execution_session_id, claim_id = @claim_id,
      claim_until = @claim_until, attempt = attempt + 1, started_at = NULL, updated_at = @updated_at
      WHERE id = @id AND (execution_status = 'queued' OR (execution_status IN ('claimed', 'running') AND claim_until <= @now))`),
    assignRunSourceRequestId: database.prepare(agentSql`UPDATE scheduled_task_runs
      SET source_request_id = @source_request_id, updated_at = @updated_at
      WHERE id = @id AND claim_id = @claim_id AND source_request_id IS NULL
        AND execution_status IN ('claimed', 'running')`),
    selectDueTaskIds: database.prepare(agentSql`SELECT id FROM scheduled_tasks
      WHERE enabled = 1 AND execution_mode = 'at_due_time' AND next_run_at IS NOT NULL AND next_run_at <= ?
        AND NOT EXISTS (
          SELECT 1 FROM scheduled_task_runs active_run
          WHERE active_run.task_id = scheduled_tasks.id
            AND active_run.execution_status IN ('queued', 'claimed', 'running')
        )
      ORDER BY next_run_at, id LIMIT ?`),
    advanceDueTask: database.prepare(agentSql`UPDATE scheduled_tasks SET enabled = @enabled, next_run_at = @next_run_at,
      updated_at = @updated_at, revision = revision + 1
      WHERE id = @id AND enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= @now`),
    markRunRunning: database.prepare(agentSql`UPDATE scheduled_task_runs SET execution_status = 'running',
      claim_until = @claim_until, started_at = COALESCE(started_at, @updated_at), updated_at = @updated_at
      WHERE id = @id AND claim_id = @claim_id AND execution_status = 'claimed'`),
    markTaskRunning: database.prepare(agentSql`UPDATE scheduled_tasks SET last_status = 'running', last_error = NULL,
      updated_at = @updated_at, revision = revision + 1 WHERE id = @task_id`),
    renewRunClaim:
      database.prepare(agentSql`UPDATE scheduled_task_runs SET claim_until = @claim_until, updated_at = @updated_at
      WHERE id = @id AND claim_id = @claim_id AND execution_status IN ('claimed', 'running')`),
    releaseExecutionClaim: database.prepare(agentSql`UPDATE scheduled_task_runs SET execution_status = 'queued',
      claim_id = NULL, claim_until = NULL, started_at = NULL, updated_at = @updated_at
      WHERE id = @id AND claim_id = @claim_id AND execution_status IN ('claimed', 'running')`),
    clearTaskRunningStatus: database.prepare(agentSql`UPDATE scheduled_tasks SET last_status = NULL, last_error = NULL,
      updated_at = @updated_at, revision = revision + 1
      WHERE id = @task_id AND last_status = 'running'`),
    completeRun: database.prepare(agentSql`UPDATE scheduled_task_runs SET execution_status = @execution_status,
      delivery_status = @delivery_status, claim_id = NULL, claim_until = NULL, result = @result, error = @error,
      completed_at = @completed_at, updated_at = @updated_at
      WHERE id = @id AND claim_id = @claim_id AND execution_status IN ('claimed', 'running')`),
    completeTaskSuccess: database.prepare(agentSql`UPDATE scheduled_tasks SET last_run_at = @completed_at,
      last_status = 'success', last_error = NULL, run_count = run_count + 1, updated_at = @updated_at,
      revision = revision + 1 WHERE id = @task_id`),
    completeTaskFailure:
      database.prepare(agentSql`UPDATE scheduled_tasks SET last_status = 'error', last_error = @error,
      updated_at = @updated_at, revision = revision + 1 WHERE id = @task_id`),
    selectClaimableDeliveryIds: database.prepare(agentSql`SELECT id FROM scheduled_task_runs
      WHERE execution_status IN ('succeeded', 'failed') AND delivery_status = 'pending' AND deliver_at <= ?
        AND (delivery_claim_until IS NULL OR delivery_claim_until <= ?) ORDER BY deliver_at, completed_at, id LIMIT ?`),
    countPendingDeliveries: database.prepare(agentSql`SELECT COUNT(*) AS count FROM scheduled_task_runs
      WHERE execution_status IN ('succeeded', 'failed') AND delivery_status = 'pending'`),
    claimDelivery: database.prepare(agentSql`UPDATE scheduled_task_runs SET delivery_claim_id = @delivery_claim_id,
      delivery_claim_until = @delivery_claim_until, delivery_attempt = delivery_attempt + 1, delivery_error = NULL,
      updated_at = @updated_at WHERE id = @id AND execution_status IN ('succeeded', 'failed') AND delivery_status = 'pending'
        AND (delivery_claim_until IS NULL OR delivery_claim_until <= @now)`),
    markDelivered: database.prepare(agentSql`UPDATE scheduled_task_runs SET delivery_status = 'delivered',
      delivery_claim_id = NULL, delivery_claim_until = NULL, delivery_error = NULL, delivered_at = @delivered_at,
      updated_at = @updated_at WHERE id = @id AND delivery_claim_id = @delivery_claim_id AND delivery_status = 'pending'`),
    releaseDelivery: database.prepare(agentSql`UPDATE scheduled_task_runs SET delivery_claim_id = NULL,
      delivery_claim_until = NULL, delivery_error = @delivery_error, updated_at = @updated_at
      WHERE id = @id AND delivery_claim_id = @delivery_claim_id AND delivery_status = 'pending'`),
    settleDeferredDeliveryTask: database.prepare(agentSql`UPDATE scheduled_tasks SET enabled = 0, next_run_at = NULL,
      updated_at = @updated_at, revision = revision + 1
      WHERE id = @task_id AND execution_mode = 'execute_now_deliver_at'`),
    rescheduleDeferredDeliveries: database.prepare(agentSql`UPDATE scheduled_task_runs SET deliver_at = @deliver_at,
      delivery_claim_id = NULL, delivery_claim_until = NULL, delivery_error = NULL, updated_at = @updated_at
      WHERE task_id = @task_id AND delivery_status = 'pending'`),
    cancelDeferredDeliveries: database.prepare(agentSql`UPDATE scheduled_task_runs SET delivery_status = 'not_required',
      delivery_claim_id = NULL, delivery_claim_until = NULL, delivery_error = NULL, updated_at = @updated_at
      WHERE task_id = @task_id AND delivery_status = 'pending'`),
    hasOutstandingRun: database.prepare(agentSql`SELECT EXISTS (
      SELECT 1 FROM scheduled_task_runs
      WHERE task_id = ?
        AND (execution_status IN ('queued', 'claimed', 'running') OR delivery_status = 'pending')
    ) AS has_outstanding_run`),
    upsertToolPolicy:
      database.prepare(agentSql`INSERT INTO scheduled_task_tool_policies (task_id, allowed_tool_names_json, updated_at)
      VALUES (@task_id, @allowed_tool_names_json, @updated_at)
      ON CONFLICT (task_id) DO UPDATE SET allowed_tool_names_json = excluded.allowed_tool_names_json,
      updated_at = excluded.updated_at`),
    selectToolPolicy: database.prepare(
      agentSql`SELECT allowed_tool_names_json FROM scheduled_task_tool_policies WHERE task_id = ?`,
    ),
  };
}
