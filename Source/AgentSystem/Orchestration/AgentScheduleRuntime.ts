import {
  PersistentTaskScheduler,
  resolveScheduledTaskDefinition,
  type ScheduledTask,
  type ScheduledTaskCreateInput,
  type ScheduledTaskRunContext,
  type ScheduledTaskUpdate,
  type SchedulerLock,
  type TaskScheduler,
} from "@amaster.ai/pi-task-scheduler";
import { createRequestId } from "../Core/AgentIds.js";
import { AgentEventKinds } from "../Events/AgentEvent.js";
import { AgentExecutionApprovalModes } from "../Safety/AgentExecutionApprovalMode.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { AgentExtensionRegistryLike } from "../Types/ToolRuntimeTypes.js";
import type { AgentOrchestrationEventRelay } from "./AgentOrchestrationEventRelay.js";
import { AgentScheduledTaskToolPolicyProtocol } from "./AgentOrchestrationProtocols.js";
import { AgentRunContextModes, type AgentRunDispatchPort } from "./AgentRunDispatchPort.js";
import type { AgentSqliteScheduledTaskStore } from "./AgentSqliteScheduledTaskStore.js";

const OrchestrationCapabilityNamespace = "orchestration.";

export interface AgentScheduleCreateRequest {
  readonly name?: string;
  readonly description?: string;
  readonly prompt: string;
  readonly type: "cron" | "once" | "interval";
  readonly schedule: string;
  readonly enabled?: boolean;
  readonly modelProviderId?: string;
  readonly allowedToolNames?: readonly string[];
  readonly timeoutMs?: number;
}

export interface AgentScheduleUpdateRequest {
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
  readonly modelProviderId?: string;
  readonly authorizedToolNames: readonly string[];
  readonly registry: AgentExtensionRegistryLike;
}

export interface AgentScheduleRuntimeOptions {
  readonly workspaceRoot: string;
  readonly config: () => AgentSystemConfig;
  readonly store: AgentSqliteScheduledTaskStore;
  readonly lock: SchedulerLock;
  readonly dispatcher: AgentRunDispatchPort;
  readonly events: AgentOrchestrationEventRelay;
  readonly lockHeartbeatMs: number;
}

export class AgentScheduleRuntime {
  private readonly scheduler: TaskScheduler;
  private readonly activeRuns = new Map<string, ActiveScheduledRun>();
  private acceptingWork = true;
  private stopPromise?: Promise<void>;

  constructor(private readonly options: AgentScheduleRuntimeOptions) {
    if (!Number.isSafeInteger(options.lockHeartbeatMs) || options.lockHeartbeatMs < 1) {
      throw new Error("Scheduler lock heartbeat must be a positive safe integer.");
    }
    this.scheduler = new PersistentTaskScheduler({
      store: options.store,
      lock: options.lock,
      runner: (task, run) => this.runScheduledTask(task, run),
      hooks: {
        onTaskStarted: ({ task, run }) => this.emitTaskRun(AgentEventKinds.ScheduledTaskRunStarted, task, run),
        onTaskCompleted: ({ task, run }) => this.emitTaskRun(AgentEventKinds.ScheduledTaskRunCompleted, task, run),
        onTaskFailed: ({ task, run, error }) =>
          this.emitTaskRun(AgentEventKinds.ScheduledTaskRunFailed, task, run, error),
        onSchedulerStarted: ({ status }) => this.emitSchedulerStatus(status),
        onSchedulerStopped: ({ status }) => this.emitSchedulerStatus(status),
      },
      lockHeartbeatMs: options.lockHeartbeatMs,
    });
  }

  start(): Promise<void> {
    this.assertAcceptingWork();
    return this.scheduler.start();
  }

  stop(): Promise<void> {
    this.acceptingWork = false;
    return (this.stopPromise ??= this.stopRuntime());
  }

  async create(request: AgentScheduleCreateRequest, context: AgentScheduleToolContext): Promise<ScheduledTask> {
    this.assertAcceptingWork();
    const definition = resolveScheduledTaskDefinition(request);
    const model = resolveConfiguredModel(this.options.config(), request.modelProviderId ?? context.modelProviderId);
    const requestedEnabled = request.enabled ?? true;
    const created = await this.scheduler.create({
      sessionId: context.sessionId,
      ...(request.name ? { name: request.name } : {}),
      ...(request.description ? { description: request.description } : {}),
      prompt: request.prompt,
      ...definition,
      enabled: false,
      model: {
        provider: model.Id,
        model: model.Model,
        reasoning: model.Capabilities?.Reasoning,
      },
      toolPolicyProfile: AgentScheduledTaskToolPolicyProtocol.type,
      workspaceDir: this.options.workspaceRoot,
      ...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {}),
    } satisfies ScheduledTaskCreateInput);
    this.options.store.setAllowedToolNames(created.id, resolveToolCeiling(request.allowedToolNames, context));
    const task = requestedEnabled ? ((await this.scheduler.update(created.id, { enabled: true })) ?? created) : created;
    await this.emitTaskChanged("created", task);
    return task;
  }

  async update(
    taskId: string,
    request: AgentScheduleUpdateRequest,
    context: AgentScheduleToolContext,
  ): Promise<ScheduledTask | undefined> {
    this.assertAcceptingWork();
    const current = await this.getOwned(taskId, context.sessionId);
    if (!current) return undefined;
    const model = request.modelProviderId
      ? resolveConfiguredModel(this.options.config(), request.modelProviderId)
      : undefined;
    const scheduleDefinition =
      request.type || request.schedule
        ? resolveScheduledTaskDefinition({
            type: request.type ?? current.type,
            schedule: request.schedule ?? current.schedule,
          })
        : undefined;
    const patch: ScheduledTaskUpdate = {
      ...(request.name !== undefined ? { name: request.name } : {}),
      ...(request.description !== undefined ? { description: request.description } : {}),
      ...(request.prompt !== undefined ? { prompt: request.prompt } : {}),
      ...(scheduleDefinition ?? {}),
      ...(request.enabled !== undefined ? { enabled: request.enabled } : {}),
      ...(model
        ? {
            model: {
              provider: model.Id,
              model: model.Model,
              reasoning: model.Capabilities?.Reasoning,
            },
          }
        : {}),
      ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
    };
    if (request.allowedToolNames) {
      this.options.store.setAllowedToolNames(taskId, resolveToolCeiling(request.allowedToolNames, context));
    }
    const updated = await this.scheduler.update(taskId, patch);
    if (!updated) return undefined;
    await this.emitTaskChanged("updated", updated);
    return updated;
  }

  async delete(taskId: string, ownerSessionId: string): Promise<boolean> {
    this.assertAcceptingWork();
    const current = await this.getOwned(taskId, ownerSessionId);
    if (!current) return false;
    const removed = await this.scheduler.delete(taskId);
    if (removed) {
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
    const current = await this.getOwned(taskId, ownerSessionId);
    return current ? this.scheduler.runNow(taskId) : undefined;
  }

  async list(ownerSessionId: string): Promise<ScheduledTask[]> {
    return (await this.scheduler.list()).filter((task) => task.sessionId === ownerSessionId);
  }

  get(taskId: string, ownerSessionId: string): Promise<ScheduledTask | undefined> {
    return this.getOwned(taskId, ownerSessionId);
  }

  status() {
    return this.scheduler.status();
  }

  private async getOwned(taskId: string, ownerSessionId: string): Promise<ScheduledTask | undefined> {
    const task = await this.scheduler.get(taskId);
    return task?.sessionId === ownerSessionId ? task : undefined;
  }

  private emitTaskChanged(operation: "created" | "updated", task: ScheduledTask): Promise<void> {
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
    task: ScheduledTask,
    run: { readonly historyEntryId: string; readonly sessionId: string },
    error?: string,
  ): Promise<void> {
    const status =
      kind === AgentEventKinds.ScheduledTaskRunStarted
        ? "running"
        : kind === AgentEventKinds.ScheduledTaskRunCompleted
          ? "success"
          : "error";
    const emitted = this.options.events.emit({
      kind,
      context: {
        sessionId: task.sessionId,
        scope: { workflowName: task.name ?? "scheduled-task", jobId: run.historyEntryId },
      },
      data: {
        taskId: task.id,
        runId: run.historyEntryId,
        sessionId: run.sessionId,
        status,
        ...(error ? { error } : {}),
      },
    });
    if (status !== "running") {
      const active = this.activeRuns.get(run.historyEntryId);
      active?.complete();
      this.activeRuns.delete(run.historyEntryId);
    }
    return emitted;
  }

  private emitSchedulerStatus(status: Awaited<ReturnType<TaskScheduler["status"]>>): Promise<void> {
    return this.options.events.emit({
      kind: AgentEventKinds.SchedulerStatusSnapshot,
      context: {},
      data: {
        active: status.active,
        taskCount: status.taskCount,
        runningTaskIds: status.runningTaskIds,
        leaseAcquired: status.lock.acquired,
      },
    });
  }

  private async runScheduledTask(task: ScheduledTask, run: ScheduledTaskRunContext): Promise<void> {
    this.assertAcceptingWork();
    const controller = new AbortController();
    let complete!: () => void;
    const completion = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const active: ActiveScheduledRun = {
      controller,
      sessionId: run.sessionId,
      completion,
      complete,
    };
    this.activeRuns.set(run.historyEntryId, active);
    const timeout = task.timeoutMs
      ? setTimeout(
          () => controller.abort(new Error(`Scheduled task exceeded its ${task.timeoutMs} ms timeout.`)),
          task.timeoutMs,
        )
      : undefined;
    timeout?.unref();
    try {
      await this.options.dispatcher.dispatch({
        sessionId: run.sessionId,
        requestId: createRequestId(),
        input: task.prompt,
        approvalMode: AgentExecutionApprovalModes.Agent,
        modelProviderId: task.model.provider,
        allowedToolNames: this.options.store.allowedToolNames(task.id),
        contextMode: AgentRunContextModes.Fresh,
        scope: {
          workflowName: task.name ?? "scheduled-task",
          jobId: run.historyEntryId,
        },
        onEvent: (event) => this.options.events.emit(event),
        signal: controller.signal,
      });
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private async stopRuntime(): Promise<void> {
    await this.scheduler.stop();
    const active = [...this.activeRuns.values()];
    for (const run of active) {
      run.controller.abort(new Error("Senera scheduler is shutting down."));
    }
    await Promise.allSettled(
      active.map((run) => this.options.dispatcher.cancel(run.sessionId, (event) => this.options.events.emit(event))),
    );
    await Promise.all(active.map((run) => run.completion));
  }

  private assertAcceptingWork(): void {
    if (!this.acceptingWork) throw new Error("Agent scheduler is shutting down and cannot accept new work.");
  }
}

interface ActiveScheduledRun {
  readonly controller: AbortController;
  readonly sessionId: string;
  readonly completion: Promise<void>;
  readonly complete: () => void;
}

function resolveConfiguredModel(config: AgentSystemConfig, modelProviderId: string | undefined) {
  const effectiveId = modelProviderId ?? config.DefaultModelProviderId ?? config.ModelProviders[0]?.Id;
  const model = config.ModelProviders.find((candidate) => candidate.Id === effectiveId);
  if (!model) throw new Error(`Scheduled task model does not exist: ${effectiveId ?? "<default>"}`);
  return model;
}

function resolveToolCeiling(requested: readonly string[] | undefined, context: AgentScheduleToolContext): string[] {
  const authorized = context.authorizedToolNames.filter((name) => {
    const handler = context.registry.getTool(name)?.handler;
    return handler?.kind !== "HostCapability" || !handler.capability.startsWith(OrchestrationCapabilityNamespace);
  });
  if (!requested) return authorized;
  const authorizedSet = new Set(authorized);
  const unavailable = requested.filter((name) => !authorizedSet.has(name));
  if (unavailable.length > 0) {
    throw new Error(`Scheduled task requested unavailable tools: ${unavailable.join(", ")}.`);
  }
  return authorized.filter((name) => requested.includes(name));
}
