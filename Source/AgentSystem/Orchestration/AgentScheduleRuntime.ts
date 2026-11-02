import {
  resolveScheduledTaskDefinition,
  nextAgentScheduleOccurrence,
  type ScheduledTask,
  type ScheduledTaskCreateInput,
  type ScheduledTaskUpdate,
} from "./AgentScheduleDefinition.js";
import PQueue from "p-queue";
import { DefaultAgentTimeZone } from "../Time/AgentTime.js";
import { createOpaqueId, createRequestId } from "../Core/AgentIds.js";
import { resolveModelProviderConfig } from "../Defaults/AgentModelProviderDefaults.js";
import { AgentEventKinds, withEventContext, type AgentDomainEvent } from "../Events/AgentEvent.js";
import { AgentExecutionApprovalModes } from "../Safety/AgentExecutionApprovalMode.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { AgentExtensionRegistryLike } from "../Types/ToolRuntimeTypes.js";
import type { AgentOrchestrationEventRelay } from "./AgentOrchestrationEventRelay.js";
import { AgentScheduledTaskToolPolicyProtocol } from "./AgentOrchestrationProtocols.js";
import { AgentRunContextModes, type AgentRunDispatchPort } from "./AgentRunDispatchPort.js";
import type { AgentSqliteScheduledTaskStore } from "./AgentSqliteScheduledTaskStore.js";
import {
  AgentScheduledTaskExecutionModes,
  AgentScheduledInstructionGateway,
  resolveAgentScheduledTaskExecutionMode,
  type AgentScheduledTaskExecutionSessionPort,
  type AgentScheduledTaskExecutionMode,
  type AgentScheduledTaskRecord,
  type AgentScheduledTaskDeliveryPort,
  type AgentScheduledTaskRunClaim,
  type AgentScheduledTaskSourceContextPort,
} from "./AgentScheduledTaskRunTypes.js";

const DefaultClaimBatchSize = 16;

export interface AgentScheduleCreateRequest {
  readonly timeZone?: string;
  readonly target?: "this_session" | "new_once" | "new";
  readonly name?: string;
  readonly description?: string;
  readonly prompt: string;
  readonly type: "cron" | "once" | "interval";
  readonly schedule: string;
  readonly executionMode?: AgentScheduledTaskExecutionMode;
  readonly enabled?: boolean;
  readonly modelProviderId?: string;
  readonly allowedToolNames?: readonly string[];
  readonly timeoutMs?: number;
}

export interface AgentScheduleUpdateRequest {
  readonly timeZone?: string;
  readonly name?: string;
  readonly description?: string;
  readonly prompt?: string;
  readonly type?: "cron" | "once" | "interval";
  readonly schedule?: string;
  readonly enabled?: boolean;
  readonly modelProviderId?: string;
  readonly allowedToolNames?: readonly string[];
  readonly timeoutMs?: number;
}

export interface AgentScheduleToolContext {
  readonly sessionId: string;
  readonly requestId: string;
  readonly modelProviderId?: string;
  readonly authorizedToolNames: readonly string[];
  readonly registry: AgentExtensionRegistryLike;
}

export interface AgentScheduleRuntimeOptions {
  readonly workspaceRoot: string;
  readonly config: () => AgentSystemConfig;
  readonly store: AgentSqliteScheduledTaskStore;
  readonly dispatcher: AgentRunDispatchPort;
  readonly delivery: AgentScheduledTaskDeliveryPort;
  readonly sourceContext: AgentScheduledTaskSourceContextPort;
  readonly executionSessions: AgentScheduledTaskExecutionSessionPort;
  readonly events: AgentOrchestrationEventRelay;
  readonly pollIntervalMs: number;
  readonly claimDurationMs: number;
  readonly claimBatchSize?: number;
  readonly now?: () => Date;
}

export class AgentScheduleRuntime {
  private readonly activeRuns = new Map<string, ActiveScheduledRun>();
  private readonly retiringOwnerSessions = new Set<string>();
  private readonly now: () => Date;
  private readonly claimBatchSize: number;
  private acceptingWork = true;
  private active = false;
  private tickPromise?: Promise<void>;
  private readonly admissions = new Set<Promise<void>>();
  private pollTimer?: NodeJS.Timeout;
  private startPromise?: Promise<void>;
  private stopPromise?: Promise<void>;
  private readonly instructions = new AgentScheduledInstructionGateway();
  private readonly runnable: PQueue;

  constructor(private readonly options: AgentScheduleRuntimeOptions) {
    assertPositiveSafeInteger(options.pollIntervalMs, "Scheduler poll interval");
    assertPositiveSafeInteger(options.claimDurationMs, "Scheduled-task claim duration");
    this.claimBatchSize = options.claimBatchSize ?? DefaultClaimBatchSize;
    assertPositiveSafeInteger(this.claimBatchSize, "Scheduled-task claim batch size");
    this.now = options.now ?? (() => new Date());
    this.runnable = new PQueue({ concurrency: this.claimBatchSize });
  }

  bindInstructions(port: import("./AgentScheduledTaskRunTypes.js").AgentScheduledInstructionPort): () => void {
    return this.instructions.bind(port);
  }

  async start(): Promise<void> {
    this.assertAcceptingWork();
    if (this.startPromise) return this.startPromise;
    if (this.active) return;
    return (this.startPromise = this.startRuntime().finally(() => {
      this.startPromise = undefined;
    }));
  }

  private async startRuntime(): Promise<void> {
    await this.reconcileOwnerSessions();
    if (!this.acceptingWork) return;
    this.active = true;
    this.pollTimer = setInterval(() => void this.tick(), this.options.pollIntervalMs);
    this.pollTimer.unref();
    await this.tick();
    if (this.active) await this.emitSchedulerStatus();
  }

  stop(): Promise<void> {
    this.acceptingWork = false;
    return (this.stopPromise ??= this.stopRuntime());
  }

  async create(request: AgentScheduleCreateRequest, context: AgentScheduleToolContext): Promise<ScheduledTask> {
    this.assertAcceptingWork();
    if (this.retiringOwnerSessions.has(context.sessionId)) {
      throw new Error(`Session ${context.sessionId} is closing and cannot own a scheduled task.`);
    }
    const definition = resolveScheduledTaskDefinition({
      ...request,
      schedule: request.schedule,
      timeZone: request.timeZone,
      now: this.timestamp(),
    });
    const executionMode = request.executionMode ?? AgentScheduledTaskExecutionModes.AtDueTime;
    if (executionMode === AgentScheduledTaskExecutionModes.ExecuteNowDeliverAt && definition.type !== "once") {
      throw new Error("Immediate execution with deferred delivery requires a one-time schedule.");
    }
    const model = resolveConfiguredModel(this.options.config(), request.modelProviderId ?? context.modelProviderId);
    const enabled = request.enabled ?? true;
    if (executionMode === AgentScheduledTaskExecutionModes.ExecuteNowDeliverAt && !enabled) {
      throw new Error("Immediate execution with deferred delivery must be enabled when it is created.");
    }
    const createdAt = this.timestamp();
    const candidate: AgentScheduledTaskRecord = {
      id: createOpaqueId("scheduledtask"),
      sessionId: context.sessionId,
      sourceRequestId: context.requestId,
      executionMode,
      timeZone: request.timeZone ?? DefaultAgentTimeZone,
      target: request.target ?? "this_session",
      ...(request.target === "new_once" ? { targetSessionId: createOpaqueId("scheduled_session") } : {}),
      ...(request.name ? { name: request.name } : {}),
      ...(request.description ? { description: request.description } : {}),
      prompt: request.prompt,
      ...definition,
      enabled,
      model: {
        provider: model.Id,
        model: model.Model,
        reasoning: model.Capabilities?.Reasoning,
      },
      toolPolicyProfile: AgentScheduledTaskToolPolicyProtocol.type,
      workspaceDir: this.options.workspaceRoot,
      ...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {}),
      createdAt,
      updatedAt: createdAt,
      nextRunAt: resolveNextRunAt({ ...definition, timeZone: request.timeZone, enabled }, createdAt),
      runCount: 0,
      runHistory: [],
    };
    if (candidate.enabled && !candidate.nextRunAt) throw new Error("The schedule has no future occurrence.");
    const task = await this.options.store.createAuthorized(
      candidate satisfies ScheduledTaskCreateInput & AgentScheduledTaskRecord,
      resolveToolCeiling(request.allowedToolNames, context),
    );
    if (executionMode === AgentScheduledTaskExecutionModes.ExecuteNowDeliverAt) {
      if (!task.nextRunAt) throw new Error(`Scheduled task ${task.id} has no delivery time.`);
      this.options.store.enqueueImmediate(task.id, createdAt, task.nextRunAt);
    }
    await this.emitTaskChanged("created", task);
    void this.tick();
    return task;
  }

  async update(
    taskId: string,
    request: AgentScheduleUpdateRequest,
    context: AgentScheduleToolContext,
  ): Promise<ScheduledTask | undefined> {
    this.assertAcceptingWork();
    const tools =
      request.allowedToolNames === undefined ? undefined : resolveToolCeiling(request.allowedToolNames, context);
    const updated = this.options.store.editAuthorized(
      taskId,
      context.sessionId,
      (current) => {
        const model = request.modelProviderId
          ? resolveConfiguredModel(this.options.config(), request.modelProviderId)
          : undefined;
        const requestedType = request.type ?? current.type;
        const scheduleDefinition =
          request.type || request.schedule || request.timeZone
            ? resolveScheduledTaskDefinition({
                type: requestedType,
                schedule: request.schedule ?? current.schedule,
                timeZone: request.timeZone ?? current.timeZone,
                now: this.timestamp(),
              })
            : undefined;
        const executionMode = resolveAgentScheduledTaskExecutionMode(current);
        if (
          executionMode === AgentScheduledTaskExecutionModes.ExecuteNowDeliverAt &&
          (scheduleDefinition?.type ?? current.type) !== "once"
        ) {
          throw new Error("Immediate execution with deferred delivery requires a one-time schedule.");
        }
        if (
          executionMode === AgentScheduledTaskExecutionModes.ExecuteNowDeliverAt &&
          request.enabled === true &&
          !current.enabled
        ) {
          throw new Error("A deferred task cannot be re-enabled after it has been stopped. Create a new task instead.");
        }
        const updatedAt = this.timestamp();
        const patch: ScheduledTaskUpdate = {
          ...(request.name !== undefined ? { name: request.name } : {}),
          ...(request.description !== undefined ? { description: request.description } : {}),
          ...(request.prompt !== undefined ? { prompt: request.prompt } : {}),
          ...(request.timeZone ? { timeZone: request.timeZone } : {}),
          ...(scheduleDefinition ?? {}),
          ...(request.enabled !== undefined ? { enabled: request.enabled } : {}),
          ...(model
            ? { model: { provider: model.Id, model: model.Model, reasoning: model.Capabilities?.Reasoning } }
            : {}),
          ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
        };
        const candidate = { ...current, ...patch, updatedAt } as AgentScheduledTaskRecord;
        const reschedule = scheduleDefinition !== undefined || request.enabled !== undefined;
        const next = reschedule ? { ...candidate, nextRunAt: resolveNextRunAt(candidate, updatedAt) } : candidate;
        if (reschedule && next.enabled && !next.nextRunAt) throw new Error("The schedule has no future occurrence.");
        return next;
      },
      tools,
    );
    if (!updated) return undefined;
    await this.emitTaskChanged("updated", updated);
    void this.tick();
    return updated;
  }

  async delete(taskId: string, ownerSessionId: string): Promise<boolean> {
    this.assertAcceptingWork();
    const current = this.getOwned(taskId, ownerSessionId);
    if (!current) return false;
    const removed = await this.options.store.delete(taskId);
    if (removed) {
      // Remove the durable task first so a concurrent scheduler tick cannot
      // claim another run, then settle any execution already admitted.
      const active = [...this.activeRuns.values()].filter((run) => run.taskId === taskId);
      for (const run of active) {
        run.controller.abort(new AgentScheduledTaskRecoveryInterruption("Scheduled task was deleted."));
      }
      await Promise.allSettled(active.map((run) => this.options.dispatcher.cancel(run.sessionId)));
      await Promise.allSettled(active.map((run) => run.completion));
      await this.options.events.emit({
        kind: AgentEventKinds.ScheduledTaskChanged,
        context: { sessionId: ownerSessionId },
        data: { taskId, operation: "deleted" },
      });
    }
    return removed;
  }

  async runNow(taskId: string, ownerSessionId: string): Promise<ScheduledTask | undefined> {
    this.assertAcceptingWork();
    const current = this.getOwned(taskId, ownerSessionId);
    if (!current) return undefined;
    if (resolveAgentScheduledTaskExecutionMode(current) === AgentScheduledTaskExecutionModes.ExecuteNowDeliverAt) {
      if (this.options.store.hasOutstandingRun(current.id)) {
        throw new Error("This deferred task has already been scheduled for execution or delivery.");
      }
      throw new Error("Deferred tasks execute when created. Create a new task to run the work again.");
    }
    this.enqueueImmediateRun(current);
    void this.tick();
    return current;
  }

  async list(ownerSessionId: string): Promise<AgentScheduledTaskRecord[]> {
    return (await this.options.store.list()).filter((task) => task.sessionId === ownerSessionId);
  }

  /** Ends every scheduled lifecycle owned by a session before that session is deleted. */
  async removeOwnerSession(ownerSessionId: string): Promise<number> {
    this.retiringOwnerSessions.add(ownerSessionId);
    const tasks = await this.list(ownerSessionId);
    if (tasks.length === 0) return 0;

    const taskIds = new Set(tasks.map((task) => task.id));
    const active = [...this.activeRuns.values()].filter((run) => taskIds.has(run.taskId));
    for (const run of active) {
      run.controller.abort(new AgentScheduledTaskRecoveryInterruption("Scheduled-task owner session is closing."));
    }
    await Promise.allSettled(active.map((run) => this.options.dispatcher.cancel(run.sessionId)));
    await Promise.all(active.map((run) => run.completion));

    const removals = await Promise.all(tasks.map((task) => this.options.store.delete(task.id)));
    return removals.filter(Boolean).length;
  }

  get(taskId: string, ownerSessionId: string): Promise<AgentScheduledTaskRecord | undefined> {
    return Promise.resolve(this.getOwned(taskId, ownerSessionId));
  }

  view(taskId: string, ownerSessionId: string, limit = 20, before?: string) {
    const task = this.options.store.definition(taskId);
    if (!task || task.sessionId !== ownerSessionId) return undefined;
    return { task, ...this.options.store.receiptHistory(taskId, ownerSessionId, limit, before) };
  }

  async status(): Promise<{
    readonly active: boolean;
    readonly taskCount: number;
    readonly runningTaskIds: string[];
    readonly pendingDeliveryCount: number;
    readonly recoveryMode: "database_claim";
  }> {
    const tasks = await this.options.store.list();
    return {
      active: this.active,
      taskCount: tasks.length,
      runningTaskIds: [...this.activeRuns.values()].map((active) => active.taskId),
      pendingDeliveryCount: this.options.store.pendingDeliveryCount(),
      recoveryMode: "database_claim",
    };
  }

  private tick(): Promise<void> {
    return (this.tickPromise ??= this.runTick().finally(() => {
      this.tickPromise = undefined;
    }));
  }

  private async runTick(): Promise<void> {
    if (!this.active) return;
    try {
      const now = this.timestamp();
      const claims = this.options.store.claimDue({
        now,
        claimUntil: this.claimDeadline(now),
        maximum: this.claimBatchSize,
        nextRunAt: resolveNextRunAt,
      });
      for (const claim of claims) {
        const admission = this.runnable
          .add(() => this.executeClaim(claim))
          .catch(async (error: unknown) => {
            await this.options.events.emit({
              kind: AgentEventKinds.SchedulerStatusSnapshot,
              context: {},
              data: {
                active: this.active,
                taskCount: (await this.options.store.list()).length,
                runningTaskIds: [...this.activeRuns.values()].map((run) => run.taskId),
                recoveryMode: "database_claim",
                error: error instanceof Error ? error.message : String(error),
              },
            });
          })
          .finally(() => {
            this.admissions.delete(admission);
          });
        this.admissions.add(admission);
      }
      await this.deliverCompletedRuns();
    } catch (error) {
      await this.options.events.emit({
        kind: AgentEventKinds.SchedulerStatusSnapshot,
        context: {},
        data: {
          active: this.active,
          taskCount: (await this.options.store.list()).length,
          runningTaskIds: [...this.activeRuns.values()].map((active) => active.taskId),
          recoveryMode: "database_claim",
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private enqueueImmediateRun(task: AgentScheduledTaskRecord): void {
    const now = this.timestamp();
    // Immediate work uses the same durable due-run path. A tiny transaction is
    // intentionally kept in the store so process races cannot double-dispatch.
    this.options.store.enqueueImmediate(task.id, now, now);
  }

  private async deliverInstruction(claim: AgentScheduledTaskRunClaim): Promise<void> {
    const { task, run } = claim;
    if (!run.claimId) return;
    try {
      const tools = this.options.store.allowedToolNames(task.id);
      if (!tools) throw new Error("Scheduled instructions require a persisted tool authorization ceiling.");
      const instruction = run.instructionPrompt === undefined ? task : { ...task, prompt: run.instructionPrompt };
      const outcome = await this.instructions.admit(instruction, run, tools);
      if (outcome === "missing") {
        this.options.store.completeFailure(
          run.id,
          run.claimId,
          "Scheduled instruction owner session no longer exists.",
          this.timestamp(),
        );
        return;
      }
      if (!this.options.store.definition(task.id)) return;
      this.options.store.completeAdmission(run.id, run.claimId, this.timestamp());
      await this.emitTaskRun(
        AgentEventKinds.ScheduledTaskRunCompleted,
        task,
        run.id,
        task.target === "new_once"
          ? task.targetSessionId!
          : task.target === "new"
            ? run.executionSessionId
            : task.sessionId,
        "success",
      );
    } catch (error) {
      // An unacknowledged claim remains retryable. The session inbox deduplicates
      // run.id if a crash separated durable admission from this receipt.
      this.options.store.releaseExecutionClaim(run.id, run.claimId, this.timestamp());
      throw error;
    }
  }

  private async executeClaim(claim: AgentScheduledTaskRunClaim): Promise<void> {
    if (!this.active || !this.acceptingWork) {
      if (claim.run.claimId)
        this.options.store.releaseExecutionClaim(claim.run.id, claim.run.claimId, this.timestamp());
      return;
    }
    if (resolveAgentScheduledTaskExecutionMode(claim.task) === AgentScheduledTaskExecutionModes.AtDueTime) {
      await this.deliverInstruction(claim);
      return;
    }
    if (this.retiringOwnerSessions.has(claim.task.sessionId)) {
      await this.options.store.delete(claim.task.id);
      return;
    }
    const run = claim.run;
    if (!run.claimId || this.activeRuns.has(run.id)) return;
    const controller = new AbortController();
    const marked = this.options.store.markRunning(
      run.id,
      run.claimId,
      this.claimDeadline(this.timestamp()),
      this.timestamp(),
    );
    if (!marked) return;
    let complete!: () => void;
    const completion = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const active: ActiveScheduledRun = {
      taskId: claim.task.id,
      sessionId: marked.executionSessionId,
      claimId: run.claimId,
      controller,
      renewal: this.startClaimRenewal(marked.id, run.claimId, controller),
      completion,
      complete,
    };
    this.activeRuns.set(marked.id, active);
    const projectToOwner = shouldProjectScheduledRunToOwner(claim.task);
    if (projectToOwner) {
      await this.emitOwnerRunStarted(claim.task, marked.id);
      await this.emitTaskRun(
        AgentEventKinds.ScheduledTaskRunStarted,
        claim.task,
        marked.id,
        marked.executionSessionId,
        "running",
      );
    }
    const timeout = claim.task.timeoutMs
      ? setTimeout(
          () => controller.abort(new Error(`Scheduled task exceeded its ${claim.task.timeoutMs} ms timeout.`)),
          claim.task.timeoutMs,
        )
      : undefined;
    timeout?.unref();
    try {
      const sourceRequestId = await this.resolveSourceRequestId(claim.task, marked);
      if (!sourceRequestId) {
        throw new Error(`Scheduled task ${claim.task.id} has no forkable source conversation.`);
      }
      const result = await this.options.dispatcher.dispatch({
        sessionId: marked.executionSessionId,
        requestId: createRequestId(),
        input: run.instructionPrompt ?? claim.task.prompt,
        approvalMode: AgentExecutionApprovalModes.Agent,
        modelProviderId: claim.task.model.provider,
        allowedToolNames: this.options.store.allowedToolNames(claim.task.id),
        contextMode: AgentRunContextModes.Fork,
        parent: { sessionId: claim.task.sessionId, requestId: sourceRequestId },
        sessionOwnership: { type: "scheduled_run", taskId: claim.task.id },
        scope: this.executionScope(claim.task, marked.id),
        ...(projectToOwner ? { onEvent: (event) => this.relayExecutionEvent(claim.task, marked.id, event) } : {}),
        signal: controller.signal,
      });
      const completed = this.options.store.completeSuccess(
        marked.id,
        run.claimId,
        result.finalAnswer,
        this.timestamp(),
      );
      if (completed && projectToOwner) {
        await this.emitTaskRun(
          AgentEventKinds.ScheduledTaskRunCompleted,
          claim.task,
          completed.id,
          completed.executionSessionId,
          "success",
        );
      }
      if (completed) void this.tick();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isRecoverableClaimInterruption(controller.signal)) {
        this.options.store.releaseExecutionClaim(marked.id, run.claimId, this.timestamp());
      } else {
        const completed = this.options.store.completeFailure(marked.id, run.claimId, message, this.timestamp());
        if (completed && projectToOwner) {
          await this.emitTaskRun(
            AgentEventKinds.ScheduledTaskRunFailed,
            claim.task,
            completed.id,
            completed.executionSessionId,
            "error",
            message,
          );
          await this.emitOwnerRunFailed(claim.task, completed.id, message);
        }
      }
    } finally {
      if (timeout) clearTimeout(timeout);
      clearInterval(active.renewal);
      this.activeRuns.delete(marked.id);
      active.complete();
      await this.options.executionSessions.dispose(marked.executionSessionId).catch(() => undefined);
    }
  }

  private startClaimRenewal(runId: string, claimId: string, controller: AbortController): NodeJS.Timeout {
    const intervalMs = Math.max(1_000, Math.floor(this.options.claimDurationMs / 3));
    const renewal = setInterval(() => {
      const now = this.timestamp();
      if (!this.options.store.renewClaim(runId, claimId, this.claimDeadline(now), now)) {
        controller.abort(new AgentScheduledTaskRecoveryInterruption("Scheduled-task execution claim was lost."));
      }
    }, intervalMs);
    renewal.unref();
    return renewal;
  }

  private async deliverCompletedRuns(): Promise<void> {
    const now = this.timestamp();
    for (const claim of this.options.store.claimPendingDeliveries(now, this.claimDeadline(now), this.claimBatchSize)) {
      const outcome = await this.options.delivery.deliver({
        deliveryId: claim.run.id,
        taskId: claim.task.id,
        sessionId: claim.task.sessionId,
        content: claim.run.result ?? claim.run.error ?? "Scheduled task completed.",
        createdAt: claim.run.completedAt ?? now,
      });
      if (outcome === "delivered" || outcome === "missing") {
        const deliveredAt = this.timestamp();
        if (
          this.options.store.markDelivered(claim.run.id, claim.claimId, deliveredAt) &&
          outcome === "delivered" &&
          shouldProjectScheduledRunToOwner(claim.task)
        ) {
          await this.emitOwnerRunCompleted(claim.task, claim.run.id);
        }
      } else {
        this.options.store.releaseDelivery(claim.run.id, claim.claimId, "Owner session is busy.", this.timestamp());
      }
    }
  }

  private async resolveSourceRequestId(
    task: AgentScheduledTaskRecord,
    run: AgentScheduledTaskRunClaim["run"],
  ): Promise<string | undefined> {
    const sourceRequestId =
      run.sourceRequestId ??
      task.sourceRequestId ??
      (await this.options.sourceContext.resolveForkBoundary(task.sessionId));
    if (!sourceRequestId) return undefined;
    if (run.sourceRequestId) return sourceRequestId;
    if (!run.claimId) return undefined;
    return this.options.store.assignRunSourceRequestId(run.id, run.claimId, sourceRequestId, this.timestamp())
      ?.sourceRequestId;
  }

  private relayExecutionEvent(task: AgentScheduledTaskRecord, runId: string, event: AgentDomainEvent): Promise<void> {
    if (isPrivateScheduledForkEvent(event.kind)) return Promise.resolve();
    return this.options.events.emit(
      withEventContext(event, {
        sessionId: task.sessionId,
        requestId: runId,
        scope: this.executionScope(task, runId),
      }),
    );
  }

  private executionScope(task: AgentScheduledTaskRecord, runId: string) {
    return {
      parentSessionId: task.sessionId,
      parentRequestId: runId,
      workflowName: task.name ?? "scheduled-task",
      jobId: runId,
      role: "merge" as const,
    };
  }

  private emitOwnerRunStarted(task: AgentScheduledTaskRecord, runId: string): Promise<void> {
    return this.options.events.emit(
      withEventContext(
        {
          kind: AgentEventKinds.RunStarted,
          context: { requestId: runId },
          data: { input: task.prompt, approvalMode: AgentExecutionApprovalModes.Agent },
        },
        { sessionId: task.sessionId },
      ),
    );
  }

  private emitOwnerRunCompleted(task: AgentScheduledTaskRecord, runId: string): Promise<void> {
    return this.options.events.emit(
      withEventContext(
        {
          kind: AgentEventKinds.RunCompleted,
          context: { requestId: runId },
          data: {},
        },
        { sessionId: task.sessionId },
      ),
    );
  }

  private emitOwnerRunFailed(task: AgentScheduledTaskRecord, runId: string, message: string): Promise<void> {
    return this.options.events.emit({
      kind: AgentEventKinds.RunFailed,
      context: { sessionId: task.sessionId, requestId: runId },
      data: { message },
    });
  }

  private getOwned(taskId: string, ownerSessionId: string): AgentScheduledTaskRecord | undefined {
    const task = this.options.store.definition(taskId);
    return task?.sessionId === ownerSessionId ? task : undefined;
  }

  private emitTaskChanged(operation: "created" | "updated", task: AgentScheduledTaskRecord): Promise<void> {
    return this.options.events.emit({
      kind: AgentEventKinds.ScheduledTaskChanged,
      context: { sessionId: task.sessionId },
      data: {
        taskId: task.id,
        operation,
        enabled: task.enabled,
        ...(task.nextRunAt ? { nextRunAt: task.nextRunAt } : {}),
      },
    });
  }

  private emitTaskRun(
    kind:
      | typeof AgentEventKinds.ScheduledTaskRunStarted
      | typeof AgentEventKinds.ScheduledTaskRunCompleted
      | typeof AgentEventKinds.ScheduledTaskRunFailed,
    task: AgentScheduledTaskRecord,
    runId: string,
    sessionId: string,
    status: "running" | "success" | "error",
    error?: string,
  ): Promise<void> {
    return this.options.events.emit({
      kind,
      context: { sessionId: task.sessionId, scope: { workflowName: task.name ?? "scheduled-task", jobId: runId } },
      data: { taskId: task.id, runId, sessionId, status, ...(error ? { error } : {}) },
    });
  }

  private async emitSchedulerStatus(): Promise<void> {
    const status = await this.status();
    await this.options.events.emit({
      kind: AgentEventKinds.SchedulerStatusSnapshot,
      context: {},
      data: status,
    });
  }

  private async reconcileOwnerSessions(): Promise<void> {
    const ownerSessionIds = new Set((await this.options.store.list()).map((task) => task.sessionId));
    for (const sessionId of ownerSessionIds) {
      if (!(await this.options.sourceContext.sessionExists(sessionId))) {
        await this.removeOwnerSession(sessionId);
      }
    }
  }

  private async stopRuntime(): Promise<void> {
    this.active = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    // Shutdown owns cleanup; startup and tick callers retain their original failures.
    await Promise.allSettled([this.startPromise, this.tickPromise]);
    const active = [...this.activeRuns.values()];
    for (const run of active)
      run.controller.abort(new AgentScheduledTaskRecoveryInterruption("Scheduler is shutting down."));
    await Promise.allSettled(
      active.map((run) => this.options.dispatcher.cancel(run.sessionId, (event) => this.options.events.emit(event))),
    );
    await Promise.all(active.map((run) => run.completion));
    await this.runnable.onIdle();
    await Promise.allSettled(this.admissions);
    await this.emitSchedulerStatus();
  }

  private claimDeadline(now: string): string {
    return new Date(new Date(now).getTime() + this.options.claimDurationMs).toISOString();
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private assertAcceptingWork(): void {
    if (!this.acceptingWork) throw new Error("Agent scheduler is shutting down and cannot accept new work.");
  }
}

interface ActiveScheduledRun {
  readonly taskId: string;
  readonly sessionId: string;
  readonly claimId: string;
  readonly controller: AbortController;
  readonly renewal: NodeJS.Timeout;
  readonly completion: Promise<void>;
  readonly complete: () => void;
}

function resolveConfiguredModel(config: AgentSystemConfig, modelProviderId: string | undefined) {
  return resolveModelProviderConfig(config, modelProviderId);
}

function resolveToolCeiling(requested: readonly string[] | undefined, context: AgentScheduleToolContext): string[] {
  const authorized = context.authorizedToolNames.filter((name) => context.registry.getTool(name));
  if (!requested) return authorized;
  const authorizedSet = new Set(authorized);
  const unavailable = requested.filter((name) => !authorizedSet.has(name));
  if (unavailable.length > 0) throw new Error(`Scheduled task requested unavailable tools: ${unavailable.join(", ")}.`);
  return authorized.filter((name) => requested.includes(name));
}

function resolveNextRunAt(
  task: Pick<ScheduledTask, "type" | "schedule" | "intervalSeconds" | "enabled"> & Pick<ScheduledTask, "timeZone">,
  now: string,
): string | undefined {
  if (!task.enabled) return undefined;
  return nextAgentScheduleOccurrence(task, now);
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer.`);
}

class AgentScheduledTaskRecoveryInterruption extends Error {}

function isRecoverableClaimInterruption(signal: AbortSignal): boolean {
  return signal.aborted && signal.reason instanceof AgentScheduledTaskRecoveryInterruption;
}

function shouldProjectScheduledRunToOwner(task: AgentScheduledTaskRecord): boolean {
  return resolveAgentScheduledTaskExecutionMode(task) === AgentScheduledTaskExecutionModes.AtDueTime;
}

/**
 * A scheduled task runs in an internal fork. Its lifecycle and history replay
 * events describe that private session rather than the owner's execution.
 */
function isPrivateScheduledForkEvent(kind: AgentDomainEvent["kind"]): boolean {
  return PrivateScheduledForkEventKinds.has(kind);
}

const PrivateScheduledForkEventKinds = new Set<AgentDomainEvent["kind"]>([
  AgentEventKinds.SessionCreated,
  AgentEventKinds.SessionSnapshot,
  AgentEventKinds.SessionClosed,
  AgentEventKinds.SessionForked,
  AgentEventKinds.SessionHistoryStarted,
  AgentEventKinds.SessionHistoryChunk,
  AgentEventKinds.SessionHistorySteps,
  AgentEventKinds.SessionRunHistoryChunk,
  AgentEventKinds.SessionHistoryCompleted,
]);
