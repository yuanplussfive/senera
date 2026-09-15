import type Database from "better-sqlite3";
import { createOpaqueId } from "../Core/AgentIds.js";
import type { AgentPiToolPlanState, AgentPiToolPlanStateNode } from "../PiShared/AgentPiPlanningTypes.js";
import {
  AgentExecutionEventKinds,
  AgentExecutionStatuses,
  AgentExecutionStepStatuses,
  type AgentExecutionEventRecord,
  type AgentExecutionLedger,
  type AgentExecutionLedgerSnapshot,
  type AgentExecutionPlanSyncInput,
  type AgentExecutionStatus,
  type AgentExecutionStep,
  type AgentExecutionStepStatus,
  type AgentExecutionSyncResult,
} from "./AgentExecutionLedgerTypes.js";
import { AgentSqliteDatabaseKernel } from "../Database/AgentSqliteDatabaseKernel.js";

interface ExecutionRow {
  id: string;
  uri: string;
  session_id: string;
  request_id: string;
  objective: string;
  status: AgentExecutionStatus;
  reason: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface StepRow {
  id: string;
  execution_id: string;
  node_id: string;
  plan_id: string;
  plan_revision: number;
  step_index: number;
  title: string;
  detail: string;
  status: AgentExecutionStepStatus;
  dependency_ids_json: string;
  call_id: string | null;
  failure: string | null;
  created_at: string;
  updated_at: string;
}

interface PlanNode extends AgentPiToolPlanStateNode {
  readonly planId: string;
  readonly planRevision: number;
}

/** Durable projection of one request's host-owned execution plan and observations. */
export class AgentExecutionLedgerSqliteStore {
  private readonly db: Database.Database;

  constructor(database: AgentSqliteDatabaseKernel | Database.Database) {
    this.db = database instanceof AgentSqliteDatabaseKernel ? database.connection : database;
  }

  snapshot(sessionId: string): AgentExecutionLedgerSnapshot {
    const normalizedSessionId = requireText(sessionId, "Execution session id");
    const executions = this.list(normalizedSessionId);
    return {
      active: executions.find((execution) => execution.status === AgentExecutionStatuses.Active) ?? null,
      executions,
    };
  }

  find(sessionId: string, requestId: string): AgentExecutionLedger | undefined {
    const normalizedSessionId = requireText(sessionId, "Execution session id");
    const normalizedRequestId = requireText(requestId, "Execution request id");
    return this.findByRequest(normalizedSessionId, normalizedRequestId);
  }

  findByReference(sessionId: string, reference: string): AgentExecutionLedger | undefined {
    const normalizedSessionId = requireText(sessionId, "Execution session id");
    const normalizedReference = requireText(reference, "Execution wait reference");
    const row = this.db
      .prepare<unknown[], ExecutionRow>(
        `SELECT DISTINCT execution.*
         FROM agent_execution_runs AS execution
         LEFT JOIN agent_execution_steps AS step ON step.execution_id = execution.id
         WHERE execution.session_id = ?
           AND (execution.id = ? OR execution.uri = ? OR step.call_id = ?)
         ORDER BY execution.created_at DESC, execution.id ASC
         LIMIT 1`,
      )
      .get(normalizedSessionId, normalizedReference, normalizedReference, normalizedReference);
    return row ? projectExecution(row, this.steps(row.id)) : undefined;
  }

  syncPlan(input: AgentExecutionPlanSyncInput): AgentExecutionSyncResult {
    const sessionId = requireText(input.sessionId, "Execution session id");
    const requestId = requireText(input.requestId, "Execution request id");
    const objective = requireText(input.objective, "Execution objective");
    const now = input.now ?? new Date();
    const timestamp = now.toISOString();
    const result = this.db.transaction(() =>
      this.applyPlan(sessionId, requestId, objective, input.planState, input.completion ?? "immediate", timestamp),
    )();
    return { snapshot: this.snapshot(sessionId), events: result.events };
  }

  finalize(sessionId: string, requestId: string, now = new Date()): AgentExecutionSyncResult {
    const current = this.find(sessionId, requestId);
    if (!current || current.status !== AgentExecutionStatuses.Active || current.steps.length === 0) {
      return { snapshot: this.snapshot(sessionId), events: [] };
    }
    if (current.steps.some((step) => step.status !== AgentExecutionStepStatuses.Completed)) {
      return { snapshot: this.snapshot(sessionId), events: [] };
    }

    const timestamp = now.toISOString();
    const result = this.db.transaction(() => {
      const execution = this.find(sessionId, requestId);
      if (
        !execution ||
        execution.status !== AgentExecutionStatuses.Active ||
        execution.steps.length === 0 ||
        execution.steps.some((step) => step.status !== AgentExecutionStepStatuses.Completed)
      ) {
        return { events: [] as AgentExecutionEventRecord[] };
      }
      const completed = this.updateExecution(
        execution,
        AgentExecutionStatuses.Completed,
        "All planned steps completed.",
        timestamp,
      );
      const event: AgentExecutionEventRecord = {
        kind: AgentExecutionEventKinds.Completed,
        execution: completed,
      };
      this.appendEvent(event, sessionId, requestId, timestamp);
      return { events: [event] };
    })();
    return { snapshot: this.snapshot(sessionId), events: result.events };
  }

  private applyPlan(
    sessionId: string,
    requestId: string,
    objective: string,
    planState: AgentPiToolPlanState,
    completion: "immediate" | "deferred",
    timestamp: string,
  ): { events: AgentExecutionEventRecord[] } {
    let execution = this.find(sessionId, requestId);
    const events: AgentExecutionEventRecord[] = [];
    if (!execution) {
      execution = this.insertExecution(sessionId, requestId, objective, timestamp);
      events.push({ kind: AgentExecutionEventKinds.Created, execution });
    }

    const previousSteps = new Map(execution.steps.map((step) => [step.nodeId, step]));
    const nextSteps = flattenPlanNodes(planState).map((node) => {
      const previous = previousSteps.get(node.nodeId);
      const step = this.upsertStep(execution!, node, previous, timestamp);
      if (!previous && step.status === AgentExecutionStepStatuses.Running) {
        events.push({ kind: AgentExecutionEventKinds.StepStarted, execution: execution!, step });
      } else if (previous && previous.status !== step.status) {
        if (step.status === AgentExecutionStepStatuses.Running) {
          events.push({ kind: AgentExecutionEventKinds.StepStarted, execution: execution!, step });
        }
        if (step.status === AgentExecutionStepStatuses.Completed) {
          events.push({ kind: AgentExecutionEventKinds.StepCompleted, execution: execution!, step });
        }
        if (step.status === AgentExecutionStepStatuses.Failed || step.status === AgentExecutionStepStatuses.Blocked) {
          events.push({ kind: AgentExecutionEventKinds.Blocked, execution: execution!, step });
        }
      }
      return step;
    });

    const previousStatus = execution.status;
    const status = resolveExecutionStatus(nextSteps, previousStatus, completion);
    const reason =
      status === AgentExecutionStatuses.Blocked
        ? firstFailure(nextSteps)
        : status === AgentExecutionStatuses.Completed
          ? "All planned steps completed."
          : undefined;
    execution = this.updateExecution(execution, status, reason, timestamp);
    if (status === AgentExecutionStatuses.Blocked && previousStatus !== status) {
      events.push({ kind: AgentExecutionEventKinds.Blocked, execution });
    }
    if (status === AgentExecutionStatuses.Completed && previousStatus !== status) {
      events.push({ kind: AgentExecutionEventKinds.Completed, execution });
    }

    const currentExecution = this.find(sessionId, requestId)!;
    const currentEvents = events.map((event) => ({ ...event, execution: currentExecution }));
    for (const event of currentEvents) this.appendEvent(event, sessionId, requestId, timestamp);
    return { events: currentEvents };
  }

  private insertExecution(
    sessionId: string,
    requestId: string,
    objective: string,
    timestamp: string,
  ): AgentExecutionLedger {
    const id = createOpaqueId("execution");
    this.db
      .prepare(
        `INSERT INTO agent_execution_runs
          (id, uri, session_id, request_id, objective, status, reason, created_at, updated_at, completed_at)
         VALUES (@id, @uri, @session_id, @request_id, @objective, @status, NULL, @created_at, @updated_at, NULL)`,
      )
      .run({
        id,
        uri: `senera://execution/${id}`,
        session_id: sessionId,
        request_id: requestId,
        objective,
        status: AgentExecutionStatuses.Active,
        created_at: timestamp,
        updated_at: timestamp,
      });
    return this.find(sessionId, requestId)!;
  }

  private upsertStep(
    execution: AgentExecutionLedger,
    node: PlanNode,
    previous: AgentExecutionStep | undefined,
    timestamp: string,
  ): AgentExecutionStep {
    const step = {
      id: previous?.id ?? createOpaqueId("execution_step"),
      nodeId: node.nodeId,
      planId: node.planId,
      planRevision: node.planRevision,
      index: node.planIndex,
      title: node.toolName,
      detail: node.purpose,
      status: projectStepStatus(node.status),
      dependencyIds: [...node.dependencyNodeIds],
      ...(node.callId ? { callId: node.callId } : {}),
      ...(node.failure ? { failure: node.failure } : {}),
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: timestamp,
    } satisfies AgentExecutionStep;
    if (previous && isSameStep(previous, step)) return previous;
    this.db
      .prepare(
        `INSERT INTO agent_execution_steps
          (id, execution_id, node_id, plan_id, plan_revision, step_index, title, detail, status,
           dependency_ids_json, call_id, failure, created_at, updated_at)
         VALUES (@id, @execution_id, @node_id, @plan_id, @plan_revision, @step_index, @title, @detail, @status,
           @dependency_ids_json, @call_id, @failure, @created_at, @updated_at)
         ON CONFLICT(execution_id, node_id) DO UPDATE SET
           plan_id = excluded.plan_id, plan_revision = excluded.plan_revision, step_index = excluded.step_index,
           title = excluded.title, detail = excluded.detail, status = excluded.status,
           dependency_ids_json = excluded.dependency_ids_json, call_id = excluded.call_id,
           failure = excluded.failure, updated_at = excluded.updated_at`,
      )
      .run({
        id: step.id,
        execution_id: execution.id,
        node_id: step.nodeId,
        plan_id: step.planId,
        plan_revision: step.planRevision,
        step_index: step.index,
        title: step.title,
        detail: step.detail,
        status: step.status,
        dependency_ids_json: JSON.stringify(step.dependencyIds),
        call_id: step.callId ?? null,
        failure: step.failure ?? null,
        created_at: step.createdAt,
        updated_at: step.updatedAt,
      });
    return step;
  }

  private updateExecution(
    execution: AgentExecutionLedger,
    status: AgentExecutionStatus,
    reason: string | undefined,
    timestamp: string,
  ): AgentExecutionLedger {
    if (execution.status === status && execution.reason === reason) return execution;
    const completedAt = status === AgentExecutionStatuses.Completed ? (execution.completedAt ?? timestamp) : null;
    this.db
      .prepare(
        `UPDATE agent_execution_runs
         SET status = @status, reason = @reason, updated_at = @updated_at, completed_at = @completed_at
         WHERE id = @id`,
      )
      .run({
        id: execution.id,
        status,
        reason: reason ?? null,
        updated_at: timestamp,
        completed_at: completedAt,
      });
    return this.find(execution.sessionId, execution.requestId)!;
  }

  private appendEvent(event: AgentExecutionEventRecord, sessionId: string, requestId: string, timestamp: string): void {
    this.db
      .prepare(
        `INSERT INTO agent_execution_events
          (id, execution_id, event_kind, step_id, session_id, request_id, payload_json, occurred_at)
         VALUES (@id, @execution_id, @event_kind, @step_id, @session_id, @request_id, @payload_json, @occurred_at)`,
      )
      .run({
        id: createOpaqueId("execution_event"),
        execution_id: event.execution.id,
        event_kind: event.kind,
        step_id: event.step?.id ?? null,
        session_id: sessionId,
        request_id: requestId,
        payload_json: JSON.stringify({ execution: event.execution, step: event.step ?? null }),
        occurred_at: timestamp,
      });
  }

  private findByRequest(sessionId: string, requestId: string): AgentExecutionLedger | undefined {
    const row = this.db
      .prepare<unknown[], ExecutionRow>(`SELECT * FROM agent_execution_runs WHERE session_id = ? AND request_id = ?`)
      .get(sessionId, requestId);
    return row ? projectExecution(row, this.steps(row.id)) : undefined;
  }

  private list(sessionId: string): AgentExecutionLedger[] {
    const rows = this.db
      .prepare<unknown[], ExecutionRow>(
        `SELECT * FROM agent_execution_runs WHERE session_id = ? ORDER BY created_at ASC, id ASC`,
      )
      .all(sessionId);
    return rows.map((row) => projectExecution(row, this.steps(row.id)));
  }

  private steps(executionId: string): AgentExecutionStep[] {
    return this.db
      .prepare<unknown[], StepRow>(
        `SELECT * FROM agent_execution_steps WHERE execution_id = ? ORDER BY step_index ASC, id ASC`,
      )
      .all(executionId)
      .map(projectStep);
  }
}

function projectExecution(row: ExecutionRow, steps: readonly AgentExecutionStep[]): AgentExecutionLedger {
  return {
    id: row.id,
    uri: row.uri,
    sessionId: row.session_id,
    requestId: row.request_id,
    objective: row.objective,
    status: row.status,
    ...(row.reason ? { reason: row.reason } : {}),
    steps,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
  };
}

function projectStep(row: StepRow): AgentExecutionStep {
  return {
    id: row.id,
    nodeId: row.node_id,
    planId: row.plan_id,
    planRevision: row.plan_revision,
    index: row.step_index,
    title: row.title,
    detail: row.detail,
    status: row.status,
    dependencyIds: parseStringArray(row.dependency_ids_json),
    ...(row.call_id ? { callId: row.call_id } : {}),
    ...(row.failure ? { failure: row.failure } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function flattenPlanNodes(state: AgentPiToolPlanState): PlanNode[] {
  return state.revisions.flatMap((revision) =>
    revision.nodes.map((node) => ({ ...node, planId: revision.planId, planRevision: revision.revision })),
  );
}

function projectStepStatus(status: AgentPiToolPlanStateNode["status"]): AgentExecutionStepStatus {
  switch (status) {
    case "planned":
      return AgentExecutionStepStatuses.Planned;
    case "dispatched":
      return AgentExecutionStepStatuses.Running;
    case "completed":
      return AgentExecutionStepStatuses.Completed;
    case "failed":
      return AgentExecutionStepStatuses.Failed;
    case "blocked":
      return AgentExecutionStepStatuses.Blocked;
  }
}

function resolveExecutionStatus(
  steps: readonly AgentExecutionStep[],
  current: AgentExecutionStatus,
  completion: "immediate" | "deferred",
): AgentExecutionStatus {
  if (current === AgentExecutionStatuses.Cancelled || steps.length === 0) return current;
  if (
    steps.some(
      (step) => step.status === AgentExecutionStepStatuses.Failed || step.status === AgentExecutionStepStatuses.Blocked,
    )
  ) {
    return AgentExecutionStatuses.Blocked;
  }
  if (!steps.every((step) => step.status === AgentExecutionStepStatuses.Completed))
    return AgentExecutionStatuses.Active;
  return completion === "deferred" && current === AgentExecutionStatuses.Active
    ? AgentExecutionStatuses.Active
    : AgentExecutionStatuses.Completed;
}

function firstFailure(steps: readonly AgentExecutionStep[]): string {
  return steps.find((step) => step.failure)?.failure ?? "A planned step could not complete.";
}

function isSameStep(previous: AgentExecutionStep, next: AgentExecutionStep): boolean {
  return (
    previous.nodeId === next.nodeId &&
    previous.planId === next.planId &&
    previous.planRevision === next.planRevision &&
    previous.index === next.index &&
    previous.title === next.title &&
    previous.detail === next.detail &&
    previous.status === next.status &&
    previous.callId === next.callId &&
    previous.failure === next.failure &&
    previous.dependencyIds.length === next.dependencyIds.length &&
    previous.dependencyIds.every((dependencyId, index) => dependencyId === next.dependencyIds[index])
  );
}

function parseStringArray(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} cannot be empty.`);
  return normalized;
}
