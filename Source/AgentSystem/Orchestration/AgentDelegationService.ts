import { AgentCancellationError, throwIfAborted } from "../Core/AgentCancellation.js";
import { AgentResourceAccessIntents } from "../Execution/SeneraResourceAccess.js";
import { resolveAgentConfiguredModelThinking } from "../ModelEndpoints/AgentModelThinking.js";
import type { AgentModelCapabilityKey } from "../Core/AgentModelCapabilityContract.js";
import { AgentOrchestrationToolNames } from "./AgentOrchestrationToolNames.js";
import { AgentKeyedLeaseQueue } from "../Core/AgentKeyedLeaseQueue.js";
import { createOpaqueId, createRequestId, createSessionId } from "../Core/AgentIds.js";
import { errorMessage } from "../Core/AgentErrors.js";
import {
  AgentEventKinds,
  emitAgentEvent,
  withEventContext,
  type AgentDomainEvent,
  type AgentEventContext,
  type AgentEventScope,
  type AgentEventSink,
} from "../Events/AgentEvent.js";
import {
  AgentChildRunMessageDirections,
  AgentChildRunMessageKinds,
  AgentChildRunStatuses,
  isAgentChildRunBackgroundCompletionDeliverable,
  isAgentChildRunSettled,
  AgentChildRunJoinModes,
  AgentChildWorkspaceAccessModes,
  type AgentChildRunRecord,
  type AgentChildRunStatus,
  type AgentChildWorkspaceAccessMode,
  type AgentChildRunJoinGroup,
} from "./AgentChildRunTypes.js";
import {
  AgentRunContextModes,
  type AgentRunContextMode,
  type AgentRunDispatchRequest,
} from "./AgentRunDispatchPort.js";
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
  AgentSpawnModes,
  type AgentChildRunWaitResult,
  type AgentChildRunInputSubmission,
  type AgentDelegationContext,
  type AgentDelegationExecutionMode,
  type AgentDelegationRequest,
  type AgentDelegationServiceOptions,
  type AgentSpawnRequest,
  type AgentSupervisorContactRequest,
  type AgentSupervisorContactResult,
} from "./AgentDelegationRuntimeContracts.js";
import type { AgentToolResourceClaimProjectorPort } from "../ToolRuntime/AgentToolResourceClaimProjector.js";
import type {
  AgentToolResourceClaimDeclaration,
  AgentToolResourceLeaseRequest,
} from "../ToolRuntime/AgentToolResourceClaimTypes.js";
import type { AgentToolResourceLeaseHandle } from "../ToolRuntime/AgentToolResourceScheduler.js";
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
import { AgentTodoChangeSources, AgentTodoStatuses, type AgentTodoItem } from "../Todos/AgentTodoTypes.js";
import { deriveAgentTaskDigest, isLegacyAgentTaskDigest, resolveAgentWorkItemId } from "./AgentWorkItemIdentity.js";
import {
  EmptyAgentDelegationPromptContext,
  projectAgentDelegationPromptContext,
  type AgentDelegationPromptContext,
} from "./AgentDelegationPromptContext.js";

export {
  AgentDelegationExecutionModes,
  AgentSpawnModes,
  AgentDelegationCompletionGateway,
} from "./AgentDelegationRuntimeContracts.js";
export type {
  AgentDelegationContext,
  AgentDelegationCompletionPort,
  AgentDelegationExecutionMode,
  AgentDelegationRequest,
  AgentDelegationServiceOptions,
  AgentSpawnMode,
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
  readonly reused: boolean;
}

type AgentActivationContext = Pick<AgentDelegationContext, "onEvent" | "signal" | "parentInvocation">;
type AgentActivationInput = Pick<
  AgentRunDispatchRequest,
  "metadata" | "attachments" | "allowedToolNames" | "executionScope"
>;

export interface AgentDelegationSpawnResult {
  readonly run: AgentChildRunRecord;
  readonly disposition: "created" | "reused";
}

export interface AgentMessageReceipt {
  readonly messageId: string;
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
  private readonly parentInvocations = new Map<string, AgentDelegationContext["parentInvocation"]>();
  private readonly waits: AgentChildRunWaitCoordinator;
  private readonly starting = new Map<Promise<InitializedChildRun>, string | undefined>();
  private readonly messageAdmissions = new AgentKeyedLeaseQueue<string>();
  private readonly activationObservers = new Set<(record: AgentChildRunRecord) => void>();
  private todoService?: Pick<AgentTodoService, "add" | "read" | "fingerprint" | "update">;
  private acceptingWork = true;
  private shutdownPromise?: Promise<void>;
  private resourceClaims?: AgentToolResourceClaimProjectorPort;
  private inbox?: (request: {
    sessionId: string;
    deliveryId: string;
    sourceId: string;
    kind: "agent_message" | "agent_completion";
    content: string;
    mode?: "steer" | "follow_up";
    onEvent?: AgentEventSink;
  }) => Promise<"accepted" | "missing">;

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
    if (this.todoService) this.reconcileParentTodos();
  }

  /** Binds the durable Todo service after continuity startup has completed. */
  bindTodoService(todoService: Pick<AgentTodoService, "add" | "read" | "fingerprint" | "update">): () => void {
    if (this.todoService && this.todoService !== todoService) {
      throw new Error("A different Todo service is already bound to agent delegation.");
    }
    this.todoService = todoService;
    this.reconcileParentTodos();
    return () => {
      if (this.todoService === todoService) this.todoService = undefined;
    };
  }

  /** Binds the runtime-owned capability projector after the runtime is composed. */
  bindResourceClaims(projector: AgentToolResourceClaimProjectorPort): () => void {
    const previous = this.resourceClaims;
    this.resourceClaims = projector;
    return () => {
      // A runtime can be rebound while a previous runtime is still winding
      // down. Only the binding that owns the current slot may clear it.
      if (this.resourceClaims === projector) this.resourceClaims = previous;
    };
  }

  resourceClaimCapabilityIds(): readonly string[] {
    return this.requireResourceClaims().listClaimCapabilityIds();
  }

  bindInbox(inbox: NonNullable<AgentDelegationService["inbox"]>): () => void {
    if (this.inbox) throw new Error("Agent inbox is already bound.");
    this.inbox = inbox;
    return () => {
      if (this.inbox === inbox) this.inbox = undefined;
    };
  }

  /** Agent identity is the persistent session, independent of its current turn. */
  async sendMessage(agentId: string, message: string, context: AgentDelegationContext): Promise<AgentMessageReceipt> {
    const release = await this.messageAdmissions.acquire(agentId, context.signal);
    try {
      // Cancellation governs admission; an accepted message belongs to the receiver.
      return await this.deliverAgentMessage(agentId, message, context);
    } finally {
      release();
    }
  }

  private async deliverAgentMessage(
    agentId: string,
    message: string,
    context: AgentDelegationContext,
  ): Promise<AgentMessageReceipt> {
    throwIfAborted(context.signal);
    if (!message.trim()) throw new Error("Agent message cannot be empty.");
    const sender = context.parentSessionId;
    const parent = this.options.repository.getByChildSession(sender);
    if (parent?.parentSessionId === agentId) {
      if (!this.inbox) throw new Error("Agent inbox is not bound.");
      const id = createOpaqueId("agentmessage");
      const accepted = await this.inbox({
        sessionId: agentId,
        deliveryId: id,
        sourceId: sender,
        kind: "agent_message",
        content: message,
        mode: "steer",
        onEvent: context.onEvent,
      });
      if (accepted !== "accepted")
        throw new Error("The parent session no longer exists; the message was not admitted.");
      return { messageId: id };
    }
    const child = this.options.repository.getByChildSession(agentId);
    if (!child || child.parentSessionId !== sender)
      throw new Error("Agent messaging requires a direct parent-child relationship.");
    const active = this.active.get(child.id);
    if (active) {
      const submission = await this.sendInput(child.id, sender, message, true, context);
      if (submission) return { messageId: submission.message.id };
      await active.promise;
    }
    throwIfAborted(context.signal);
    const resumed = await this.resume(child.id, sender, message, context, AgentDelegationExecutionModes.Detach);
    const admitted = resumed && latestParentMessage(resumed);
    if (!admitted) throw new Error("The child did not admit this message.");
    return { messageId: admitted.id };
  }

  agentParent(sessionId: string): string | undefined {
    return this.options.repository.getByChildSession(sessionId)?.parentSessionId;
  }

  observeActivations(observer: (record: AgentChildRunRecord) => void): () => void {
    for (const record of this.options.repository.listAll()) observer(record);
    this.activationObservers.add(observer);
    return () => {
      this.activationObservers.delete(observer);
    };
  }

  async interruptAgent(agentId: string, ancestorSessionId: string, onEvent?: AgentEventSink) {
    const target = this.options.repository.getByChildSession(agentId);
    if (!target) throw new Error("The agent was not found.");
    const visited = new Set<string>();
    let parent: string | undefined = target.parentSessionId;
    while (parent && parent !== ancestorSessionId) {
      if (visited.has(parent)) throw new Error("Agent session ancestry contains a cycle.");
      visited.add(parent);
      parent = this.agentParent(parent);
    }
    if (!parent) throw new Error("Only an ancestor can interrupt this agent.");
    return this.cancel(target.id, target.parentSessionId, onEvent);
  }

  async spawn(request: AgentSpawnRequest, context: AgentDelegationContext): Promise<AgentChildRunRecord> {
    return (await this.spawnWithOutcome(request, context)).run;
  }

  async spawnWithOutcome(
    request: AgentSpawnRequest,
    context: AgentDelegationContext,
  ): Promise<AgentDelegationSpawnResult> {
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
    const initialized = await this.initializeTracked(
      {
        agent: role.id,
        task: request.task,
        description: request.description,
        modelProviderId: request.modelProviderId,
        thinking: request.thinking,
        ...(request.workItemId ? { workItemId: request.workItemId } : {}),
        ...(request.todo ? { todo: request.todo } : {}),
        ...(request.resources ? { resources: request.resources } : {}),
        ...(joinGroup ? { joinGroup } : {}),
        workspaceAccess: role.workspaceAccess,
        context: contextMode,
        executionMode: executionModeForSpawnMode(request.mode),
      },
      context,
    );
    return {
      run: await initialized.completion,
      disposition: initialized.reused ? "reused" : "created",
    };
  }

  async delegate(request: AgentDelegationRequest, context: AgentDelegationContext): Promise<AgentChildRunRecord> {
    throwIfAborted(context.signal);
    this.assertAcceptingWork();
    const initialized = await this.initializeTracked(request, context);
    return request.executionMode === AgentDelegationExecutionModes.Detach ? initialized.record : initialized.completion;
  }

  promptContext(parentSessionId?: string): AgentDelegationPromptContext {
    if (!parentSessionId) return EmptyAgentDelegationPromptContext;
    return projectAgentDelegationPromptContext(this.list(parentSessionId));
  }

  private async initializeTracked(
    request: AgentDelegationRequest,
    context: AgentDelegationContext,
  ): Promise<InitializedChildRun> {
    throwIfAborted(context.signal);
    this.assertAcceptingWork();
    const parentTodo = this.resolveParentTodo(request.todo, context.parentSessionId);
    const initialization = this.initialize(request, context, parentTodo);
    this.starting.set(initialization, parentTodo?.id);
    try {
      return await initialization;
    } finally {
      this.starting.delete(initialization);
      if (parentTodo) {
        const completed = this.list(context.parentSessionId).find(
          (record) =>
            record.launchContract.parentTodoId === parentTodo.id && record.status === AgentChildRunStatuses.Completed,
        );
        if (completed) this.reconcileParentTodo(completed, context.onEvent);
      }
    }
  }

  roleCatalogSnapshot(): AgentSubagentRoleCatalogSnapshot {
    return this.roleCatalog.snapshot(this.options.workspaceRoot);
  }

  modelCatalogSnapshot() {
    const policy = resolveAgentDelegationConfiguration(this.options.configuration().config).modelPool;
    return { inheritParent: policy.inheritParent };
  }

  resourceAccessScope(sessionId: string) {
    return this.options.repository.getByChildSession(sessionId)?.executionContract.resourceAccessScope;
  }

  discoverModels(
    parentSessionId: string,
    parentModelProviderId?: string,
    filter: {
      providerId?: string;
      modelProviderId?: string;
      capabilities?: readonly AgentModelCapabilityKey[];
    } = {},
    delegationAllowed = true,
  ) {
    const config = this.options.configuration().config;
    const pool = resolveAgentSubagentModelPool(config, parentModelProviderId);
    if (filter.modelProviderId) resolveAgentSubagentRequestedModel(pool, filter.modelProviderId);
    return {
      default_model_id: pool.fallbackModelProviderId,
      ...(pool.inheritedModelProviderId ? { parent_model_id: pool.inheritedModelProviderId } : {}),
      delegation: this.delegationStatus(parentSessionId, delegationAllowed),
      models: pool.providers.flatMap((provider) => {
        if (filter.providerId && provider.ProviderId !== filter.providerId) return [];
        if (filter.modelProviderId && provider.Id !== filter.modelProviderId) return [];
        const thinking = resolveAgentConfiguredModelThinking(provider);
        const capabilities = { ...provider.Capabilities, Reasoning: thinking.reasoning };
        if (filter.capabilities?.some((capability) => !capabilities[capability])) return [];
        return [
          {
            model_id: provider.Id,
            provider_id: provider.ProviderId,
            model: provider.Model,
            capabilities,
            planning_mode: provider.ToolPlanningMode,
            context_tokens: provider.ContextWindowTokens,
            max_output_tokens: provider.MaxOutputTokens,
            thinking_levels: [...thinking.levels],
            default_thinking: thinking.defaultLevel,
            ...(provider.Pricing ? { pricing: provider.Pricing } : {}),
          },
        ];
      }),
    };
  }

  private delegationStatus(sessionId: string, delegationAllowed: boolean) {
    const policy = resolveAgentDelegationConfiguration(this.options.configuration().config);
    const depth = this.readParentDepth(sessionId);
    return {
      depth,
      max_depth: policy.execution.maxDepth ?? null,
      can_delegate: delegationAllowed && (policy.execution.maxDepth == null || depth < policy.execution.maxDepth),
      max_active_per_tree: policy.execution.maxActivePerTree,
    };
  }

  private async initialize(
    request: AgentDelegationRequest,
    context: AgentDelegationContext,
    parentTodo: AgentTodoItem | undefined,
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
    // Interactive parents have a stable session identity; a request id is an
    // execution instance and must not become the durable workflow owner.
    const ownerRunId = request.ownerRunId ?? parentRun?.ownerRunId ?? context.parentSessionId;
    const taskDigest = deriveAgentTaskDigest({
      task: request.task,
      agent: request.agent,
      ...(request.context ? { context: request.context } : {}),
      workspaceAccess: request.workspaceAccess,
      skills: request.skills,
      thinking: request.thinking,
      modelProviderId: request.modelProviderId,
      ownerRunId,
      nodeId: request.nodeId,
      workItemId: request.workItemId,
      resources: request.resources,
      parentTodoId: parentTodo?.id,
    });
    const workItemId = resolveAgentWorkItemId(
      {
        task: request.task,
        agent: request.agent,
        ...(request.context ? { context: request.context } : {}),
        workspaceAccess: request.workspaceAccess,
        skills: request.skills,
        thinking: request.thinking,
        modelProviderId: request.modelProviderId,
        ownerRunId,
        nodeId: request.nodeId,
        workItemId: request.workItemId,
        resources: request.resources,
      },
      taskDigest,
    );
    const nodeId = request.nodeId ?? workItemId;
    const existingWorkItem = this.options.repository.getByWorkItem(context.parentSessionId, workItemId);
    if (existingWorkItem) {
      if (
        existingWorkItem.taskDigest &&
        !isLegacyAgentTaskDigest(existingWorkItem.taskDigest) &&
        existingWorkItem.taskDigest !== taskDigest
      ) {
        throw new Error(
          `Work item '${workItemId}' already belongs to a different task contract. Use a new workItemId for independent work.`,
        );
      }
      return {
        record: existingWorkItem,
        completion: this.completionForExisting(existingWorkItem, context, request.executionMode),
        reused: true,
      };
    }
    const existing = this.options.repository.getByOwnerNode(ownerRunId, nodeId);
    if (existing) {
      if (existing.parentSessionId !== context.parentSessionId) {
        throw new Error(`Child node '${nodeId}' is already owned by another parent run.`);
      }
      return {
        record: existing,
        completion: this.completionForExisting(existing, context, request.executionMode),
        reused: true,
      };
    }
    const parentCapabilityCeiling = parentRun ? readPersistedSubagentCapabilityCeiling(parentRun) : undefined;
    if (parentTodo && parentTodo.status !== AgentTodoStatuses.InProgress) {
      throw new Error("The delegated Todo must be in_progress. Update the plan before spawning.");
    }
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
    const resourceRequest = await this.projectDeclaredResources(request.resources);
    let record: AgentChildRunRecord;
    try {
      this.assertActivationCapacity(ownerRunId);
      record = this.options.repository.create({
        id,
        ownerRunId,
        nodeId,
        workItemId,
        taskDigest,
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
        launchContract: {
          ...plan.launchContract,
          ...(request.description ? { label: request.description.trim() } : {}),
          executionMode: request.executionMode,
          ...(parentTodo ? { parentTodoId: parentTodo.id } : {}),
        },
        allowedToolNames: plan.allowedToolNames,
        executionContract: {
          version: 5,
          workspaceAccess: request.workspaceAccess,
          promptLayer: plan.promptLayer,
          modelCandidateProviderIds: plan.model.candidateModelProviderIds,
          ...(plan.model.thinkingLevel ? { thinkingLevel: plan.model.thinkingLevel } : {}),
          inheritProjectContext: plan.inheritProjectContext,
          ...(plan.capabilityCeiling ? { capabilityCeiling: plan.capabilityCeiling } : {}),
          ...(request.resources && request.resources.length > 0 ? { resources: request.resources } : {}),
          resourceCoverage: request.resources && request.resources.length > 0 ? "declared" : "unscoped",
          resourceAccessScope: {
            resources: [
              ...(parentRun?.executionContract.resourceAccessScope?.resources ?? []),
              ...(context.resourceAccessGrant?.resources ?? []),
            ]
              .filter(
                (resource) =>
                  request.workspaceAccess !== AgentChildWorkspaceAccessModes.ReadOnly ||
                  resource.intent !== AgentResourceAccessIntents.Execute,
              )
              .map((resource) => ({
                ...resource,
                intent:
                  request.workspaceAccess === AgentChildWorkspaceAccessModes.ReadOnly &&
                  resource.intent !== AgentResourceAccessIntents.Inspect
                    ? AgentResourceAccessIntents.Read
                    : resource.intent,
              })),
          },
          ...(resourceRequest && resourceRequest.claims.length > 0
            ? { resourceClaims: this.projectResourceClaimSummaries(resourceRequest) }
            : {}),
          deadline,
          control,
        },
      });
    } catch (error) {
      const concurrent =
        this.options.repository.getByWorkItem(context.parentSessionId, workItemId) ??
        this.options.repository.getByOwnerNode(ownerRunId, nodeId);
      if (!concurrent) throw error;
      if (concurrent.parentSessionId !== context.parentSessionId) {
        throw new Error(`Child node '${nodeId}' is already owned by another parent run.`, { cause: error });
      }
      if (
        concurrent.taskDigest &&
        !isLegacyAgentTaskDigest(concurrent.taskDigest) &&
        concurrent.taskDigest !== taskDigest
      ) {
        throw new Error(
          `Child node '${nodeId}' already belongs to a different task contract. Use a new workItemId for independent work.`,
          { cause: error },
        );
      }
      return {
        record: concurrent,
        completion: this.completionForExisting(concurrent, context, request.executionMode),
        reused: true,
      };
    }
    const completion = this.startExecution(
      record,
      plan,
      context,
      record.task,
      record.contextMode,
      "initial",
      request.executionMode === AgentDelegationExecutionModes.Detach,
      resourceRequest,
    );
    return {
      record,
      completion: this.completionForMode(record, completion, request.executionMode),
      reused: false,
    };
  }

  /**
   * Detached work is driven by the durable child record and completion port;
   * callers must not create a signal-bound waiter that can reject after the
   * tool has already returned. The execution promise is still observed so a
   * delivery/event failure cannot become an unhandled rejection.
   */
  private completionForMode(
    record: AgentChildRunRecord,
    completion: Promise<AgentChildRunRecord>,
    executionMode: AgentDelegationRequest["executionMode"],
  ): Promise<AgentChildRunRecord> {
    if (executionMode !== AgentDelegationExecutionModes.Detach) return completion;
    void completion.catch(() => undefined);
    return Promise.resolve(record);
  }

  private completionForExisting(
    record: AgentChildRunRecord,
    context: AgentDelegationContext,
    executionMode: AgentDelegationRequest["executionMode"],
  ): Promise<AgentChildRunRecord> {
    if (executionMode === AgentDelegationExecutionModes.Detach) return Promise.resolve(record);
    return this.wait(record.id, context.parentSessionId, context.signal).then((resolved) => resolved ?? record);
  }

  list(parentSessionId: string, parentRequestId?: string): AgentChildRunRecord[] {
    return this.options.repository.listForParent(parentSessionId, parentRequestId);
  }

  /** Stable preorder discovery never changes membership or grants control over descendants. */
  listAgents(parentSessionId: string, scope: "children" | "descendants" = "children") {
    const result: { run: AgentChildRunRecord; depth: number }[] = [];
    const visited = new Set([parentSessionId]);
    const pending = this.list(parentSessionId)
      .reverse()
      .map((run) => ({ run, depth: 1 }));
    while (pending.length) {
      const entry = pending.pop()!;
      if (visited.has(entry.run.childSessionId)) throw new Error("Agent session ancestry contains a cycle.");
      visited.add(entry.run.childSessionId);
      result.push(entry);
      if (scope === "descendants") {
        pending.push(
          ...this.list(entry.run.childSessionId)
            .reverse()
            .map((run) => ({ run, depth: entry.depth + 1 })),
        );
      }
    }
    return result;
  }

  /** Queued cold wakeups must acquire the same activation, resource and provider limits as delegation. */
  activateQueuedInput(
    request: Pick<AgentRunDispatchRequest, "sessionId" | "requestId" | "input"> & AgentActivationInput,
    onEvent?: AgentEventSink,
  ): { completion: Promise<void | "parked">; parked?: false } | { parked: true } | undefined {
    const child = this.options.repository.getByChildSession(request.sessionId);
    if (!child) return undefined;
    if (child.status === AgentChildRunStatuses.Cancelled) return { parked: true };
    const activation = this.messageAdmissions.run(request.sessionId, async () => {
      await this.active.get(child.id)?.promise;
      this.assertAcceptingWork();
      const current = this.options.repository.get(child.id);
      if (!current) throw new Error("Queued child session no longer has an owning run.");
      if (current.status === AgentChildRunStatuses.Cancelled) return { parked: true } as const;
      this.assertActivationCapacity(current.ownerRunId);
      const plan = restoreAgentSubagentLaunchPlan(current);
      const resumed = this.options.repository.markResumed(
        child.id,
        request.requestId,
        undefined,
        AgentDelegationExecutionModes.Detach,
      );
      if (!resumed || resumed.status !== AgentChildRunStatuses.Queued || resumed.childRequestId !== request.requestId)
        throw new Error("Queued child input could not reserve its activation.");
      const completion = this.startExecution(
        resumed,
        plan,
        { onEvent },
        request.input,
        AgentRunContextModes.Fresh,
        "resume",
        true,
        undefined,
        request,
      );
      return { completion, parked: false } as const;
    });
    return {
      completion: activation.then(async (result) => {
        if (result.parked) return "parked" as const;
        await result.completion;
      }),
    };
  }

  listForOwner(ownerRunId: string): AgentChildRunRecord[] {
    return this.options.repository.listForOwner(ownerRunId);
  }

  get(id: string, parentSessionId: string): AgentChildRunRecord | undefined {
    const record = this.options.repository.get(id);
    return record?.parentSessionId === parentSessionId ? record : undefined;
  }

  markParentResultDelivered(
    id: string,
    parentSessionId: string,
    deliveredAt?: string,
  ): AgentChildRunRecord | undefined {
    const record = this.get(id, parentSessionId);
    return record ? this.options.repository.markParentResultDelivered(id, deliveredAt) : undefined;
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
    const messageId = createOpaqueId("childmsg");
    const accepted = await this.options.dispatcher.followUp?.(
      record.childSessionId,
      message,
      context.onEvent,
      messageId,
      { hostInput: { kind: "agent_message", sourceId: parentSessionId, deliveryId: messageId } },
      interrupt ? "steer" : "follow_up",
    );
    // The child can settle between the active-map check and the dispatcher
    // lookup. That is a normal lifecycle boundary, not a tool execution
    // failure. Returning the latest state gives Pi a terminal tool result and
    // lets the model decide whether a resume or wait is appropriate.
    if (!accepted) return undefined;
    const submission = this.options.repository.appendMessage({
      id: messageId,
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
    this.assertAcceptingWork();
    this.assertActivationCapacity(record.ownerRunId);
    const response = this.options.repository.appendMessage({
      id: createOpaqueId("childmsg"),
      childRunId: id,
      direction: AgentChildRunMessageDirections.ParentToChild,
      kind: AgentChildRunMessageKinds.Response,
      content: message,
    });
    const resumed = this.options.repository.markResumed(id, createRequestId(), undefined, executionMode);
    if (!resumed) return this.get(id, parentSessionId);
    const completion = this.startExecution(
      resumed,
      restoreAgentSubagentLaunchPlan(resumed),
      context,
      record.status === AgentChildRunStatuses.AwaitingSupervisor
        ? renderSupervisorResponsePrompt(message, resumed.checkpoint)
        : message,
      AgentRunContextModes.Fresh,
      "resume",
      executionMode === AgentDelegationExecutionModes.Detach,
      undefined,
      { metadata: { hostInput: { kind: "agent_message", sourceId: parentSessionId, deliveryId: response.id } } },
    );
    void this.emit(context.onEvent, createAgentChildRunMessageEvent(resumed, response)).catch(() => undefined);
    return this.completionForMode(resumed, completion, executionMode);
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
    // Interruption is a control-plane acknowledgement. The child remains active
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
    await Promise.allSettled(this.starting.keys());
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
    context: AgentActivationContext,
    input: string,
    contextMode: AgentRunContextMode,
    lifecycle: "initial" | "resume",
    notifyCompletion: boolean,
    resourceRequest?: AgentToolResourceLeaseRequest,
    queuedInput?: AgentActivationInput,
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
    if (!notifyCompletion) context.signal?.addEventListener("abort", onParentAbort, { once: true });
    active.promise = this.execute(
      record,
      plan,
      context,
      active,
      input,
      contextMode,
      lifecycle,
      notifyCompletion,
      resourceRequest,
      queuedInput,
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
    context: AgentActivationContext,
    active: ActiveChildRun,
    input = record.task,
    contextMode = record.contextMode,
    lifecycle: "initial" | "resume" = "initial",
    notifyCompletion = false,
    resourceRequest?: AgentToolResourceLeaseRequest,
    queuedInput?: AgentActivationInput,
  ): Promise<AgentChildRunRecord> {
    if (context.parentInvocation) {
      this.parentInvocations.set(record.id, context.parentInvocation);
    } else {
      this.parentInvocations.delete(record.id);
    }
    let permit: AgentRunPermit | undefined;
    let resourceLease: AgentToolResourceLeaseHandle | undefined;
    let deadlineMonitor: Promise<unknown> | undefined;
    let activity: AgentChildRunActivityTracker | undefined;
    try {
      if (lifecycle === "initial") {
        await this.emit(context.onEvent, createAgentChildRunLifecycleEvent(AgentEventKinds.ChildRunQueued, record));
      }
      const declaredResources =
        resourceRequest ?? (await this.projectDeclaredResources(record.executionContract.resources));
      if (declaredResources && declaredResources.claims.length > 0) {
        const coordinator = this.options.resourceCoordinator;
        if (!coordinator) throw new Error("Delegated resource claims require a shared resource coordinator.");
        const ancestors = new Set<string>();
        let ancestor: string | undefined = record.parentSessionId;
        while (ancestor) {
          if (ancestors.has(ancestor)) throw new Error("Agent session ancestry contains a cycle.");
          ancestors.add(ancestor);
          ancestor = this.options.repository.getByChildSession(ancestor)?.parentSessionId;
        }
        if (
          coordinator
            .conflicts(declaredResources)
            .some((conflict) => conflict.owner?.type === "session" && ancestors.has(conflict.owner.id))
        )
          throw new Error(
            "A delegated assignment cannot wait on a resource held by its own ancestor. Release the ancestor claim or delegate a separate scope.",
          );
        resourceLease = await coordinator.acquire(declaredResources, active.controller.signal, {
          // Tool calls made by this child session use the same owner identity,
          // allowing a declared assignment lease to be re-entered safely.
          type: "session",
          id: record.childSessionId,
        });
      }
      // Resource acquisition precedes the run permit, matching the Pi tool
      // scheduler and preventing a resource waiter from occupying capacity.
      permit = this.gate.tryAcquire(
        plan.workspaceAccess === AgentChildWorkspaceAccessModes.ReadWrite
          ? AgentRunPermitKinds.WorkspaceWrite
          : AgentRunPermitKinds.ReadOnly,
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
        this.todoService!.add({
          sessionId: running.childSessionId,
          tasks: [{ content: running.task }],
          source: AgentTodoChangeSources.Host,
        });
        todoSeedFingerprint = this.todoService!.fingerprint(running.childSessionId);
      }
      activity = new AgentChildRunActivityTracker({
        startedAt,
        policy: running.executionContract.deadline,
        ...(control ? { control } : {}),
        ...(running.snapshot ? { initialSnapshot: running.snapshot } : {}),
        ...(running.checkpoint ? { initialCheckpoint: running.checkpoint } : {}),
        continuity: {
          referenceId: `senera://work-item/${running.workItemId ?? running.id}`,
          ...(running.workItemId ? { workItemId: running.workItemId } : {}),
          ...(running.taskDigest ? { taskDigest: running.taskDigest } : {}),
        },
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

      const ceiling =
        queuedInput?.executionScope === "turn" && queuedInput.allowedToolNames
          ? new Set(queuedInput.allowedToolNames)
          : undefined;
      const allowedToolNames = record.allowedToolNames.filter((name) => !ceiling || ceiling.has(name));
      const delegationStatus = this.delegationStatus(
        record.childSessionId,
        allowedToolNames.includes(AgentOrchestrationToolNames.Subagent),
      );
      const result = await this.options.dispatcher.dispatch({
        sessionId: record.childSessionId,
        requestId: record.childRequestId,
        input,
        metadata: queuedInput?.metadata,
        attachments: queuedInput?.attachments,
        approvalMode: record.approvalMode,
        modelProviderId: record.modelProviderId,
        systemPromptLayer: {
          ...plan.promptLayer,
          content: `${plan.promptLayer.content}\n\nDelegation limits: ${JSON.stringify(delegationStatus)}. ${delegationStatus.can_delegate ? "Discover authorized models with list_subagent_models before selecting a different route." : "Complete the assignment with your own tools; further delegation is unavailable."}`,
        },
        allowedToolNames,
        executionScope: queuedInput?.executionScope,
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
        scope: { ...createAgentChildRunScope(record), ...parentInvocationEventScope(context.parentInvocation) },
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
      resourceLease?.release();
      if (this.options.repository.get(record.id)?.status !== AgentChildRunStatuses.AwaitingSupervisor) {
        this.parentInvocations.delete(record.id);
      }
    }
  }

  private async projectDeclaredResources(
    declarations: readonly AgentToolResourceClaimDeclaration[] | undefined,
  ): Promise<AgentToolResourceLeaseRequest | undefined> {
    if (!declarations || declarations.length === 0) return undefined;
    return this.requireResourceClaims().projectDeclarations(declarations);
  }

  private requireResourceClaims(): AgentToolResourceClaimProjectorPort {
    const projector = this.resourceClaims;
    if (!projector) throw new Error("Agent delegation requires a bound resource capability projector.");
    return projector;
  }

  private projectResourceClaimSummaries(
    request: AgentToolResourceLeaseRequest,
  ): readonly { readonly domainId: string; readonly identity: string; readonly access: "shared" | "exclusive" }[] {
    return request.claims.map((claim) => ({
      domainId: claim.domain.id,
      identity: claim.identity,
      access: claim.access,
    }));
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

  private resolveParentTodo(content: string | undefined, parentSessionId: string): AgentTodoItem | undefined {
    if (content === undefined) return undefined;
    if (!this.todoService) throw new Error("Todo service is required to link a delegated plan step.");
    const item = this.todoService.read(parentSessionId).items.find((item) => item.content === content.trim());
    if (!item) throw new Error("The delegated Todo must match an existing plan step. Update the plan before spawning.");
    return item;
  }

  private completeParentTodo(record: AgentChildRunRecord, sink: AgentEventSink | undefined): void {
    const id = record.launchContract.parentTodoId;
    if (record.status !== AgentChildRunStatuses.Completed || typeof id !== "string" || !this.todoService) return;
    const item = this.todoService.read(record.parentSessionId).items.find((item) => item.id === id);
    // A replaced plan has new identities; late child results must not recreate or alter it.
    if (item?.status !== AgentTodoStatuses.InProgress) return;
    if ([...this.starting.values()].includes(id)) return;
    const assignments = this.list(record.parentSessionId).filter((run) => run.launchContract.parentTodoId === id);
    if (assignments.some((run) => run.status !== AgentChildRunStatuses.Completed)) return;
    this.todoService.update({
      sessionId: record.parentSessionId,
      requestId: record.parentRequestId,
      updates: [{ id, status: AgentTodoStatuses.Completed }],
      source: AgentTodoChangeSources.Host,
      onEvent: (event) => this.emit(sink, event),
    });
  }

  private reconcileParentTodo(record: AgentChildRunRecord, sink?: AgentEventSink): void {
    try {
      this.completeParentTodo(record, sink);
    } catch (error) {
      // Plan projection cannot change the already committed child execution outcome.
      this.options.logger?.warn("orchestration.todo_sync_failed", {
        sessionId: record.parentSessionId,
        childRunId: record.id,
        message: errorMessage(error),
      });
    }
  }

  private reconcileParentTodos(): void {
    for (const record of this.options.repository.listAll()) this.reconcileParentTodo(record);
  }

  private emit(sink: AgentEventSink | undefined, event: AgentDomainEvent): Promise<void> {
    const childRunId = readChildRunId(event);
    if (childRunId && "childSessionId" in event.data) {
      const record = this.options.repository.get(childRunId);
      if (record) {
        this.reconcileParentTodo(record, sink);
        for (const observer of this.activationObservers) observer(record);
      }
    }
    const scopedEvent = scopeChildEventToParentInvocation(
      event,
      childRunId ? this.parentInvocations.get(childRunId) : undefined,
    );
    const durableEvent = scopedEvent.eventId ? scopedEvent : { ...scopedEvent, eventId: createOpaqueId("event") };
    // Raw child-session deltas already travel through the owning parent
    // request sink. Only parent-scoped lifecycle events are mirrored to the
    // global relay, otherwise the same event could race persistence under the
    // child session and disappear from the parent's history. When the request
    // sink is gone, the relay remains the recovery path for every event.
    const deliveries = [
      sink ? emitAgentEvent(sink, durableEvent) : Promise.resolve(),
      shouldMirrorToOrchestrationRelay(durableEvent, sink) ? this.options.events.emit(durableEvent) : Promise.resolve(),
    ];
    return Promise.allSettled(deliveries)
      .then(() => undefined)
      .finally(() => {
        if (!childRunId) return;
        this.waits.notify(childRunId);
      });
  }

  /**
   * Completion delivery is deliberately detached from the worker promise.
   * A channel adapter or the owning session may be unavailable temporarily;
   * the persisted child record remains the source of truth for recovery.
   */
  private assertActivationCapacity(ownerRunId: string): void {
    const configuration = resolveAgentDelegationConfiguration(this.options.configuration().config);
    this.gate.updateLimits(projectDelegationConcurrencyLimits(configuration));
    const active = this.options.repository
      .listForOwner(ownerRunId)
      .filter((run) => !isAgentChildRunSettled(run.status));
    if (active.length >= configuration.execution.maxActivePerTree)
      throw new Error("This agent tree has reached its configured activation limit. Continue existing agents first.");
  }

  private notifyCompletion(record: AgentChildRunRecord): void {
    if (!isAgentChildRunBackgroundCompletionDeliverable(record)) return;
    void this.options.completion?.completed(record).catch(() => undefined);
  }
}

const AgentDelegationExecutionModeBySpawnMode: Readonly<
  Record<(typeof AgentSpawnModes)[keyof typeof AgentSpawnModes], AgentDelegationExecutionMode>
> = Object.freeze({
  [AgentSpawnModes.Wait]: AgentDelegationExecutionModes.Wait,
  [AgentSpawnModes.Background]: AgentDelegationExecutionModes.Detach,
});

function executionModeForSpawnMode(
  mode: (typeof AgentSpawnModes)[keyof typeof AgentSpawnModes],
): AgentDelegationExecutionMode {
  return AgentDelegationExecutionModeBySpawnMode[mode];
}

function shouldMirrorToOrchestrationRelay(event: AgentDomainEvent, sink: AgentEventSink | undefined): boolean {
  if (!sink) return true;
  const context = event.context as AgentEventContext;
  const parentSessionId = context.scope?.parentSessionId;
  return parentSessionId !== undefined && context.sessionId === parentSessionId;
}

function scopeChildEventToParentInvocation(
  event: AgentDomainEvent,
  invocation: AgentDelegationContext["parentInvocation"],
): AgentDomainEvent {
  const scope = parentInvocationEventScope(invocation);
  return Object.keys(scope).length > 0 ? withEventContext(event, { scope }) : event;
}

function parentInvocationEventScope(
  invocation: AgentDelegationContext["parentInvocation"],
): Pick<
  AgentEventScope,
  "parentAgentStep" | "parentModelMessageIndex" | "parentModelContentIndex" | "parentToolCallId"
> {
  return invocation
    ? {
        parentAgentStep: invocation.agentStep,
        parentModelMessageIndex: invocation.modelMessageIndex,
        ...(invocation.modelContentIndex === undefined
          ? {}
          : { parentModelContentIndex: invocation.modelContentIndex }),
        ...(invocation.toolCallId ? { parentToolCallId: invocation.toolCallId } : {}),
      }
    : {};
}
