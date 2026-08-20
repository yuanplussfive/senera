import type Database from "better-sqlite3";
import { agentSql } from "../Database/AgentSql.js";

export interface AgentScheduledTaskRow {
  readonly id: string;
  readonly tenant_id: string | null;
  readonly user_id: string | null;
  readonly workspace_id: string | null;
  readonly session_id: string;
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
  readonly status: string;
  readonly session_id: string | null;
  readonly message: string | null;
  readonly created_at: string;
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
  readonly listRunsForTask: Database.Statement<[string], AgentScheduledTaskRunRow>;
  readonly listRuns: Database.Statement<[], AgentScheduledTaskRunRow>;
  readonly upsertToolPolicy: Database.Statement;
  readonly selectToolPolicy: Database.Statement<[string], { allowed_tool_names_json: string }>;
}

export function prepareAgentScheduledTaskSqlStatements(database: Database.Database): AgentScheduledTaskSqlStatements {
  return {
    listAll: database.prepare(
      agentSql`SELECT id, tenant_id, user_id, workspace_id, session_id, name, description, prompt,
                      task_type, schedule_expression, interval_seconds, enabled,
                      model_provider, model_id, thinking_level, auth_profile_id, reasoning,
                      tool_policy_profile, workspace_dir, created_at, updated_at, last_run_at,
                      next_run_at, run_count, timeout_ms, last_status, last_error, revision
               FROM scheduled_tasks
               ORDER BY created_at, id`,
    ),
    listByTenant: database.prepare(
      agentSql`SELECT id, tenant_id, user_id, workspace_id, session_id, name, description, prompt,
                      task_type, schedule_expression, interval_seconds, enabled,
                      model_provider, model_id, thinking_level, auth_profile_id, reasoning,
                      tool_policy_profile, workspace_dir, created_at, updated_at, last_run_at,
                      next_run_at, run_count, timeout_ms, last_status, last_error, revision
               FROM scheduled_tasks
               WHERE tenant_id = ?
               ORDER BY created_at, id`,
    ),
    listByUser: database.prepare(
      agentSql`SELECT id, tenant_id, user_id, workspace_id, session_id, name, description, prompt,
                      task_type, schedule_expression, interval_seconds, enabled,
                      model_provider, model_id, thinking_level, auth_profile_id, reasoning,
                      tool_policy_profile, workspace_dir, created_at, updated_at, last_run_at,
                      next_run_at, run_count, timeout_ms, last_status, last_error, revision
               FROM scheduled_tasks
               WHERE user_id = ?
               ORDER BY created_at, id`,
    ),
    listByTenantAndUser: database.prepare(
      agentSql`SELECT id, tenant_id, user_id, workspace_id, session_id, name, description, prompt,
                      task_type, schedule_expression, interval_seconds, enabled,
                      model_provider, model_id, thinking_level, auth_profile_id, reasoning,
                      tool_policy_profile, workspace_dir, created_at, updated_at, last_run_at,
                      next_run_at, run_count, timeout_ms, last_status, last_error, revision
               FROM scheduled_tasks
               WHERE tenant_id = ? AND user_id = ?
               ORDER BY created_at, id`,
    ),
    select: database.prepare(
      agentSql`SELECT id, tenant_id, user_id, workspace_id, session_id, name, description, prompt,
                      task_type, schedule_expression, interval_seconds, enabled,
                      model_provider, model_id, thinking_level, auth_profile_id, reasoning,
                      tool_policy_profile, workspace_dir, created_at, updated_at, last_run_at,
                      next_run_at, run_count, timeout_ms, last_status, last_error, revision
               FROM scheduled_tasks
               WHERE id = ?`,
    ),
    selectByTenant: database.prepare(
      agentSql`SELECT id, tenant_id, user_id, workspace_id, session_id, name, description, prompt,
                      task_type, schedule_expression, interval_seconds, enabled,
                      model_provider, model_id, thinking_level, auth_profile_id, reasoning,
                      tool_policy_profile, workspace_dir, created_at, updated_at, last_run_at,
                      next_run_at, run_count, timeout_ms, last_status, last_error, revision
               FROM scheduled_tasks
               WHERE id = ? AND tenant_id = ?`,
    ),
    selectByUser: database.prepare(
      agentSql`SELECT id, tenant_id, user_id, workspace_id, session_id, name, description, prompt,
                      task_type, schedule_expression, interval_seconds, enabled,
                      model_provider, model_id, thinking_level, auth_profile_id, reasoning,
                      tool_policy_profile, workspace_dir, created_at, updated_at, last_run_at,
                      next_run_at, run_count, timeout_ms, last_status, last_error, revision
               FROM scheduled_tasks
               WHERE id = ? AND user_id = ?`,
    ),
    selectByTenantAndUser: database.prepare(
      agentSql`SELECT id, tenant_id, user_id, workspace_id, session_id, name, description, prompt,
                      task_type, schedule_expression, interval_seconds, enabled,
                      model_provider, model_id, thinking_level, auth_profile_id, reasoning,
                      tool_policy_profile, workspace_dir, created_at, updated_at, last_run_at,
                      next_run_at, run_count, timeout_ms, last_status, last_error, revision
               FROM scheduled_tasks
               WHERE id = ? AND tenant_id = ? AND user_id = ?`,
    ),
    insert: database.prepare(
      agentSql`INSERT INTO scheduled_tasks (
                 id, tenant_id, user_id, workspace_id, session_id, name, description, prompt,
                 task_type, schedule_expression, interval_seconds, enabled,
                 model_provider, model_id, thinking_level, auth_profile_id, reasoning,
                 tool_policy_profile, workspace_dir, created_at, updated_at, last_run_at,
                 next_run_at, run_count, timeout_ms, last_status, last_error
               ) VALUES (
                 @id, @tenant_id, @user_id, @workspace_id, @session_id, @name, @description, @prompt,
                 @task_type, @schedule_expression, @interval_seconds, @enabled,
                 @model_provider, @model_id, @thinking_level, @auth_profile_id, @reasoning,
                 @tool_policy_profile, @workspace_dir, @created_at, @updated_at, @last_run_at,
                 @next_run_at, @run_count, @timeout_ms, @last_status, @last_error
               )`,
    ),
    update: database.prepare(
      agentSql`UPDATE scheduled_tasks SET
                 tenant_id = @tenant_id,
                 user_id = @user_id,
                 workspace_id = @workspace_id,
                 session_id = @session_id,
                 name = @name,
                 description = @description,
                 prompt = @prompt,
                 task_type = @task_type,
                 schedule_expression = @schedule_expression,
                 interval_seconds = @interval_seconds,
                 enabled = @enabled,
                 model_provider = @model_provider,
                 model_id = @model_id,
                 thinking_level = @thinking_level,
                 auth_profile_id = @auth_profile_id,
                 reasoning = @reasoning,
                 tool_policy_profile = @tool_policy_profile,
                 workspace_dir = @workspace_dir,
                 updated_at = @updated_at,
                 last_run_at = @last_run_at,
                 next_run_at = @next_run_at,
                 run_count = @run_count,
                 timeout_ms = @timeout_ms,
                 last_status = @last_status,
                 last_error = @last_error,
                 revision = revision + 1
               WHERE id = @id`,
    ),
    delete: database.prepare(agentSql`DELETE FROM scheduled_tasks WHERE id = ?`),
    deleteByTenant: database.prepare(agentSql`DELETE FROM scheduled_tasks WHERE id = ? AND tenant_id = ?`),
    deleteByUser: database.prepare(agentSql`DELETE FROM scheduled_tasks WHERE id = ? AND user_id = ?`),
    deleteByTenantAndUser: database.prepare(
      agentSql`DELETE FROM scheduled_tasks WHERE id = ? AND tenant_id = ? AND user_id = ?`,
    ),
    upsertRun: database.prepare(
      agentSql`INSERT INTO scheduled_task_runs (id, task_id, status, session_id, message, created_at, updated_at)
               VALUES (@id, @task_id, @status, @session_id, @message, @created_at, @updated_at)
               ON CONFLICT (id) DO UPDATE SET
                 status = excluded.status,
                 session_id = excluded.session_id,
                 message = excluded.message,
                 updated_at = excluded.updated_at`,
    ),
    listRunsForTask: database.prepare(
      agentSql`SELECT id, task_id, status, session_id, message, created_at, updated_at
               FROM scheduled_task_runs
               WHERE task_id = ?
               ORDER BY created_at, id`,
    ),
    listRuns: database.prepare(
      agentSql`SELECT id, task_id, status, session_id, message, created_at, updated_at
               FROM scheduled_task_runs
               ORDER BY task_id, created_at, id`,
    ),
    upsertToolPolicy: database.prepare(
      agentSql`INSERT INTO scheduled_task_tool_policies (task_id, allowed_tool_names_json, updated_at)
               VALUES (@task_id, @allowed_tool_names_json, @updated_at)
               ON CONFLICT (task_id) DO UPDATE SET
                 allowed_tool_names_json = excluded.allowed_tool_names_json,
                 updated_at = excluded.updated_at`,
    ),
    selectToolPolicy: database.prepare(
      agentSql`SELECT allowed_tool_names_json FROM scheduled_task_tool_policies WHERE task_id = ?`,
    ),
  };
}
