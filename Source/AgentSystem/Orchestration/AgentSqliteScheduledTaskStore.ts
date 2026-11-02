import { createOpaqueId } from "../Core/AgentIds.js";
import { DefaultAgentTimeZone } from "../Time/AgentTime.js";
import { latestAgentScheduleOccurrence } from "./AgentScheduleDefinition.js";
import type Database from "better-sqlite3";
import type {
  ScheduledTask,
  ScheduledTaskRunHistoryEntry,
  ScheduledTaskType,
  TaskSchedulerScope,
} from "./AgentScheduleDefinition.js";
import type { AgentOrchestrationDatabase } from "./AgentOrchestrationDatabase.js";
import {
  AgentScheduledTaskDeliveryStatuses,
  AgentScheduledTaskExecutionModes,
  AgentScheduledTaskExecutionStatuses,
  resolveAgentScheduledTaskExecutionMode,
  type AgentScheduledTaskRecord,
  type AgentScheduledTaskRunClaim,
  type AgentScheduledTaskRunRecord,
} from "./AgentScheduledTaskRunTypes.js";
import {
  prepareAgentScheduledTaskSqlStatements,
  type AgentScheduledTaskRow,
  type AgentScheduledTaskRunRow,
  type AgentScheduledTaskSqlStatements,
} from "./AgentScheduledTaskSqlStatements.js";

const DefaultClaimBatchSize = 16;

export interface AgentScheduledTaskClaimOptions {
  readonly now: string;
  readonly claimUntil: string;
  readonly maximum?: number;
  readonly nextRunAt: (task: ScheduledTask, now: string) => string | undefined;
}

export interface AgentScheduledTaskDeliveryClaim {
  readonly task: ScheduledTask;
  readonly run: AgentScheduledTaskRunRecord;
  readonly claimId: string;
}

export class AgentSqliteScheduledTaskStore {
  private readonly database: Database.Database;
  private readonly statements: AgentScheduledTaskSqlStatements;
  private readonly insertTask: (task: AgentScheduledTaskRecord) => AgentScheduledTaskRecord;
  private readonly updateTask: (taskId: string, task: AgentScheduledTaskRecord) => AgentScheduledTaskRecord | undefined;
  private readonly claimDueRuns: (options: AgentScheduledTaskClaimOptions) => AgentScheduledTaskRunClaim[];
  private readonly claimDeliveries: (
    now: string,
    claimUntil: string,
    maximum: number,
  ) => AgentScheduledTaskDeliveryClaim[];

  constructor(database: AgentOrchestrationDatabase) {
    this.database = database.connection;
    this.statements = prepareAgentScheduledTaskSqlStatements(this.database);
    this.insertTask = this.database.transaction((task) => {
      this.statements.insert.run(taskToRow(task));
      return this.require(task.id);
    });
    this.updateTask = this.database.transaction((taskId, task) => {
      const updated = this.statements.update.run(taskToRow({ ...task, id: taskId }));
      if (updated.changes === 0) return undefined;
      if (resolveAgentScheduledTaskExecutionMode(task) === AgentScheduledTaskExecutionModes.ExecuteNowDeliverAt) {
        if (task.enabled && task.nextRunAt) {
          this.statements.rescheduleDeferredDeliveries.run({
            task_id: taskId,
            deliver_at: task.nextRunAt,
            updated_at: task.updatedAt,
          });
        } else {
          this.statements.cancelDeferredDeliveries.run({ task_id: taskId, updated_at: task.updatedAt });
        }
      }
      return this.require(taskId);
    });
    this.claimDueRuns = this.database.transaction((options) => this.claimDueRunsTransaction(options));
    this.claimDeliveries = this.database.transaction((now, claimUntil, maximum) =>
      this.claimDeliveriesTransaction(now, claimUntil, maximum),
    );
  }

  list(scope: TaskSchedulerScope = {}): Promise<AgentScheduledTaskRecord[]> {
    const rows = this.listRows(scope);
    return Promise.resolve(rows.map((row) => taskFromRow(row, [])));
  }

  get(taskId: string, scope: TaskSchedulerScope = {}): Promise<AgentScheduledTaskRecord | undefined> {
    const row = this.selectRow(taskId, scope);
    return Promise.resolve(row ? taskFromRow(row, this.runHistory(taskId)) : undefined);
  }

  definition(taskId: string): AgentScheduledTaskRecord | undefined {
    const row = this.selectRow(taskId, {});
    return row ? taskFromRow(row, []) : undefined;
  }

  receiptHistory(taskId: string, ownerSessionId: string, limit: number, before?: string) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error("Receipt history limit must be from 1 to 100.");
    const task = this.definition(taskId);
    if (!task || task.sessionId !== ownerSessionId) throw new Error("Schedule was not found in this session.");
    const cursor = before
      ? (this.database
          .prepare("SELECT rowid FROM scheduled_task_runs WHERE id = ? AND task_id = ?")
          .get(before, taskId) as { rowid: number } | undefined)
      : undefined;
    if (before && !cursor) throw new Error("Schedule receipt cursor was not found.");
    const rows = (
      cursor
        ? this.database
            .prepare("SELECT * FROM scheduled_task_runs WHERE task_id = ? AND rowid < ? ORDER BY rowid DESC LIMIT ?")
            .all(taskId, cursor.rowid, limit + 1)
        : this.database
            .prepare("SELECT * FROM scheduled_task_runs WHERE task_id = ? ORDER BY rowid DESC LIMIT ?")
            .all(taskId, limit + 1)
    ) as AgentScheduledTaskRunRow[];
    const records = rows.slice(0, limit).map(runFromRow);
    return { records, ...(rows.length > limit ? { nextBefore: records.at(-1)!.id } : {}) };
  }

  create(task: AgentScheduledTaskRecord): Promise<AgentScheduledTaskRecord> {
    return Promise.resolve(this.insertTask(task));
  }

  createAuthorized(task: AgentScheduledTaskRecord, toolNames: readonly string[]): Promise<AgentScheduledTaskRecord> {
    return Promise.resolve(
      this.database.transaction(() => {
        const created = this.insertTask(task);
        this.setAllowedToolNames(created.id, toolNames, created.createdAt);
        return created;
      })(),
    );
  }

  update(
    taskId: string,
    task: AgentScheduledTaskRecord,
    scope: TaskSchedulerScope = {},
  ): Promise<AgentScheduledTaskRecord | undefined> {
    if (!this.selectRow(taskId, scope)) return Promise.resolve(undefined);
    return Promise.resolve(this.updateTask(taskId, task));
  }

  /** Definition and authority changes share one snapshot with scheduler claims. */
  editAuthorized(
    taskId: string,
    ownerSessionId: string,
    edit: (current: AgentScheduledTaskRecord) => AgentScheduledTaskRecord,
    toolNames?: readonly string[],
  ): AgentScheduledTaskRecord | undefined {
    return this.database.transaction(() => {
      const current = this.definition(taskId);
      if (!current || current.sessionId !== ownerSessionId) return undefined;
      const next = edit(current);
      const updated = this.updateTask(taskId, next);
      if (updated && toolNames !== undefined) this.setAllowedToolNames(taskId, toolNames, next.updatedAt);
      return updated;
    })();
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

  claimDue(options: AgentScheduledTaskClaimOptions): AgentScheduledTaskRunClaim[] {
    return this.claimDueRuns(options);
  }

  enqueueImmediate(taskId: string, scheduledFor: string, deliveryAt = scheduledFor): boolean {
    return this.database.transaction(() => {
      const task = this.require(taskId);
      const runId = createOpaqueId("scheduledrun");
      this.statements.insertRun.run(
        runToRow({
          id: runId,
          taskId: task.id,
          instructionPrompt: task.prompt,
          scheduledFor,
          executionStatus: AgentScheduledTaskExecutionStatuses.Queued,
          deliveryStatus: AgentScheduledTaskDeliveryStatuses.Pending,
          executionSessionId: createOpaqueId("scheduled_session"),
          deliveryAt,
          ...(task.sourceRequestId ? { sourceRequestId: task.sourceRequestId } : {}),
          attempt: 0,
          createdAt: scheduledFor,
          updatedAt: scheduledFor,
        }),
      );
      return true;
    })();
  }

  markRunning(
    runId: string,
    claimId: string,
    claimUntil: string,
    updatedAt: string,
  ): AgentScheduledTaskRunRecord | undefined {
    return this.database.transaction(() => {
      const changed = this.statements.markRunRunning.run({
        id: runId,
        claim_id: claimId,
        claim_until: claimUntil,
        updated_at: updatedAt,
      });
      if (changed.changes === 0) return undefined;
      const run = this.requireRun(runId);
      this.statements.markTaskRunning.run({ task_id: run.taskId, updated_at: updatedAt });
      return run;
    })();
  }

  renewClaim(runId: string, claimId: string, claimUntil: string, updatedAt: string): boolean {
    return (
      this.statements.renewRunClaim.run({
        id: runId,
        claim_id: claimId,
        claim_until: claimUntil,
        updated_at: updatedAt,
      }).changes > 0
    );
  }

  assignRunSourceRequestId(
    runId: string,
    claimId: string,
    sourceRequestId: string,
    updatedAt: string,
  ): AgentScheduledTaskRunRecord | undefined {
    return this.database.transaction(() => {
      this.statements.assignRunSourceRequestId.run({
        id: runId,
        claim_id: claimId,
        source_request_id: sourceRequestId,
        updated_at: updatedAt,
      });
      const run = this.requireRun(runId);
      return run.claimId === claimId ? run : undefined;
    })();
  }

  releaseExecutionClaim(runId: string, claimId: string, updatedAt: string): AgentScheduledTaskRunRecord | undefined {
    return this.database.transaction(() => {
      const changed = this.statements.releaseExecutionClaim.run({
        id: runId,
        claim_id: claimId,
        updated_at: updatedAt,
      });
      if (changed.changes === 0) return undefined;
      const run = this.requireRun(runId);
      this.statements.clearTaskRunningStatus.run({ task_id: run.taskId, updated_at: updatedAt });
      return run;
    })();
  }

  completeSuccess(
    runId: string,
    claimId: string,
    result: string,
    completedAt: string,
  ): AgentScheduledTaskRunRecord | undefined {
    return this.complete(runId, claimId, AgentScheduledTaskExecutionStatuses.Succeeded, result, undefined, completedAt);
  }

  completeFailure(
    runId: string,
    claimId: string,
    error: string,
    completedAt: string,
  ): AgentScheduledTaskRunRecord | undefined {
    return this.complete(runId, claimId, AgentScheduledTaskExecutionStatuses.Failed, undefined, error, completedAt);
  }

  claimPendingDeliveries(
    now: string,
    claimUntil: string,
    maximum = DefaultClaimBatchSize,
  ): AgentScheduledTaskDeliveryClaim[] {
    return this.claimDeliveries(now, claimUntil, assertMaximum(maximum));
  }

  pendingDeliveryCount(): number {
    return this.statements.countPendingDeliveries.get()?.count ?? 0;
  }

  hasOutstandingRun(taskId: string): boolean {
    return this.statements.hasOutstandingRun.get(taskId)?.has_outstanding_run === 1;
  }

  markDelivered(runId: string, claimId: string, deliveredAt: string): boolean {
    return this.database.transaction(() => {
      const changed = this.statements.markDelivered.run({
        id: runId,
        delivery_claim_id: claimId,
        delivered_at: deliveredAt,
        updated_at: deliveredAt,
      });
      if (changed.changes === 0) return false;
      const run = this.requireRun(runId);
      const task = this.require(run.taskId);
      if (resolveAgentScheduledTaskExecutionMode(task) === AgentScheduledTaskExecutionModes.ExecuteNowDeliverAt) {
        this.statements.settleDeferredDeliveryTask.run({ task_id: task.id, updated_at: deliveredAt });
      }
      return true;
    })();
  }

  releaseDelivery(runId: string, claimId: string, error: string, updatedAt: string): boolean {
    return (
      this.statements.releaseDelivery.run({
        id: runId,
        delivery_claim_id: claimId,
        delivery_error: error,
        updated_at: updatedAt,
      }).changes > 0
    );
  }

  private claimDueRunsTransaction(options: AgentScheduledTaskClaimOptions): AgentScheduledTaskRunClaim[] {
    const maximum = assertMaximum(options.maximum ?? DefaultClaimBatchSize);
    const claims: AgentScheduledTaskRunClaim[] = [];
    for (const row of this.statements.selectClaimableRunIds.all(options.now, maximum)) {
      const claimed = this.claimExistingRun(row.id, options.now, options.claimUntil);
      if (claimed) claims.push(claimed);
    }
    if (claims.length >= maximum) return claims;

    for (const row of this.statements.selectDueTaskIds.all(options.now, maximum - claims.length)) {
      const task = this.require(row.id);
      if (!task.nextRunAt) continue;
      const nextRunAt = options.nextRunAt(task, options.now);
      const advanced = this.statements.advanceDueTask.run({
        id: task.id,
        now: options.now,
        enabled: task.type === "once" || !nextRunAt ? 0 : 1,
        next_run_at: nextRunAt ?? null,
        updated_at: options.now,
      });
      if (advanced.changes === 0) continue;

      const runId = createOpaqueId("scheduledrun");
      const claimId = createOpaqueId("scheduledclaim");
      const executionSessionId = createOpaqueId("scheduled_session");
      this.statements.insertRun.run(
        runToRow({
          id: runId,
          taskId: task.id,
          instructionPrompt: task.prompt,
          scheduledFor: latestAgentScheduleOccurrence(task, task.nextRunAt, options.now),
          executionStatus: AgentScheduledTaskExecutionStatuses.Claimed,
          deliveryStatus: AgentScheduledTaskDeliveryStatuses.Pending,
          executionSessionId,
          deliveryAt: task.nextRunAt,
          ...(task.sourceRequestId ? { sourceRequestId: task.sourceRequestId } : {}),
          claimId,
          claimUntil: options.claimUntil,
          attempt: 1,
          createdAt: options.now,
          updatedAt: options.now,
        }),
      );
      claims.push({ task, run: this.requireRun(runId) });
    }
    return claims;
  }

  private claimExistingRun(runId: string, now: string, claimUntil: string): AgentScheduledTaskRunClaim | undefined {
    const claimId = createOpaqueId("scheduledclaim");
    const executionSessionId = this.requireRun(runId).executionSessionId;
    const changed = this.statements.claimExistingRun.run({
      id: runId,
      claim_id: claimId,
      execution_session_id: executionSessionId,
      claim_until: claimUntil,
      now,
      updated_at: now,
    });
    if (changed.changes === 0) return undefined;
    const run = this.requireRun(runId);
    return { task: this.require(run.taskId), run };
  }

  /** This receipt acknowledges inbox admission, never a model execution outcome. */
  completeAdmission(runId: string, claimId: string, admittedAt: string): boolean {
    return this.database.transaction(() => {
      const completed = this.completeSuccess(runId, claimId, "Instruction accepted by the session inbox.", admittedAt);
      if (!completed) return false;
      this.database
        .prepare(
          `UPDATE scheduled_task_runs SET delivery_status = 'delivered', delivered_at = ?, updated_at = ? WHERE id = ?`,
        )
        .run(admittedAt, admittedAt, runId);
      return true;
    })();
  }

  private complete(
    runId: string,
    claimId: string,
    executionStatus: "succeeded" | "failed",
    result: string | undefined,
    error: string | undefined,
    completedAt: string,
  ): AgentScheduledTaskRunRecord | undefined {
    return this.database.transaction(() => {
      const task = this.require(this.requireRun(runId).taskId);
      const deferredDelivery =
        task.enabled &&
        resolveAgentScheduledTaskExecutionMode(task) === AgentScheduledTaskExecutionModes.ExecuteNowDeliverAt;
      const deliveryStatus =
        executionStatus === AgentScheduledTaskExecutionStatuses.Succeeded || deferredDelivery
          ? AgentScheduledTaskDeliveryStatuses.Pending
          : AgentScheduledTaskDeliveryStatuses.NotRequired;
      const changed = this.statements.completeRun.run({
        id: runId,
        claim_id: claimId,
        execution_status: executionStatus,
        delivery_status: deliveryStatus,
        result: result ?? null,
        error: error ?? null,
        completed_at: completedAt,
        updated_at: completedAt,
      });
      if (changed.changes === 0) return undefined;
      const run = this.requireRun(runId);
      if (executionStatus === AgentScheduledTaskExecutionStatuses.Succeeded) {
        this.statements.completeTaskSuccess.run({
          task_id: run.taskId,
          completed_at: completedAt,
          updated_at: completedAt,
        });
      } else {
        this.statements.completeTaskFailure.run({
          task_id: run.taskId,
          error: error ?? "Scheduled task failed.",
          updated_at: completedAt,
        });
      }
      return run;
    })();
  }

  private claimDeliveriesTransaction(
    now: string,
    claimUntil: string,
    maximum: number,
  ): AgentScheduledTaskDeliveryClaim[] {
    const claims: AgentScheduledTaskDeliveryClaim[] = [];
    for (const row of this.statements.selectClaimableDeliveryIds.all(now, now, maximum)) {
      const claimId = createOpaqueId("scheduleddelivery");
      const changed = this.statements.claimDelivery.run({
        id: row.id,
        delivery_claim_id: claimId,
        delivery_claim_until: claimUntil,
        now,
        updated_at: now,
      });
      if (changed.changes === 0) continue;
      const run = this.requireRun(row.id);
      claims.push({ task: this.require(run.taskId), run, claimId });
    }
    return claims;
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

  private require(taskId: string): AgentScheduledTaskRecord {
    const row = this.statements.select.get(taskId);
    if (!row) throw new Error(`Scheduled task does not exist after persistence: ${taskId}`);
    return taskFromRow(row, []);
  }

  private requireRun(runId: string): AgentScheduledTaskRunRecord {
    const row = this.statements.selectRun.get(runId);
    if (!row) throw new Error(`Scheduled task run does not exist after persistence: ${runId}`);
    return runFromRow(row);
  }
}

function assertMaximum(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error("Scheduled-task claim maximum must be a positive safe integer.");
  return value;
}

function taskToRow(task: AgentScheduledTaskRecord) {
  return {
    id: task.id,
    tenant_id: task.tenantId ?? null,
    user_id: task.userId ?? null,
    workspace_id: task.workspaceId ?? null,
    session_id: task.sessionId,
    time_zone: task.timeZone ?? DefaultAgentTimeZone,
    target_mode: task.target ?? "this_session",
    target_session_id: task.targetSessionId ?? null,
    source_request_id: task.sourceRequestId ?? null,
    execution_mode: resolveAgentScheduledTaskExecutionMode(task),
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

function taskFromRow(row: AgentScheduledTaskRow, runHistory: ScheduledTaskRunHistoryEntry[]): AgentScheduledTaskRecord {
  return {
    id: row.id,
    ...(row.tenant_id ? { tenantId: row.tenant_id } : {}),
    ...(row.user_id ? { userId: row.user_id } : {}),
    ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
    sessionId: row.session_id,
    timeZone: row.time_zone,
    target: readScheduleTarget(row.target_mode),
    ...(row.target_session_id ? { targetSessionId: row.target_session_id } : {}),
    ...(row.source_request_id ? { sourceRequestId: row.source_request_id } : {}),
    executionMode: readExecutionMode(row.execution_mode),
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

function runToRow(run: AgentScheduledTaskRunRecord) {
  return {
    id: run.id,
    instruction_prompt: run.instructionPrompt ?? null,
    task_id: run.taskId,
    scheduled_for: run.scheduledFor,
    execution_status: run.executionStatus,
    delivery_status: run.deliveryStatus,
    execution_session_id: run.executionSessionId,
    deliver_at: run.deliveryAt,
    source_request_id: run.sourceRequestId ?? null,
    claim_id: run.claimId ?? null,
    claim_until: run.claimUntil ?? null,
    attempt: run.attempt,
    result: run.result ?? null,
    error: run.error ?? null,
    delivery_claim_id: null,
    delivery_claim_until: null,
    delivery_attempt: 0,
    delivery_error: null,
    created_at: run.createdAt,
    started_at: run.startedAt ?? null,
    completed_at: run.completedAt ?? null,
    delivered_at: run.deliveredAt ?? null,
    updated_at: run.updatedAt,
  };
}

function runFromRow(row: AgentScheduledTaskRunRow): AgentScheduledTaskRunRecord {
  return {
    id: row.id,
    ...(row.instruction_prompt !== null ? { instructionPrompt: row.instruction_prompt } : {}),
    taskId: row.task_id,
    scheduledFor: row.scheduled_for,
    executionStatus: readExecutionStatus(row.execution_status),
    deliveryStatus: readDeliveryStatus(row.delivery_status),
    executionSessionId: row.execution_session_id,
    deliveryAt: row.deliver_at ?? row.scheduled_for,
    ...(row.source_request_id ? { sourceRequestId: row.source_request_id } : {}),
    ...(row.claim_id ? { claimId: row.claim_id } : {}),
    ...(row.claim_until ? { claimUntil: row.claim_until } : {}),
    attempt: row.attempt,
    ...(row.result ? { result: row.result } : {}),
    ...(row.error ? { error: row.error } : {}),
    createdAt: row.created_at,
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.delivered_at ? { deliveredAt: row.delivered_at } : {}),
    updatedAt: row.updated_at,
  };
}

function runHistoryFromRow(row: AgentScheduledTaskRunRow): ScheduledTaskRunHistoryEntry {
  const status =
    row.execution_status === AgentScheduledTaskExecutionStatuses.Succeeded
      ? "success"
      : row.execution_status === AgentScheduledTaskExecutionStatuses.Failed
        ? "error"
        : "running";
  const message = row.result ?? row.error;
  return {
    id: row.id,
    status,
    createdAt: row.created_at,
    sessionId: row.execution_session_id,
    ...(message ? { message } : {}),
  };
}

function readTaskType(value: string): ScheduledTaskType {
  if (value === "cron" || value === "once" || value === "interval") return value;
  throw new Error(`Stored scheduled task type is invalid: ${value}`);
}

function readExecutionMode(value: string): AgentScheduledTaskRecord["executionMode"] {
  if (value === "at_due_time" || value === "execute_now_deliver_at") return value;
  throw new Error(`Stored scheduled task execution mode is invalid: ${value}`);
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

function readExecutionStatus(value: string): AgentScheduledTaskRunRecord["executionStatus"] {
  if (
    Object.values(AgentScheduledTaskExecutionStatuses).includes(value as AgentScheduledTaskRunRecord["executionStatus"])
  ) {
    return value as AgentScheduledTaskRunRecord["executionStatus"];
  }
  throw new Error(`Stored scheduled task execution status is invalid: ${value}`);
}

function readDeliveryStatus(value: string): AgentScheduledTaskRunRecord["deliveryStatus"] {
  if (
    Object.values(AgentScheduledTaskDeliveryStatuses).includes(value as AgentScheduledTaskRunRecord["deliveryStatus"])
  ) {
    return value as AgentScheduledTaskRunRecord["deliveryStatus"];
  }
  throw new Error(`Stored scheduled task delivery status is invalid: ${value}`);
}

function readScheduleTarget(value: string): NonNullable<ScheduledTask["target"]> {
  if (value === "this_session" || value === "new_once" || value === "new") return value;
  throw new Error(`Invalid stored schedule target: ${value}`);
}
