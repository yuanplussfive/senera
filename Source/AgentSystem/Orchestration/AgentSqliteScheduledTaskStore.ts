import type Database from "better-sqlite3";
import type {
  ScheduledTask,
  ScheduledTaskRunHistoryEntry,
  ScheduledTaskStore,
  ScheduledTaskType,
  TaskSchedulerScope,
} from "@amaster.ai/pi-task-scheduler";
import type { AgentOrchestrationDatabase } from "./AgentOrchestrationDatabase.js";
import {
  prepareAgentScheduledTaskSqlStatements,
  type AgentScheduledTaskRow,
  type AgentScheduledTaskRunRow,
  type AgentScheduledTaskSqlStatements,
} from "./AgentScheduledTaskSqlStatements.js";

export class AgentSqliteScheduledTaskStore implements ScheduledTaskStore {
  private readonly database: Database.Database;
  private readonly statements: AgentScheduledTaskSqlStatements;
  private readonly insertTask: (task: ScheduledTask) => ScheduledTask;
  private readonly updateTask: (taskId: string, task: ScheduledTask) => ScheduledTask | undefined;

  constructor(database: AgentOrchestrationDatabase) {
    this.database = database.connection;
    this.statements = prepareAgentScheduledTaskSqlStatements(this.database);
    this.insertTask = this.database.transaction((task) => {
      this.statements.insert.run(taskToRow(task));
      this.persistRunHistory(task);
      return this.require(task.id);
    });
    this.updateTask = this.database.transaction((taskId, task) => {
      const updated = this.statements.update.run(taskToRow({ ...task, id: taskId }));
      if (updated.changes === 0) return undefined;
      this.persistRunHistory({ ...task, id: taskId });
      return this.require(taskId);
    });
  }

  list(scope: TaskSchedulerScope = {}): Promise<ScheduledTask[]> {
    const rows = this.listRows(scope);
    const history = groupRunHistory(this.statements.listRuns.all());
    return Promise.resolve(rows.map((row) => taskFromRow(row, history.get(row.id) ?? [])));
  }

  get(taskId: string, scope: TaskSchedulerScope = {}): Promise<ScheduledTask | undefined> {
    const row = this.selectRow(taskId, scope);
    return Promise.resolve(row ? taskFromRow(row, this.runHistory(taskId)) : undefined);
  }

  create(task: ScheduledTask): Promise<ScheduledTask> {
    return Promise.resolve(this.insertTask(task));
  }

  update(taskId: string, task: ScheduledTask, scope: TaskSchedulerScope = {}): Promise<ScheduledTask | undefined> {
    if (!this.selectRow(taskId, scope)) return Promise.resolve(undefined);
    return Promise.resolve(this.updateTask(taskId, task));
  }

  delete(taskId: string, scope: TaskSchedulerScope = {}): Promise<boolean> {
    const result = scope.tenantId
      ? scope.userId
        ? this.statements.deleteByTenantAndUser.run(taskId, scope.tenantId, scope.userId)
        : this.statements.deleteByTenant.run(taskId, scope.tenantId)
      : scope.userId
        ? this.statements.deleteByUser.run(taskId, scope.userId)
        : this.statements.delete.run(taskId);
    return Promise.resolve(result.changes > 0);
  }

  setAllowedToolNames(taskId: string, toolNames: readonly string[], updatedAt = new Date().toISOString()): void {
    this.statements.upsertToolPolicy.run({
      task_id: taskId,
      allowed_tool_names_json: JSON.stringify([...new Set(toolNames)]),
      updated_at: updatedAt,
    });
  }

  allowedToolNames(taskId: string): readonly string[] | undefined {
    const row = this.statements.selectToolPolicy.get(taskId);
    if (!row) return undefined;
    const parsed: unknown = JSON.parse(row.allowed_tool_names_json);
    if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
      throw new Error(`Scheduled task ${taskId} has an invalid tool policy.`);
    }
    return parsed;
  }

  private listRows(scope: TaskSchedulerScope): AgentScheduledTaskRow[] {
    if (scope.tenantId) {
      return scope.userId
        ? this.statements.listByTenantAndUser.all(scope.tenantId, scope.userId)
        : this.statements.listByTenant.all(scope.tenantId);
    }
    return scope.userId ? this.statements.listByUser.all(scope.userId) : this.statements.listAll.all();
  }

  private selectRow(taskId: string, scope: TaskSchedulerScope): AgentScheduledTaskRow | undefined {
    if (scope.tenantId) {
      return scope.userId
        ? this.statements.selectByTenantAndUser.get(taskId, scope.tenantId, scope.userId)
        : this.statements.selectByTenant.get(taskId, scope.tenantId);
    }
    return scope.userId ? this.statements.selectByUser.get(taskId, scope.userId) : this.statements.select.get(taskId);
  }

  private runHistory(taskId: string): ScheduledTaskRunHistoryEntry[] {
    return this.statements.listRunsForTask.all(taskId).map(runHistoryFromRow);
  }

  private persistRunHistory(task: ScheduledTask): void {
    for (const entry of task.runHistory ?? []) {
      this.statements.upsertRun.run({
        id: entry.id,
        task_id: task.id,
        status: entry.status,
        session_id: entry.sessionId ?? null,
        message: entry.message ?? null,
        created_at: entry.createdAt,
        updated_at: task.updatedAt,
      });
    }
  }

  private require(taskId: string): ScheduledTask {
    const row = this.statements.select.get(taskId);
    if (!row) throw new Error(`Scheduled task does not exist after persistence: ${taskId}`);
    return taskFromRow(row, this.runHistory(taskId));
  }
}

function taskToRow(task: ScheduledTask) {
  return {
    id: task.id,
    tenant_id: task.tenantId ?? null,
    user_id: task.userId ?? null,
    workspace_id: task.workspaceId ?? null,
    session_id: task.sessionId,
    name: task.name ?? null,
    description: task.description ?? null,
    prompt: task.prompt,
    task_type: task.type,
    schedule_expression: task.schedule,
    interval_seconds: task.intervalSeconds,
    enabled: task.enabled ? 1 : 0,
    model_provider: task.model.provider,
    model_id: task.model.model,
    thinking_level: task.model.thinkingLevel ?? null,
    auth_profile_id: task.model.authProfileId ?? null,
    reasoning: task.model.reasoning === undefined ? null : task.model.reasoning ? 1 : 0,
    tool_policy_profile: task.toolPolicyProfile,
    workspace_dir: task.workspaceDir ?? null,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    last_run_at: task.lastRunAt ?? null,
    next_run_at: task.nextRunAt ?? null,
    run_count: task.runCount,
    timeout_ms: task.timeoutMs ?? null,
    last_status: task.lastStatus ?? null,
    last_error: task.lastError ?? null,
  };
}

function taskFromRow(row: AgentScheduledTaskRow, runHistory: ScheduledTaskRunHistoryEntry[]): ScheduledTask {
  return {
    id: row.id,
    ...(row.tenant_id ? { tenantId: row.tenant_id } : {}),
    ...(row.user_id ? { userId: row.user_id } : {}),
    ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
    sessionId: row.session_id,
    ...(row.name ? { name: row.name } : {}),
    prompt: row.prompt,
    type: readTaskType(row.task_type),
    schedule: row.schedule_expression,
    intervalSeconds: row.interval_seconds,
    enabled: row.enabled === 1,
    model: {
      provider: row.model_provider,
      model: row.model_id,
      ...(row.thinking_level ? { thinkingLevel: readThinkingLevel(row.thinking_level) } : {}),
      ...(row.auth_profile_id ? { authProfileId: row.auth_profile_id } : {}),
      ...(row.reasoning !== null ? { reasoning: row.reasoning === 1 } : {}),
    },
    toolPolicyProfile: row.tool_policy_profile,
    ...(row.workspace_dir ? { workspaceDir: row.workspace_dir } : {}),
    ...(row.description ? { description: row.description } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.last_run_at ? { lastRunAt: row.last_run_at } : {}),
    ...(row.next_run_at ? { nextRunAt: row.next_run_at } : {}),
    runCount: row.run_count,
    ...(row.timeout_ms !== null ? { timeoutMs: row.timeout_ms } : {}),
    ...(row.last_status ? { lastStatus: readLastStatus(row.last_status) } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    runHistory,
  };
}

function runHistoryFromRow(row: AgentScheduledTaskRunRow): ScheduledTaskRunHistoryEntry {
  const status = ["success", "error", "running", "paused", "resumed"].find((candidate) => candidate === row.status);
  if (!status) throw new Error(`Stored scheduled task run status is invalid: ${row.status}`);
  return {
    id: row.id,
    status: status as ScheduledTaskRunHistoryEntry["status"],
    createdAt: row.created_at,
    ...(row.session_id ? { sessionId: row.session_id } : {}),
    ...(row.message ? { message: row.message } : {}),
  };
}

function groupRunHistory(rows: readonly AgentScheduledTaskRunRow[]): Map<string, ScheduledTaskRunHistoryEntry[]> {
  const grouped = new Map<string, ScheduledTaskRunHistoryEntry[]>();
  for (const row of rows) {
    const entries = grouped.get(row.task_id) ?? [];
    entries.push(runHistoryFromRow(row));
    grouped.set(row.task_id, entries);
  }
  return grouped;
}

function readTaskType(value: string): ScheduledTaskType {
  if (value === "cron" || value === "once" || value === "interval") return value;
  throw new Error(`Stored scheduled task type is invalid: ${value}`);
}

function readThinkingLevel(value: string): NonNullable<ScheduledTask["model"]["thinkingLevel"]> {
  if (["off", "minimal", "low", "medium", "high", "xhigh"].includes(value)) {
    return value as NonNullable<ScheduledTask["model"]["thinkingLevel"]>;
  }
  throw new Error(`Stored scheduled task thinking level is invalid: ${value}`);
}

function readLastStatus(value: string): NonNullable<ScheduledTask["lastStatus"]> {
  if (value === "success" || value === "error" || value === "running") return value;
  throw new Error(`Stored scheduled task status is invalid: ${value}`);
}
