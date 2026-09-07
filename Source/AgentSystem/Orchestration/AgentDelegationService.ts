import { AgentCancellationError, throwIfAborted } from "../Core/AgentCancellation.js";
import { createOpaqueId, createRequestId, createSessionId } from "../Core/AgentIds.js";
import { errorMessage } from "../Core/AgentErrors.js";
import {
  AgentEventKinds,
  emitAgentEvent,
  withEventContext,
  type AgentDomainEvent,
  type AgentEventSink,
} from "../Events/AgentEvent.js";
import {
  AgentChildRunMessageDirections,
  AgentChildRunMessageKinds,
  AgentChildRunStatuses,
  AgentChildRunJoinModes,
  AgentChildWorkspaceAccessModes,
  type AgentChildRunRecord,
  type AgentChildRunStatus,
  type AgentChildWorkspaceAccessMode,
  type AgentChildRunJoinGroup,
} from "./AgentChildRunTypes.js";
import { AgentRunContextModes, type AgentRunContextMode } from "./AgentRunDispatchPort.js";
import { AgentRunConcurrencyGate, AgentRunPermitKinds, type AgentRunPermit } from "./AgentRunConcurrencyGate.js";
import {
  AgentSubagentPreflight,
  type AgentSubagentLaunchPlan,
  type AgentSubagentPreflightPort,
} from "./AgentSubagentPreflight.js";
import {
  projectAgentChildRunControlPolicy,
  resolveAgentChildRunWaitTimeoutMs,
  resolveAgentDelegationConfiguration,
} from "./AgentOrchestrationConfig.js";
import {
  AgentSubagentRoleCatalog,
  type AgentSubagentRoleCatalogPort,
  type AgentSubagentRoleCatalogSnapshot,
} from "./AgentSubagentRoleCatalog.js";
import { resolveAgentSubagentModelPool, resolveAgentSubagentRequestedModel } from "./AgentSubagentModelPool.js";
import { AgentChildRunActivityTracker } from "./AgentChildRunActivityTracker.js";
import { AgentChildRunDeadlineController } from "./AgentChildRunDeadlineController.js";
import {
  createAgentChildRunCancellingEvent,
  createAgentChildRunDeadlineExtendedEvent,
  createAgentChildRunLifecycleEvent,
  createAgentChildRunMessageEvent,
  createAgentChildRunScope,
  createAgentChildRunSnapshotEvent,
  createAgentChildRunWrappingUpEvent,
  type AgentChildRunCancellationReason,
} from "./AgentChildRunEventFactory.js";
import { renderAgentChildRunWrapUpInstruction } from "./AgentChildRunWrapUpPrompt.js";
import {
  AgentDelegationExecutionModes,
  type AgentChildRunWaitResult,
  type AgentChildRunInputSubmission,
  type AgentDelegationContext,
  type AgentDelegationRequest,
  type AgentDelegationServiceOptions,
  type AgentSpawnRequest,
  type AgentSupervisorContactRequest,
  type AgentSupervisorContactResult,
} from "./AgentDelegationRuntimeContracts.js";
import {
  parseAgentChildRunTimestamp,
  projectAgentChildRunDeadlinePolicy,
  projectDelegationConcurrencyLimits,
  readPersistedSubagentCapabilityCeiling,
  renderSupervisorResponsePrompt,
  restoreAgentSubagentLaunchPlan,
} from "./AgentDelegationRuntimeSupport.js";
import { AgentChildRunWaitCoordinator } from "./AgentChildRunWaitCoordinator.js";
import { latestParentMessage, readChildRunId } from "./AgentDelegationEventSupport.js";
import type { AgentTodoService } from "../Todos/AgentTodoService.js";
import { AgentTodoStatuses, AgentTodoWriteSources } from "../Todos/AgentTodoTypes.js";

export { AgentDelegationExecutionModes, AgentDelegationCompletionGateway } from "./AgentDelegationRuntimeContracts.js";
export type {
  AgentDelegationContext,
  AgentDelegationCompletionPort,
  AgentDelegationExecutionMode,
  AgentDelegationRequest,
  AgentDelegationServiceOptions,
  AgentSpawnRequest,
  AgentSupervisorContactRequest,
  AgentSupervisorContactResult,
} from "./AgentDelegationRuntimeContracts.js";

interface ActiveChildRun {
  readonly controller: AbortController;
  readonly onEvent?: AgentEventSink;
  promise: Promise<AgentChildRunRecord>;
  deadline?: AgentChildRunDeadlineController;
  termination: "cancel" | "timeout" | undefined;
}

interface InitializedChildRun {
  readonly record: AgentChildRunRecord;
  readonly completion: Promise<AgentChildRunRecord>;
}

function createSpawnJoinGroup(context: AgentDelegationContext): AgentChildRunJoinGroup | undefined {
  const batch = context.parentToolBatch;
  if (!batch || batch.spawnCount < 2) return undefined;
  return {
    id: ["agent-spawn", context.parentSessionId, context.parentRequestId, batch.id]
      .map((value) => encodeURIComponent(value))
      .join(":"),
    mode: AgentChildRunJoinModes.All,
    expectedCount: batch.spawnCount,
  };
}

export class AgentDelegationService {
  private readonly preflight: AgentSubagentPreflightPort;
  private readonly roleCatalog: AgentSubagentRoleCatalogPort;
  private readonly gate: AgentRunConcurrencyGate;
  private readonly active = new Map<string, ActiveChildRun>();
  private readonly waits: AgentChildRunWaitCoordinator;
  private readonly starting = new Set<Promise<InitializedChildRun>>();
  private todoService?: AgentTodoService;
  private acceptingWork = true;
  private shutdownPromise?: Promise<void>;

  constructor(private readonly options: AgentDelegationServiceOptions) {
    this.todoService = options.todoService;
    this.roleCatalog = options.roleCatalog ?? new AgentSubagentRoleCatalog();
    this.preflight = options.preflight ?? new AgentSubagentPreflight({ roleCatalog: this.roleCatalog });
    this.gate = new AgentRunConcurrencyGate(
      projectDelegationConcurrencyLimits(resolveAgentDelegationConfiguration(options.configuration().config)),
    );
    this.waits = new AgentChildRunWaitCoordinator({
      resolveTimeout: (requestedTimeoutMs) =>
        resolveAgentChildRunWaitTimeoutMs(this.options.configuration().config, requestedTimeoutMs),
      getRun: (id, parentSessionId) => this.get(id, parentSessionId),
      getActiveCompletion: (id) => this.active.get(id)?.promise,
    });
    this.options.repository.recoverInterrupted("Senera restarted before the child run completed.");
  }

  /** Binds the durable Todo service after continuity startup has completed. */
  bindTodoService(todoService: AgentTodoService): () => void {
    if (this.todoService && this.todoService !== todoService) {
      throw new Error("A different Todo service is already bound to agent delegation.");
    }
    this.todoService = todoService;
    return () => {
      if (this.todoService === todoService) this.todoService = undefined;
    };
  }

  async spawn(request: AgentSpawnRequest, context: AgentDelegationContext): Promise<AgentChildRunRecord> {
    const role = request.agent
      ? this.roleCatalog.resolve(this.options.workspaceRoot, request.agent)
      : this.roleCatalog.resolveDefault(this.options.workspaceRoot);
    const contextMode =
      request.forkContext === undefined
        ? role.defaultContext
        : request.forkContext
          ? AgentRunContextModes.Fork
          : AgentRunContextModes.Fresh;
    const joinGroup = createSpawnJoinGroup(context);
    return this.delegate(
      {
        agent: role.id,
        task: request.task,
        ...(joinGroup ? { joinGroup } : {}),
        workspaceAccess: role.workspaceAccess,
        context: contextMode,
        executionMode: AgentDelegationExecutionModes.Detach,
      },
      context,
    );
  }

  async delegate(request: AgentDelegationRequest, context: AgentDelegationContext): Promise<AgentChildRunRecord> {
    throwIfAborted(context.signal);
    this.assertAcceptingWork();
    const initialization = this.initialize(request, context);
    this.starting.add(initialization);
    let initialized: InitializedChildRun;
    try {
      initialized = await initialization;
    } finally {
      this.starting.delete(initialization);
    }
    return request.executionMode === AgentDelegationExecutionModes.Detach ? initialized.record : initialized.completion;
  }

  roleCatalogSnapshot(): AgentSubagentRoleCatalogSnapshot {
    return this.roleCatalog.snapshot(this.options.workspaceRoot);
  }

  private async initialize(
    request: AgentDelegationRequest,
    context: AgentDelegationContext,
  ): Promise<InitializedChildRun> {
    const id = createOpaqueId("childrun");
    const configuration = this.options.configuration();
    const config = configuration.config;
    const delegationConfiguration = resolveAgentDelegationConfiguration(config);
    this.gate.updateLimits(projectDelegationConcurrencyLimits(delegationConfiguration));
    const defaults = delegationConfiguration.defaults;
    const parentDepth = this.readParentDepth(context.parentSessionId);
    const maxDepth = delegationConfiguration.execution.maxDepth;
    if (maxDepth != null && parentDepth >= maxDepth) {
      throw new Error(`Subagent delegation depth ${parentDepth + 1} exceeds the configured maximum of ${maxDepth}.`);
    }
    this.assertWorkspaceAccessWithinParent(request.workspaceAccess, context.parentSessionId);
    const parentRun = this.options.repository.getByChildSession(context.parentSessionId);
    const ownerRunId = request.ownerRunId ?? parentRun?.ownerRunId ?? context.parentRequestId;
    const nodeId = request.nodeId ?? id;
    const existing = this.options.repository.getByOwnerNode(ownerRunId, nodeId);
    if (existing) {
      if (existing.parentSessionId !== context.parentSessionId) {
        throw new Error(`Child node '${nodeId}' is already owned by another parent run.`);
      }
      return {
        record: existing,
        completion: this.wait(existing.id, context.parentSessionId, context.signal).then(
          (resolved) => resolved ?? existing,
        ),
      };
    }
    const parentCapabilityCeiling = parentRun ? readPersistedSubagentCapabilityCeiling(parentRun) : undefined;
    const modelPool = resolveAgentSubagentModelPool(config, context.parentModelProviderId);
    const modelSelection = resolveAgentSubagentRequestedModel(modelPool, request.modelProviderId);
    const configurationRevision = configuration.revision;
    const deadline = projectAgentChildRunDeadlinePolicy(delegationConfiguration.execution.deadline);
    const control = projectAgentChildRunControlPolicy(delegationConfiguration.execution.control);
    const plan = await this.preflight.resolve({
      runId: id,
      agent: request.agent,
      task: request.task,
      context: request.context,
      workspaceRoot: this.options.workspaceRoot,
      modelPool,
      parentModelProviderId: context.parentModelProviderId,
      parentThinkingLevel: context.parentThinkingLevel,
      requestedModelProviderId: modelSelection.modelProviderId,
      requestedModelSelectionSource: modelSelection.source,
      requestedThinking: request.thinking,
      configuredSkillNames: defaults.skills,
      configuredThinkingLevel: defaults.thinkingLevel === "inherit" ? undefined : defaults.thinkingLevel,
      requestedSkillNames: request.skills,
      inheritedSkills: context.activeSkills,
      authorizedToolNames: context.authorizedToolNames,
      inheritedCapabilityCeiling: parentCapabilityCeiling,
      registry: context.registry,
      workspaceAccess: request.workspaceAccess,
    });
    if (plan.workspaceAccess !== request.workspaceAccess) {
      throw new Error("Subagent preflight changed the requested workspace access contract.");
    }
    throwIfAborted(context.signal);
    this.assertAcceptingWork();
    let record: AgentChildRunRecord;
    try {
      record = this.options.repository.create({
        id,
        ownerRunId,
        nodeId,
        ...(request.joinGroup ? { joinGroup: request.joinGroup } : {}),
        parentSessionId: context.parentSessionId,
        parentRequestId: context.parentRequestId,
        childSessionId: createSessionId(),
        childRequestId: createRequestId(),
        agentName: plan.launchContract.role.id,
        task: request.task,
        contextMode: plan.launchContract.context,
        approvalMode: context.approvalMode,
        ...(plan.model.selectedModelProviderId ? { modelProviderId: plan.model.selectedModelProviderId } : {}),
        ...(plan.model.selectionSource ? { modelSelectionSource: plan.model.selectionSource } : {}),
        selectedSkills: plan.pinnedSkills,
        ...(configurationRevision !== undefined ? { configurationRevision } : {}),
        launchContractDigest: plan.launchContract.launchContractDigest,
        launchContract: { ...plan.launchContract, executionMode: request.executionMode } as unknown as Record<
          string,
          unknown
        >,
        allowedToolNames: plan.allowedToolNames,
        executionContract: {
          version: 5,
          workspaceAccess: request.workspaceAccess,
          promptLayer: plan.promptLayer,
          modelCandidateProviderIds: plan.model.candidateModelProviderIds,
          ...(plan.model.thinkingLevel ? { thinkingLevel: plan.model.thinkingLevel } : {}),
          inheritProjectContext: plan.inheritProjectContext,
          ...(plan.capabilityCeiling ? { capabilityCeiling: plan.capabilityCeiling } : {}),
          deadline,
          control,
        },
      });
    } catch (error) {
      const concurrent = this.options.repository.getByOwnerNode(ownerRunId, nodeId);
      if (!concurrent) throw error;
      if (concurrent.parentSessionId !== context.parentSessionId) {
        throw new Error(`Child node '${nodeId}' is already owned by another parent run.`, { cause: error });
      }
      return {
        record: concurrent,
        completion: this.wait(concurrent.id, context.parentSessionId, context.signal).then(
          (resolved) => resolved ?? concurrent,
        ),
      };
    }
    return {
      record,
      completion: this.startExecution(
        record,
        plan,
        context,
        record.task,
        record.contextMode,
        "initial",
        request.executionMode === AgentDelegationExecutionModes.Detach,
      ),
    };
  }

  list(parentSessionId: string, parentRequestId?: string): AgentChildRunRecord[] {
    return this.options.repository.listForParent(parentSessionId, parentRequestId);
  }

  listForOwner(ownerRunId: string): AgentChildRunRecord[] {
    return this.options.repository.listForOwner(ownerRunId);
  }

  get(id: string, parentSessionId: string): AgentChildRunRecord | undefined {
    const record = this.options.repository.get(id);
    return record?.parentSessionId === parentSessionId ? record : undefined;
  }

  checkpoint(id: string, parentSessionId: string): AgentChildRunRecord["checkpoint"] | undefined {
    return this.get(id, parentSessionId)?.checkpoint;
  }

  async sendInput(
    id: string,
    parentSessionId: string,
    message: string,
    interrupt: boolean,
    context: AgentDelegationContext,
  ): Promise<AgentChildRunInputSubmission | undefined> {
    const record = this.get(id, parentSessionId);
    if (!record) return undefined;
    if (record.status === AgentChildRunStatuses.AwaitingSupervisor) {
      const active = this.active.get(id);
      if (active) await active.promise;
      const resumed = await this.resume(id, parentSessionId, message, context, AgentDelegationExecutionModes.Detach);
      if (!resumed) return undefined;
      const submission = latestParentMessage(resumed);
      if (!submission) throw new Error(`Child run ${id} resumed without recording its parent input.`);
      return { run: resumed, message: submission };
    }
    if (!this.active.has(id)) return undefined;
    const accepted = interrupt
      ? await this.options.dispatcher.steer?.(record.childSessionId, message, context.onEvent)
      : await this.options.dispatcher.followUp?.(record.childSessionId, message, context.onEvent);
    // The child can settle between the active-map check and the dispatcher
    // lookup. That is a normal lifecycle boundary, not a tool execution
    // failure. Returning the latest state gives Pi a terminal tool result and
    // lets the model decide whether a resume or wait is appropriate.
    if (!accepted) return undefined;
    const submission = this.options.repository.appendMessage({
      id: createOpaqueId("childmsg"),
      childRunId: id,
      direction: AgentChildRunMessageDirections.ParentToChild,
      kind: interrupt ? AgentChildRunMessageKinds.Steering : AgentChildRunMessageKinds.FollowUp,
      content: message,
    });
    // Event delivery is observability. It must not hold the control-plane
    // acknowledgement hostage behind a websocket or collector backpressure.
    void this.emit(context.onEvent, createAgentChildRunMessageEvent(record, submission)).catch(() => undefined);
    return { run: this.options.repository.get(id) ?? record, message: submission };
  }

  async resume(
    id: string,
    parentSessionId: string,
    message: string,
    context: AgentDelegationContext,
    executionMode: (typeof AgentDelegationExecutionModes)[keyof typeof AgentDelegationExecutionModes] = AgentDelegationExecutionModes.Wait,
  ): Promise<AgentChildRunRecord | undefined> {
    const record = this.get(id, parentSessionId);
    if (!record) return undefined;
    if (this.active.has(id)) throw new Error(`Child run ${id} is already active.`);
    const resumableStatuses: readonly AgentChildRunStatus[] = [
      AgentChildRunStatuses.AwaitingSupervisor,
      AgentChildRunStatuses.PartialCompleted,
      AgentChildRunStatuses.Interrupted,
      AgentChildRunStatuses.Failed,
      AgentChildRunStatuses.TimedOut,
      AgentChildRunStatuses.Completed,
      AgentChildRunStatuses.Cancelled,
    ];
    if (!resumableStatuses.includes(record.status)) {
      throw new Error(`Child run ${id} cannot be resumed from ${record.status}.`);
    }
    const response = this.options.repository.appendMessage({
      id: createOpaqueId("childmsg"),
      childRunId: id,
      direction: AgentChildRunMessageDirections.ParentToChild,
      kind: AgentChildRunMessageKinds.Response,
      content: message,
    });
    await this.emit(context.onEvent, createAgentChildRunMessageEvent(record, response));
    const resumed = this.options.repository.markResumed(id, createRequestId());
    if (!resumed) return this.get(id, parentSessionId);
    const completion = this.startExecution(
      resumed,
      restoreAgentSubagentLaunchPlan(resumed),
      context,
      renderSupervisorResponsePrompt(message),
      AgentRunContextModes.Fresh,
      "resume",
      executionMode === AgentDelegationExecutionModes.Detach,
    );
    return executionMode === AgentDelegationExecutionModes.Detach ? resumed : completion;
  }

  wait(id: string, parentSessionId: string, signal?: AbortSignal): Promise<AgentChildRunRecord | undefined> {
    return this.waits.wait(id, parentSessionId, signal);
  }

  waitAny(
    ids: readonly string[],
    parentSessionId: string,
    requestedTimeoutMs: number | undefined,
    signal?: AbortSignal,
  ): Promise<AgentChildRunWaitResult> {
    return this.waits.waitAny(ids, parentSessionId, requestedTimeoutMs, signal);
  }

  waitAll(
    ids: readonly string[],
    parentSessionId: string,
    requestedTimeoutMs: number | undefined,
    signal?: AbortSignal,
  ): Promise<AgentChildRunWaitResult> {
    return this.waits.waitAll(ids, parentSessionId, requestedTimeoutMs, signal);
  }

  async contactSupervisor(
    childSessionId: string,
    childRequestId: string,
    request: AgentSupervisorContactRequest,
    onEvent?: AgentEventSink,
  ): Promise<AgentSupervisorContactResult> {
    const record = this.options.repository.getByChildSession(childSessionId);
    if (!record || record.childRequestId !== childRequestId) {
      throw new Error("Supervisor contact is not bound to the active child request.");
    }
    if (record.status !== AgentChildRunStatuses.Running) {
      throw new Error(`Child run ${record.id} cannot contact its supervisor while ${record.status}.`);
    }
    const kind =
      request.reason === "need_decision" ? AgentChildRunMessageKinds.Decision : AgentChildRunMessageKinds.Progress;
    if (!this.active.has(record.id)) {
      throw new Error(`Child run ${record.id} has no active execution to contact its supervisor.`);
    }
    const message = this.options.repository.appendMessage({
      id: createOpaqueId("childmsg"),
      childRunId: record.id,
      direction: AgentChildRunMessageDirections.ChildToParent,
      kind,
      content: request.message,
    });
    await this.emit(onEvent, createAgentChildRunMessageEvent(record, message));
    if (request.reason === "progress_update") {
      return { run: this.options.repository.get(record.id) ?? record, message };
    }
    const waiting = this.options.repository.markAwaitingSupervisor(record.id);
    if (!waiting || waiting.status !== AgentChildRunStatuses.AwaitingSupervisor) {
      throw new Error(`Child run ${record.id} could not enter the supervisor wait state.`);
    }
    await this.emit(onEvent, createAgentChildRunLifecycleEvent(AgentEventKinds.ChildRunAwaitingSupervisor, waiting));
    return { run: waiting, message };
  }

  async cancel(
    id: string,
    parentSessionId: string,
    onEvent?: AgentEventSink,
  ): Promise<AgentChildRunRecord | undefined> {
    const record = this.get(id, parentSessionId);
    if (!record) return undefined;
    const active = this.active.get(id);
    if (!active) {
      if (record.status !== AgentChildRunStatuses.AwaitingSupervisor) return record;
      const cancelled = this.options.repository.markCancelled(record.id) ?? record;
      await this.emit(onEvent, createAgentChildRunLifecycleEvent(AgentEventKinds.ChildRunCancelled, cancelled));
      return cancelled;
    }
    await this.terminateActiveRun(
      record,
      active,
      "cancel",
      "parent_cancelled",
      new AgentCancellationError("Child run cancelled by its parent."),
      onEvent,
    );
    // AgentStop is a control-plane acknowledgement. The child remains active
    // until its Session, provider stream, and owned resources have actually
    // settled; that later transition is published as a child lifecycle event.
    return this.options.repository.get(id) ?? record;
  }

  async stop(id: string, parentSessionId: string, onEvent?: AgentEventSink): Promise<AgentChildRunRecord | undefined> {
    const previous = this.get(id, parentSessionId);
    if (!previous) return undefined;
    await this.stopRunTree(previous, new Set<string>(), onEvent);
    return this.get(id, parentSessionId) ?? previous;
  }

  snapshot(): ReturnType<AgentRunConcurrencyGate["snapshot"]> & { readonly activeRunIds: readonly string[] } {
    return { ...this.gate.snapshot(), activeRunIds: [...this.active.keys()] };
  }

  shutdown(): Promise<void> {
    this.acceptingWork = false;
    return (this.shutdownPromise ??= this.drain());
  }

  private async drain(): Promise<void> {
    await Promise.allSettled([...this.starting]);
    const active = [...this.active.entries()];
    for (const [id, run] of active) {
      const record = this.options.repository.get(id);
      if (!record) continue;
      await this.terminateActiveRun(
        record,
        run,
        "cancel",
        "shutdown",
        new AgentCancellationError("Senera is shutting down."),
        run.onEvent,
      );
    }
    await Promise.allSettled(active.map(([, run]) => run.promise));
  }

  private assertAcceptingWork(): void {
    if (!this.acceptingWork) throw new Error("Agent delegation is shutting down and cannot accept new work.");
  }

  private async stopRunTree(
    record: AgentChildRunRecord,
    visited: Set<string>,
    onEvent: AgentEventSink | undefined,
  ): Promise<void> {
    if (visited.has(record.id)) throw new Error(`Child-run graph contains a cycle at ${record.id}.`);
    visited.add(record.id);
    const descendants = this.options.repository.listForParent(record.childSessionId);
    await Promise.all(descendants.map((child) => this.stopRunTree(child, visited, onEvent)));
    await this.cancel(record.id, record.parentSessionId, onEvent);
  }

  private readParentDepth(parentSessionId: string): number {
    let depth = 0;
    let currentSessionId: string | undefined = parentSessionId;
    const visited = new Set<string>();
    while (currentSessionId) {
      if (visited.has(currentSessionId)) throw new Error("Child-run parent session graph contains a cycle.");
      visited.add(currentSessionId);
      const parentRun = this.options.repository.getByChildSession(currentSessionId);
      if (!parentRun) return depth;
      depth += 1;
      currentSessionId = parentRun.parentSessionId;
    }
    return depth;
  }

  private assertWorkspaceAccessWithinParent(requested: AgentChildWorkspaceAccessMode, parentSessionId: string): void {
    const parent = this.options.repository.getByChildSession(parentSessionId);
    if (
      parent?.executionContract.workspaceAccess === AgentChildWorkspaceAccessModes.ReadOnly &&
      requested === AgentChildWorkspaceAccessModes.ReadWrite
    ) {
      throw new Error("A read-only child run cannot delegate a workspace-writing child run.");
    }
  }

  private startExecution(
    record: AgentChildRunRecord,
    plan: AgentSubagentLaunchPlan,
    context: AgentDelegationContext,
    input: string,
    contextMode: AgentRunContextMode,
    lifecycle: "initial" | "resume",
    notifyCompletion: boolean,
  ): Promise<AgentChildRunRecord> {
    throwIfAborted(context.signal);
    if (this.active.has(record.id)) throw new Error(`Child run ${record.id} is already active.`);
    const controller = new AbortController();
    const active: ActiveChildRun = {
      controller,
      onEvent: context.onEvent,
      promise: Promise.resolve(record),
      termination: undefined,
    };
    const onParentAbort = (): void => {
      void this.terminateActiveRun(
        record,
        active,
        "cancel",
        "parent_cancelled",
        context.signal?.reason ?? new AgentCancellationError("Parent run cancelled."),
        context.onEvent,
      );
    };
    context.signal?.addEventListener("abort", onParentAbort, { once: true });
    active.promise = this.execute(
      record,
      plan,
      context,
      active,
      input,
      contextMode,
      lifecycle,
      notifyCompletion,
    ).finally(() => {
      active.deadline?.stop();
      context.signal?.removeEventListener("abort", onParentAbort);
      this.active.delete(record.id);
    });
    this.active.set(record.id, active);
    return active.promise;
  }

  private async execute(
    record: AgentChildRunRecord,
    plan: AgentSubagentLaunchPlan,
    context: AgentDelegationContext,
    active: ActiveChildRun,
    input = record.task,
    contextMode = record.contextMode,
    lifecycle: "initial" | "resume" = "initial",
    notifyCompletion = false,
  ): Promise<AgentChildRunRecord> {
    let permit: AgentRunPermit | undefined;
    let deadlineMonitor: Promise<unknown> | undefined;
    let activity: AgentChildRunActivityTracker | undefined;
    try {
      if (lifecycle === "initial") {
        await this.emit(context.onEvent, createAgentChildRunLifecycleEvent(AgentEventKinds.ChildRunQueued, record));
      }
      permit = await this.gate.acquire(
        plan.workspaceAccess === AgentChildWorkspaceAccessModes.ReadWrite
          ? AgentRunPermitKinds.WorkspaceWrite
          : AgentRunPermitKinds.ReadOnly,
        active.controller.signal,
      );
      const running = this.options.repository.markRunning(record.id);
      if (!running || running.status !== AgentChildRunStatuses.Running) return running ?? record;
      await this.emit(
        context.onEvent,
        createAgentChildRunLifecycleEvent(
          lifecycle === "initial" ? AgentEventKinds.ChildRunStarted : AgentEventKinds.ChildRunResumed,
          running,
        ),
      );
      const startedAt = parseAgentChildRunTimestamp(
        running.startedAt ?? running.updatedAt,
        `child run ${running.id} start`,
      );
      const control = running.executionContract.control;
      const todoRequired = Boolean(control?.todo.required && this.todoService);
      let todoSeedFingerprint: string | undefined;
      if (lifecycle === "initial" && todoRequired) {
        this.todoService!.write({
          sessionId: running.childSessionId,
          items: [{ id: running.id, content: running.task, status: AgentTodoStatuses.Pending }],
          merge: false,
          source: AgentTodoWriteSources.Host,
        });
        todoSeedFingerprint = this.todoService!.fingerprint(running.childSessionId);
      }
      activity = new AgentChildRunActivityTracker({
        startedAt,
        policy: running.executionContract.deadline,
        ...(control ? { control } : {}),
        ...(running.snapshot ? { initialSnapshot: running.snapshot } : {}),
      });
      if (todoRequired) {
        const currentTodo = this.todoService!.read(running.childSessionId);
        activity.setTodoState({
          planObserved: running.snapshot?.control?.todo.planObserved ?? false,
          counts: currentTodo.counts,
          items: currentTodo.items.map((item) => ({ content: item.content, status: item.status })),
        });
      }
      const childEventSink: AgentEventSink = async (event) => {
        activity?.observe(event);
        if (activity?.shouldRequestWrapUp()) {
          void active.deadline?.requestWrapUp().catch(() => undefined);
        }
        await this.emit(context.onEvent, event);
        if (activity?.shouldPersistSnapshot()) {
          await this.persistActivitySnapshot(running.id, activity, context.onEvent);
        }
      };
      await this.persistActivitySnapshot(running.id, activity, context.onEvent, true);

      const deadline = new AgentChildRunDeadlineController({
        startedAt,
        policy: running.executionContract.deadline,
        activity,
        onExtended: async (extension) => {
          await this.persistActivitySnapshot(running.id, activity!, context.onEvent, true);
          const current = this.options.repository.get(running.id);
          if (current) {
            await this.emit(context.onEvent, createAgentChildRunDeadlineExtendedEvent(current, extension));
          }
        },
        onWrapUp: async ({ hardDeadlineAt }) => {
          const wrapping = this.options.repository.markWrappingUp(running.id);
          if (!wrapping || wrapping.status !== AgentChildRunStatuses.WrappingUp) return;
          await this.persistActivitySnapshot(running.id, activity!, context.onEvent, true);
          await this.emit(context.onEvent, createAgentChildRunWrappingUpEvent(wrapping, hardDeadlineAt));
          const todoSnapshot = todoRequired ? this.todoService?.read(running.childSessionId) : undefined;
          const remainingTodo = todoSnapshot?.items
            .filter((item) => item.status === AgentTodoStatuses.Pending || item.status === AgentTodoStatuses.InProgress)
            .map((item) => ({ id: item.id, content: item.content, status: item.status }));
          await this.options.dispatcher.requestFinalAnswer(
            running.childSessionId,
            renderAgentChildRunWrapUpInstruction({
              reason: activity?.snapshot().control?.budget.limitReason ?? "deadline",
              ...(remainingTodo ? { remainingTodo } : {}),
            }),
          );
        },
        onTimedOut: async () => {
          await this.persistActivitySnapshot(running.id, activity!, context.onEvent, true);
          const current = this.options.repository.get(running.id) ?? running;
          await this.terminateActiveRun(
            current,
            active,
            "timeout",
            "deadline_exhausted",
            new Error("Child run exhausted its activity extension and wrap-up deadline."),
            context.onEvent,
          );
        },
      });
      active.deadline = deadline;
      deadlineMonitor = deadline.start().catch((error: unknown) => {
        active.controller.abort(error);
      });

      const result = await this.options.dispatcher.dispatch({
        sessionId: record.childSessionId,
        requestId: record.childRequestId,
        input,
        approvalMode: record.approvalMode,
        modelProviderId: record.modelProviderId,
        systemPromptLayer: plan.promptLayer,
        allowedToolNames: record.allowedToolNames,
        pinnedSkills: record.selectedSkills,
        thinkingLevel: plan.model.thinkingLevel,
        inheritProjectContext: plan.inheritProjectContext,
        sessionOwnership: {
          type: "child_run",
          childRunId: record.id,
          parentSessionId: record.parentSessionId,
          parentRequestId: record.parentRequestId,
          agentName: record.agentName,
        },
        contextMode,
        ...(contextMode === AgentRunContextModes.Fork
          ? {
              parent: {
                sessionId: record.parentSessionId,
                requestId: record.parentRequestId,
              },
            }
          : {}),
        scope: createAgentChildRunScope(record),
        onEvent: childEventSink,
        signal: active.controller.signal,
      });
      throwIfAborted(active.controller.signal);
      if (todoRequired) {
        const todoSnapshot = this.todoService!.read(running.childSessionId);
        const fingerprintChanged =
          todoSeedFingerprint !== undefined &&
          this.todoService!.fingerprint(running.childSessionId) !== todoSeedFingerprint;
        activity.setTodoState({
          planObserved:
            activity.todoPlanObserved() || fingerprintChanged || running.snapshot?.control?.todo.planObserved === true,
          counts: todoSnapshot.counts,
          items: todoSnapshot.items.map((item) => ({ content: item.content, status: item.status })),
        });
      }
      await this.persistActivitySnapshot(running.id, activity, context.onEvent, true);
      const current = this.options.repository.get(record.id);
      const todoControl = current?.executionContract.control?.todo;
      const todoSnapshot = todoRequired ? this.todoService!.read(running.childSessionId) : undefined;
      const planObserved = activity.todoPlanObserved() || current?.snapshot?.control?.todo.planObserved === true;
      const todoComplete =
        !todoRequired ||
        (planObserved &&
          todoSnapshot !== undefined &&
          todoSnapshot.counts.total >= (todoControl?.minimumItems ?? 1) &&
          todoSnapshot.counts.pending === 0 &&
          todoSnapshot.counts.inProgress === 0 &&
          todoSnapshot.counts.cancelled === 0);
      const completed =
        current?.status === AgentChildRunStatuses.AwaitingSupervisor
          ? this.options.repository.recordSupervisorCheckpoint(record.id, result)
          : result.completion === "partial" || !todoComplete
            ? this.options.repository.markPartialCompleted(record.id, result)
            : this.options.repository.markCompleted(record.id, result);
      if (!completed) throw new Error(`Child run disappeared during completion: ${record.id}`);
      if (completed.status === AgentChildRunStatuses.Completed) {
        await this.emit(
          context.onEvent,
          createAgentChildRunLifecycleEvent(AgentEventKinds.ChildRunCompleted, completed),
        );
      } else if (completed.status === AgentChildRunStatuses.PartialCompleted) {
        await this.emit(
          context.onEvent,
          createAgentChildRunLifecycleEvent(AgentEventKinds.ChildRunPartialCompleted, completed),
        );
      }
      if (notifyCompletion) this.notifyCompletion(completed);
      return completed;
    } catch (error) {
      let current = this.options.repository.get(record.id);
      if (current?.status === AgentChildRunStatuses.AwaitingSupervisor) return current;
      let executionError = error;
      if (activity) {
        try {
          await this.persistActivitySnapshot(record.id, activity, context.onEvent, true);
        } catch (snapshotError) {
          executionError = new AggregateError(
            [error, snapshotError],
            "Child run failed and its final activity snapshot could not be persisted.",
          );
        }
      }
      current = this.options.repository.get(record.id);
      const message = errorMessage(executionError);
      const partialAnswer = current?.checkpoint?.content;
      const terminal =
        active.termination === "cancel"
          ? this.options.repository.markCancelled(record.id, undefined, partialAnswer)
          : active.termination === "timeout"
            ? this.options.repository.markTimedOut(record.id, message, undefined, partialAnswer)
            : partialAnswer
              ? this.options.repository.markInterrupted(record.id, message, undefined, partialAnswer)
              : this.options.repository.markFailed(record.id, message);
      if (!terminal) throw executionError;
      const kind =
        terminal.status === AgentChildRunStatuses.Cancelled
          ? AgentEventKinds.ChildRunCancelled
          : terminal.status === AgentChildRunStatuses.TimedOut
            ? AgentEventKinds.ChildRunTimedOut
            : terminal.status === AgentChildRunStatuses.Interrupted
              ? AgentEventKinds.ChildRunInterrupted
              : AgentEventKinds.ChildRunFailed;
      await this.emit(context.onEvent, createAgentChildRunLifecycleEvent(kind, terminal));
      if (notifyCompletion) this.notifyCompletion(terminal);
      return terminal;
    } finally {
      active.deadline?.stop();
      await deadlineMonitor;
      permit?.release();
    }
  }

  private async persistActivitySnapshot(
    childRunId: string,
    activity: AgentChildRunActivityTracker,
    onEvent: AgentEventSink | undefined,
    force = false,
  ): Promise<void> {
    if (!activity.shouldPersistSnapshot(force)) return;
    const snapshot = activity.snapshot();
    const updated = this.options.repository.recordSnapshot(
      childRunId,
      snapshot,
      activity.latestCheckpoint(),
      snapshot.capturedAt,
    );
    if (updated) await this.emit(onEvent, createAgentChildRunSnapshotEvent(updated));
  }

  private async terminateActiveRun(
    record: AgentChildRunRecord,
    active: ActiveChildRun,
    termination: "cancel" | "timeout",
    reason: AgentChildRunCancellationReason,
    error: unknown,
    onEvent: AgentEventSink | undefined,
  ): Promise<void> {
    if (active.termination) return;
    active.termination = termination;
    active.deadline?.stop();
    const cancelling = this.options.repository.markCancelling(record.id);
    if (cancelling?.status === AgentChildRunStatuses.Cancelling) {
      await this.emit(onEvent, createAgentChildRunCancellingEvent(cancelling, reason));
    }
    active.controller.abort(error);
    // Stop admission is non-blocking. The active dispatch remains authoritative
    // until Session, Pi, and run-owned resources have actually settled.
    const childEventSink: AgentEventSink | undefined = onEvent
      ? (event) => this.emit(onEvent, withEventContext(event, { scope: createAgentChildRunScope(record) }))
      : undefined;
    await this.options.dispatcher.requestCancellation(record.childSessionId, childEventSink);
  }

  private emit(sink: AgentEventSink | undefined, event: AgentDomainEvent): Promise<void> {
    const childRunId = readChildRunId(event);
    return emitAgentEvent(sink ?? ((candidate) => this.options.events.emit(candidate)), event).finally(() => {
      if (!childRunId) return;
      this.waits.notify(childRunId);
    });
  }

  /**
   * Completion delivery is deliberately detached from the worker promise.
   * A channel adapter or the owning session may be unavailable temporarily;
   * the persisted child record remains the source of truth for recovery.
   */
  private notifyCompletion(record: AgentChildRunRecord): void {
    void this.options.completion?.completed(record).catch(() => undefined);
  }
}
