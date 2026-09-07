import type Database from "better-sqlite3";
import { agentSql } from "../Database/AgentSql.js";

export interface AgentChildRunRow {
  readonly id: string;
  readonly owner_run_id: string;
  readonly node_id: string;
  readonly join_group_json: string | null;
  readonly parent_session_id: string;
  readonly parent_request_id: string;
  readonly child_session_id: string;
  readonly child_request_id: string;
  readonly agent_name: string;
  readonly task: string;
  readonly context_mode: string;
  readonly approval_mode: string;
  readonly model_provider_id: string | null;
  readonly model_selection_source: string | null;
  readonly selected_skills_json: string;
  readonly configuration_revision: number | null;
  readonly execution_contract_json: string;
  readonly status: string;
  readonly launch_contract_digest: string;
  readonly launch_contract_json: string;
  readonly allowed_tool_names_json: string;
  readonly snapshot_json: string | null;
  readonly checkpoint_json: string | null;
  readonly final_answer: string | null;
  readonly usage_json: string | null;
  readonly error: string | null;
  readonly created_at: string;
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly updated_at: string;
  readonly revision: number;
}

export interface AgentChildRunMessageRow {
  readonly sequence: number;
  readonly id: string;
  readonly child_run_id: string;
  readonly direction: string;
  readonly kind: string;
  readonly content: string;
  readonly created_at: string;
}

export interface AgentChildRunSqlStatements {
  readonly insert: Database.Statement;
  readonly select: Database.Statement<[string], AgentChildRunRow>;
  readonly selectByChildSession: Database.Statement<[string], AgentChildRunRow>;
  readonly selectByOwnerNode: Database.Statement<[string, string], AgentChildRunRow>;
  readonly listForOwner: Database.Statement<[string], AgentChildRunRow>;
  readonly listForJoinGroup: Database.Statement<[string], AgentChildRunRow>;
  readonly listForParent: Database.Statement<[string], AgentChildRunRow>;
  readonly listForParentRequest: Database.Statement<[string, string], AgentChildRunRow>;
  readonly listActive: Database.Statement<[], AgentChildRunRow>;
  readonly listAll: Database.Statement<[], AgentChildRunRow>;
  readonly markRunning: Database.Statement;
  readonly markWrappingUp: Database.Statement;
  readonly markCancelling: Database.Statement;
  readonly markAwaitingSupervisor: Database.Statement;
  readonly markResumed: Database.Statement;
  readonly recordSnapshot: Database.Statement;
  readonly recordSupervisorCheckpoint: Database.Statement;
  readonly markCompleted: Database.Statement;
  readonly markPartialCompleted: Database.Statement;
  readonly markInterrupted: Database.Statement;
  readonly markFailed: Database.Statement;
  readonly markCancelled: Database.Statement;
  readonly markTimedOut: Database.Statement;
  readonly recoverInterrupted: Database.Statement;
  readonly insertMessage: Database.Statement;
  readonly listMessages: Database.Statement<[string], AgentChildRunMessageRow>;
}

export function prepareAgentChildRunSqlStatements(database: Database.Database): AgentChildRunSqlStatements {
  return {
    insert: database.prepare(
      agentSql`INSERT INTO child_runs (
                 id, owner_run_id, node_id, join_group_json, parent_session_id, parent_request_id, child_session_id, child_request_id,
                 agent_name, task, context_mode, approval_mode, model_provider_id,
                 model_selection_source, selected_skills_json, configuration_revision, execution_contract_json, status,
                 launch_contract_digest, launch_contract_json, allowed_tool_names_json,
                 created_at, updated_at
               ) VALUES (
                 @id, @owner_run_id, @node_id, @join_group_json, @parent_session_id, @parent_request_id, @child_session_id, @child_request_id,
                 @agent_name, @task, @context_mode, @approval_mode, @model_provider_id,
                 @model_selection_source, @selected_skills_json, @configuration_revision, @execution_contract_json, @status,
                 @launch_contract_digest, @launch_contract_json, @allowed_tool_names_json,
                 @created_at, @updated_at
               )`,
    ),
    select: database.prepare(
      agentSql`SELECT id, owner_run_id, node_id, join_group_json, parent_session_id, parent_request_id, child_session_id, child_request_id,
                      agent_name, task, context_mode, approval_mode, model_provider_id,
                      model_selection_source, selected_skills_json, configuration_revision, execution_contract_json, status,
                      launch_contract_digest, launch_contract_json, allowed_tool_names_json,
                      snapshot_json, checkpoint_json, final_answer, usage_json, error,
                      created_at, started_at, completed_at, updated_at, revision
               FROM child_runs
               WHERE id = ?`,
    ),
    selectByChildSession: database.prepare(
      agentSql`SELECT id, owner_run_id, node_id, join_group_json, parent_session_id, parent_request_id, child_session_id, child_request_id,
                      agent_name, task, context_mode, approval_mode, model_provider_id,
                      model_selection_source, selected_skills_json, configuration_revision, execution_contract_json, status,
                      launch_contract_digest, launch_contract_json, allowed_tool_names_json,
                      snapshot_json, checkpoint_json, final_answer, usage_json, error,
                      created_at, started_at, completed_at, updated_at, revision
               FROM child_runs
               WHERE child_session_id = ?`,
    ),
    selectByOwnerNode: database.prepare(
      agentSql`SELECT id, owner_run_id, node_id, join_group_json, parent_session_id, parent_request_id, child_session_id, child_request_id,
                      agent_name, task, context_mode, approval_mode, model_provider_id,
                      model_selection_source, selected_skills_json, configuration_revision, execution_contract_json, status,
                      launch_contract_digest, launch_contract_json, allowed_tool_names_json,
                      snapshot_json, checkpoint_json, final_answer, usage_json, error,
                      created_at, started_at, completed_at, updated_at, revision
               FROM child_runs
               WHERE owner_run_id = ? AND node_id = ?`,
    ),
    listForOwner: database.prepare(
      agentSql`SELECT id, owner_run_id, node_id, join_group_json, parent_session_id, parent_request_id, child_session_id, child_request_id,
                      agent_name, task, context_mode, approval_mode, model_provider_id,
                      model_selection_source, selected_skills_json, configuration_revision, execution_contract_json, status,
                      launch_contract_digest, launch_contract_json, allowed_tool_names_json,
                      snapshot_json, checkpoint_json, final_answer, usage_json, error,
                      created_at, started_at, completed_at, updated_at, revision
               FROM child_runs
               WHERE owner_run_id = ?
               ORDER BY created_at, id`,
    ),
    listForJoinGroup: database.prepare(
      agentSql`SELECT id, owner_run_id, node_id, join_group_json, parent_session_id, parent_request_id, child_session_id, child_request_id,
                      agent_name, task, context_mode, approval_mode, model_provider_id,
                      model_selection_source, selected_skills_json, configuration_revision, execution_contract_json, status,
                      launch_contract_digest, launch_contract_json, allowed_tool_names_json,
                      snapshot_json, checkpoint_json, final_answer, usage_json, error,
                      created_at, started_at, completed_at, updated_at, revision
               FROM child_runs
               WHERE json_extract(join_group_json, '$.id') = ?
               ORDER BY created_at, id`,
    ),
    listForParent: database.prepare(
      agentSql`SELECT id, owner_run_id, node_id, join_group_json, parent_session_id, parent_request_id, child_session_id, child_request_id,
                      agent_name, task, context_mode, approval_mode, model_provider_id,
                      model_selection_source, selected_skills_json, configuration_revision, execution_contract_json, status,
                      launch_contract_digest, launch_contract_json, allowed_tool_names_json,
                      snapshot_json, checkpoint_json, final_answer, usage_json, error,
                      created_at, started_at, completed_at, updated_at, revision
               FROM child_runs
               WHERE parent_session_id = ?
               ORDER BY created_at DESC, id`,
    ),
    listForParentRequest: database.prepare(
      agentSql`SELECT id, owner_run_id, node_id, join_group_json, parent_session_id, parent_request_id, child_session_id, child_request_id,
                      agent_name, task, context_mode, approval_mode, model_provider_id,
                      model_selection_source, selected_skills_json, configuration_revision, execution_contract_json, status,
                      launch_contract_digest, launch_contract_json, allowed_tool_names_json,
                      snapshot_json, checkpoint_json, final_answer, usage_json, error,
                      created_at, started_at, completed_at, updated_at, revision
               FROM child_runs
               WHERE parent_session_id = ? AND parent_request_id = ?
               ORDER BY created_at DESC, id`,
    ),
    listActive: database.prepare(
      agentSql`SELECT id, owner_run_id, node_id, join_group_json, parent_session_id, parent_request_id, child_session_id, child_request_id,
                      agent_name, task, context_mode, approval_mode, model_provider_id,
                      model_selection_source, selected_skills_json, configuration_revision, execution_contract_json, status,
                      launch_contract_digest, launch_contract_json, allowed_tool_names_json,
                      snapshot_json, checkpoint_json, final_answer, usage_json, error,
                      created_at, started_at, completed_at, updated_at, revision
               FROM child_runs
               WHERE status IN ('queued', 'running', 'wrapping_up', 'cancelling')
               ORDER BY created_at, id`,
    ),
    listAll: database.prepare(
      agentSql`SELECT id, owner_run_id, node_id, join_group_json, parent_session_id, parent_request_id, child_session_id, child_request_id,
                      agent_name, task, context_mode, approval_mode, model_provider_id,
                      model_selection_source, selected_skills_json, configuration_revision, execution_contract_json, status,
                      launch_contract_digest, launch_contract_json, allowed_tool_names_json,
                      snapshot_json, checkpoint_json, final_answer, usage_json, error,
                      created_at, started_at, completed_at, updated_at, revision
               FROM child_runs
               ORDER BY created_at, id`,
    ),
    markRunning: database.prepare(
      agentSql`UPDATE child_runs
               SET status = 'running', started_at = COALESCE(started_at, @started_at),
                   updated_at = @started_at, revision = revision + 1
               WHERE id = @id AND status = 'queued'`,
    ),
    markWrappingUp: database.prepare(
      agentSql`UPDATE child_runs
               SET status = 'wrapping_up', updated_at = @updated_at, revision = revision + 1
               WHERE id = @id AND status = 'running'`,
    ),
    markCancelling: database.prepare(
      agentSql`UPDATE child_runs
               SET status = 'cancelling', updated_at = @updated_at, revision = revision + 1
               WHERE id = @id AND status IN ('queued', 'running', 'wrapping_up')`,
    ),
    markAwaitingSupervisor: database.prepare(
      agentSql`UPDATE child_runs
               SET status = 'awaiting_supervisor', updated_at = @updated_at, revision = revision + 1
               WHERE id = @id AND status = 'running'`,
    ),
    markResumed: database.prepare(
      agentSql`UPDATE child_runs
               SET status = 'queued', child_request_id = @child_request_id, error = NULL,
                   final_answer = NULL, completed_at = NULL, updated_at = @updated_at, revision = revision + 1
               WHERE id = @id AND status IN ('awaiting_supervisor', 'partial_completed', 'interrupted', 'failed', 'timed_out', 'completed', 'cancelled')`,
    ),
    recordSnapshot: database.prepare(
      agentSql`UPDATE child_runs
               SET snapshot_json = @snapshot_json,
                   checkpoint_json = COALESCE(@checkpoint_json, checkpoint_json),
                   updated_at = @updated_at, revision = revision + 1
               WHERE id = @id AND status IN ('running', 'wrapping_up', 'cancelling', 'awaiting_supervisor')`,
    ),
    recordSupervisorCheckpoint: database.prepare(
      agentSql`UPDATE child_runs
               SET checkpoint_json = @checkpoint_json, usage_json = @usage_json,
                   updated_at = @updated_at, revision = revision + 1
               WHERE id = @id AND status = 'awaiting_supervisor'`,
    ),
    markCompleted: database.prepare(
      agentSql`UPDATE child_runs
               SET status = 'completed', final_answer = @final_answer,
                   usage_json = @usage_json, error = NULL,
                   completed_at = @completed_at, updated_at = @completed_at, revision = revision + 1
               WHERE id = @id AND status IN ('running', 'wrapping_up')`,
    ),
    markPartialCompleted: database.prepare(
      agentSql`UPDATE child_runs
               SET status = 'partial_completed', final_answer = @final_answer,
                   usage_json = @usage_json, error = NULL,
                   completed_at = @completed_at, updated_at = @completed_at, revision = revision + 1
               WHERE id = @id AND status IN ('running', 'wrapping_up', 'cancelling')`,
    ),
    markInterrupted: database.prepare(
      agentSql`UPDATE child_runs
               SET status = 'interrupted', final_answer = COALESCE(@final_answer, final_answer),
                   error = @error, completed_at = @completed_at,
                   updated_at = @completed_at, revision = revision + 1
               WHERE id = @id AND status IN ('running', 'wrapping_up', 'cancelling')`,
    ),
    markFailed: database.prepare(
      agentSql`UPDATE child_runs
               SET status = 'failed', error = @error, completed_at = @completed_at,
                   updated_at = @completed_at, revision = revision + 1
               WHERE id = @id AND status IN ('queued', 'running', 'wrapping_up', 'cancelling', 'awaiting_supervisor')`,
    ),
    markCancelled: database.prepare(
      agentSql`UPDATE child_runs
               SET status = 'cancelled', final_answer = COALESCE(@final_answer, final_answer),
                   completed_at = @completed_at,
                   updated_at = @completed_at, revision = revision + 1
               WHERE id = @id AND status IN ('queued', 'running', 'wrapping_up', 'cancelling', 'awaiting_supervisor')`,
    ),
    markTimedOut: database.prepare(
      agentSql`UPDATE child_runs
               SET status = 'timed_out', final_answer = COALESCE(@final_answer, final_answer),
                   error = @error, completed_at = @completed_at,
                   updated_at = @completed_at, revision = revision + 1
               WHERE id = @id AND status IN ('running', 'wrapping_up', 'cancelling')`,
    ),
    recoverInterrupted: database.prepare(
      agentSql`UPDATE child_runs
               SET status = 'interrupted',
                   final_answer = COALESCE(final_answer, json_extract(checkpoint_json, '$.content')),
                   error = @error, completed_at = @recovered_at,
                   updated_at = @recovered_at, revision = revision + 1
               WHERE status IN ('queued', 'running', 'wrapping_up', 'cancelling')`,
    ),
    insertMessage: database.prepare(
      agentSql`INSERT INTO child_run_messages (id, child_run_id, direction, kind, content, created_at)
               VALUES (@id, @child_run_id, @direction, @kind, @content, @created_at)`,
    ),
    listMessages: database.prepare(
      agentSql`SELECT sequence, id, child_run_id, direction, kind, content, created_at
               FROM child_run_messages
               WHERE child_run_id = ?
               ORDER BY sequence`,
    ),
  };
}
