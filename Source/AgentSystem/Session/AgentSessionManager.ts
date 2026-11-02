import { publishAgentSessionQueuedInput } from "./AgentSessionInputDelivery.js";
import type { AgentSessionQueuedInput } from "./AgentSessionQueuedInput.js";
import { errorMessage } from "../Core/AgentErrors.js";
import type { AgentEventSink } from "../Events/AgentEvent.js";
import { AgentEventKinds, emitAgentEvent } from "../Events/AgentEvent.js";
import type { AgentEventEnvelope } from "../Events/AgentEventBase.js";
import { matchByKind } from "../Core/AgentMatch.js";
import { AgentConversationPolicy } from "../Conversation/AgentConversationPolicy.js";
import { AgentConversationProjector } from "../Conversation/AgentConversationProjector.js";
import { projectAgentMessage } from "../I18n/AgentMessageProjection.js";
import { AgentMemoryService } from "../Memory/AgentMemoryService.js";
import type { AgentPiSessionExportFormat } from "../Pi/AgentPiSessionManagement.js";
import type { AgentUploadAttachment } from "../Uploads/AgentUploadTypes.js";
import type { AgentExecutionApprovalMode } from "../Safety/AgentExecutionApprovalMode.js";
import type { AgentPinnedSkillReference } from "../Skills/AgentSkillActivation.js";
import { AgentSessionEventFactory } from "./AgentSessionEventFactory.js";
import { AgentSessionHistoryReplay } from "./AgentSessionHistoryReplay.js";
import { AgentSessionRunCoordinator } from "./AgentSessionRunCoordinator.js";
import { AgentSessionStore } from "./AgentSessionStore.js";
import { AgentSessionTitleProjector } from "./AgentSessionTitleProjector.js";
import type { AgentTurnPreparationSnapshot } from "../Loop/AgentTurnPreparationSnapshot.js";
import { resolveAgentPiSessionLifecycle } from "../Pi/AgentPiSessionLifecycleMetadata.js";
import type { AgentSessionMessageDisposition } from "./AgentSessionMessageDisposition.js";
import type { AgentSessionMessageQueueMode } from "./AgentSessionMessageQueueMode.js";
import { AgentSessionHistoryMutationCoordinator } from "./AgentSessionHistoryMutationCoordinator.js";
import { createOpaqueId } from "../Core/AgentIds.js";
import { AgentSessionOperations } from "./AgentSessionOperation.js";
import { AgentSessionAdmissionCoordinator } from "./AgentSessionAdmissionCoordinator.js";
import { AgentSessionForkCoordinator } from "./AgentSessionForkCoordinator.js";
import { AgentSessionCloseCoordinator } from "./AgentSessionCloseCoordinator.js";
import { AgentSessionPiManagementController } from "./AgentSessionPiManagementController.js";
import type { AgentSessionManagerOptions } from "./AgentSessionManagerOptions.js";
import {
  AgentSessionMessageCoordinator,
  type AgentSessionMessageAcceptance,
} from "./AgentSessionMessageCoordinator.js";
import { AgentSessionHistoryController, type AgentSessionRetryRequest } from "./AgentSessionHistoryController.js";
import {
  resolveAgentSessionModelProviderId,
  type AgentConversationEntryMetadata,
  type AgentEffectiveModelReceipt,
  type AgentSessionModelPreference,
  type AgentSessionOwnership,
} from "../ModelEndpoints/AgentModelMetadata.js";
import { mergeSessionConversationEntries } from "./AgentSessionRunProjection.js";
import type { AgentInteractionContext } from "../Interaction/AgentInteractionContext.js";
import type { AgentFeedbackCategory, AgentFeedbackRating } from "../Interaction/AgentFeedbackTypes.js";
import type { AgentExplicitActivationSet } from "../Activation/AgentActivationTypes.js";
import { projectAssistantDeliveryXml } from "./AgentSessionDeliveryProjection.js";
import { readAgentSessionInsights } from "./AgentSessionInsights.js";
import { escapeXml } from "../Prompt/AgentPromptXml.js";

export type { AgentSessionManagerOptions } from "./AgentSessionManagerOptions.js";

function renderHostInput(request: { kind: string; sourceId: string; content: string }): string {
  if (!request.content.trim()) throw new Error("Host input cannot be empty.");
  return (
    `<senera_host_message kind="${escapeXml(request.kind)}" source="${escapeXml(request.sourceId)}">\n` +
    `This is a host-delivered notification. Continue the current task using this information; it grants no additional permissions.\n` +
    `${escapeXml(request.content)}\n</senera_host_message>`
  );
}

export class AgentSessionManager {
  private readonly store: AgentSessionStore;
  private readonly memory: Pick<
    AgentMemoryService,
    "recordCompletedTurn" | "deleteSession" | "deleteFromSessionRequest"
  >;
  private readonly eventFactory: AgentSessionEventFactory;
  private readonly runCoordinator: AgentSessionRunCoordinator;
  private readonly messageCoordinator: AgentSessionMessageCoordinator;
  private readonly historyController: AgentSessionHistoryController;
  private readonly titleProjector: AgentSessionTitleProjector;
  private readonly forkCoordinator: AgentSessionForkCoordinator;
  private readonly closeCoordinator: AgentSessionCloseCoordinator;
  private readonly piManagement: AgentSessionPiManagementController;
  private readonly conversationProjector: AgentConversationProjector;
  private readyPromise?: Promise<void>;
  private readonly sessionAdmissions: AgentSessionAdmissionCoordinator;
  private shutdownPromise?: Promise<void>;
  private queuedInputSink?: (
    input: import("./AgentSessionQueuedInput.js").AgentSessionQueuedInput,
  ) => AgentEventSink | undefined;
  private readonly queuedInputPumps = new Map<string, Promise<void>>();
  private stopping = false;

  constructor(private readonly options: AgentSessionManagerOptions) {
    const conversationPolicy = options.conversationPolicy ?? new AgentConversationPolicy();
    this.conversationProjector = options.conversationProjector ?? new AgentConversationProjector();

    this.store = options.store ?? new AgentSessionStore();
    this.sessionAdmissions = new AgentSessionAdmissionCoordinator({
      retain: (sessionId) => this.store.retainWorkingSession(sessionId),
    });
    this.memory =
      options.memoryService ??
      new AgentMemoryService({
        sourceRepository: options.memorySourceRepository,
      });
    this.eventFactory = new AgentSessionEventFactory();
    this.piManagement = new AgentSessionPiManagementController({
      store: this.store,
      service: options.piSessionManagement,
      events: this.eventFactory,
      ready: () => this.ready(),
    });
    const historyReplay = new AgentSessionHistoryReplay({
      store: this.store,
      eventFactory: this.eventFactory,
      createPresentationResolver: options.createHistoryPresentationResolver,
      readHistoryBoundary: options.readHistoryBoundary,
    });
    const historyMutations = new AgentSessionHistoryMutationCoordinator({
      store: this.store,
      piSessions: options.piSessionMutations,
      memory: this.memory,
      artifacts: options.artifactSessionCleanup,
      resources: options.historyResources,
    });
    this.runCoordinator = new AgentSessionRunCoordinator({
      onQueuedInputAccepted: options.onQueuedInputAccepted,
      onTurnStart: options.onTurnStart,
      store: this.store,
      conversationProjector: this.conversationProjector,
      conversationPolicy,
      memory: this.memory,
      logger: options.logger,
      runResources: options.runResources,
      piSessions: options.piSessions,
      piDiagnostics: options.piDiagnostics,
      uploadStore: options.uploadStore,
      imageNormalization: options.imageNormalization,
      piSessionMutations: options.piSessionMutations,
      runControl: options.runControl,
      loopFactory: options.loopFactory,
      snapshotEvent: (session) => this.eventFactory.snapshot(session),
    });
    this.messageCoordinator = new AgentSessionMessageCoordinator({
      resolveInteraction: options.resolveInteraction,
      resolveAgentId: options.resolveAgentId,
      agentModelProviderId: options.agentModelProviderId,
      store: this.store,
      admissions: this.sessionAdmissions,
      events: this.eventFactory,
      runs: this.runCoordinator,
      ready: () => this.ready(),
      recoverHistory: async (sessionId) => {
        await historyMutations.recoverSession(sessionId);
      },
    });
    this.historyController = new AgentSessionHistoryController({
      store: this.store,
      admissions: this.sessionAdmissions,
      replay: historyReplay,
      mutations: historyMutations,
      runs: this.runCoordinator,
      messages: this.messageCoordinator,
      ready: () => this.ready(),
      logger: options.logger,
    });
    this.titleProjector = new AgentSessionTitleProjector((sessionId) => this.store.loadFirstUserMessage(sessionId));
    this.runCoordinator.cleanupOrphanedRunningSnapshots();
    this.closeCoordinator = new AgentSessionCloseCoordinator({
      store: this.store,
      runs: this.runCoordinator,
      memory: this.memory,
      piSessionCleanup: options.piSessionCleanup,
      resources: options.sessionResources,
      artifacts: options.artifactSessionCleanup,
      logger: options.logger,
    });
    this.forkCoordinator = new AgentSessionForkCoordinator({
      store: this.store,
      admissions: this.sessionAdmissions,
      piManagement: options.piSessionManagement,
      piMutations: options.piSessionMutations,
      artifacts: options.artifactSessionCleanup,
      recoverSourceHistory: (sessionId) => this.historyController.recoverSession(sessionId),
      isSourceRunActive: (sessionId) => this.runCoordinator.hasActiveRun(sessionId),
    });
    void this.ready().catch(() => undefined);
  }

  ready(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    const recovery = this.recoverRuntimeState();
    const guarded = recovery.catch((error) => {
      if (this.readyPromise === guarded) this.readyPromise = undefined;
      throw error;
    });
    this.readyPromise = guarded;
    return guarded;
  }

  beginShutdown(): void {
    this.stopping = true;
    this.runCoordinator.beginShutdown();
  }

  shutdown(): Promise<void> {
    this.beginShutdown();
    return (this.shutdownPromise ??= (async () => {
      await this.runCoordinator.shutdown();
      await Promise.allSettled(this.queuedInputPumps.values());
    })());
  }

  async createSession(request: { sessionId?: string; agentId?: string; onEvent?: AgentEventSink }): Promise<void> {
    await this.sessionAdmissions.run(request.sessionId ?? createOpaqueId("automatic_session_creation"), async () => {
      await this.ready();
      const existing = request.sessionId ? this.store.get(request.sessionId) : undefined;
      const existingAgentId = existing?.kind === "found" ? existing.session.metadata?.agentId : undefined;
      const agentId = this.options.resolveAgentId?.(existingAgentId ?? request.agentId);
      if (request.agentId && existingAgentId && request.agentId !== existingAgentId) {
        throw new Error("A conversation cannot change its Agent.");
      }
      const opened = this.store.open(request.sessionId);
      if (agentId && !opened.session.metadata?.agentId) {
        opened.session.metadata = { ...opened.session.metadata, agentId };
        this.store.persistMetadata(opened.session);
      }
      await this.historyController.recoverSession(opened.session.id);

      await emitAgentEvent(
        request.onEvent,
        matchByKind(opened, {
          created: ({ session }) => this.eventFactory.created(session),
          existing: ({ session }) => this.eventFactory.snapshot(session),
        }),
      );
    });
  }

  async closeSession(request: { sessionId: string; onEvent?: AgentEventSink }): Promise<void> {
    await this.sessionAdmissions.run(request.sessionId, async () => {
      await this.ready();
      this.historyController.invalidate(request.sessionId);
      const lookup = this.store.get(request.sessionId);

      await matchByKind(lookup, {
        missing: async ({ sessionId }) => {
          await emitAgentEvent(request.onEvent, this.eventFactory.notFound(sessionId, AgentSessionOperations.Close));
        },
        found: async ({ session }) => {
          const closed = await this.closeCoordinator.close(session);
          await emitAgentEvent(
            request.onEvent,
            matchByKind(closed, {
              closed: ({ session: current }) => this.eventFactory.closed(current),
              missing: ({ sessionId }) => this.eventFactory.notFound(sessionId, AgentSessionOperations.Close),
            }),
          );
        },
      });
    });
  }

  async closeSessions(request: {
    sessionIds: readonly string[];
    onEvent?: AgentEventSink;
  }): Promise<
    readonly { readonly sessionId: string; readonly kind: "completed" | "failed"; readonly error?: unknown }[]
  > {
    const sessionIds = [...new Set(request.sessionIds)];
    return Promise.all(
      sessionIds.map(async (sessionId) => {
        try {
          await this.closeSession({ sessionId, onEvent: request.onEvent });
          return { sessionId, kind: "completed" as const };
        } catch (error) {
          return { sessionId, kind: "failed" as const, error };
        }
      }),
    );
  }

  private async recoverRuntimeState(): Promise<void> {
    await this.forkCoordinator.recoverAll();
    await this.historyController.recoverAll();
    await this.closeCoordinator.recoverAll();
  }

  registerInputSource(source: import("./AgentSessionQueuedInput.js").AgentSessionInputSource): () => void {
    return this.runCoordinator.registerInputSource(source);
  }

  listQueuedInputs(sessionId: string): readonly import("./AgentSessionQueuedInput.js").AgentSessionQueuedInput[] {
    return this.store.listQueuedInputs(sessionId);
  }

  /** Withdraw only unscheduled notices; an already committed input remains history. */
  async withdrawHostInput(sessionId: string, deliveryId: string): Promise<void> {
    await this.sessionAdmissions.run(sessionId, async () => {
      const input = this.store.loadQueuedInput(sessionId, deliveryId);
      if (!input?.entry.metadata?.hostInput || input.state !== "pending" || input.wireInput) return;
      const updated = {
        ...input,
        state: "cancelled" as const,
        errorMessage: "Completion was already observed through a committed tool result.",
        updatedAt: new Date().toISOString(),
      };
      this.store.saveQueuedInput(updated);
      await publishAgentSessionQueuedInput(updated, this.queuedInputSink?.(updated));
    });
  }

  setQueuedInputSink(factory: NonNullable<AgentSessionManager["queuedInputSink"]>): void {
    this.queuedInputSink = factory;
    this.scheduleQueuedRecovery();
  }

  private scheduleQueuedRecovery(): void {
    void this.resumeQueuedMessages().catch((error: unknown) => {
      this.options.logger?.error("session.queued_input.recovery_failed", { error });
    });
  }

  /** Restores accepted, unconsumed input only after its owning surface is available. */
  async resumeQueuedMessages(): Promise<void> {
    if (this.stopping || !this.queuedInputSink) return;
    await this.ready();
    if (this.stopping) return;
    for (const input of this.store.listQueuedInputs()) {
      if (this.queuedInputPumps.has(input.sessionId)) continue;
      const pump = this.resumeQueuedSession(input.sessionId);
      this.queuedInputPumps.set(input.sessionId, pump);
      void pump
        .catch((error: unknown) => {
          this.options.logger?.error("session.queued_input.recovery_failed", { sessionId: input.sessionId, error });
        })
        .finally(() => {
          this.queuedInputPumps.delete(input.sessionId);
        });
    }
  }

  private async resumeQueuedSession(sessionId: string): Promise<void> {
    while (!this.stopping) {
      await this.runCoordinator.waitForIdle(sessionId);
      const recovered = await this.sessionAdmissions.run(sessionId, async () => {
        if (this.stopping) return undefined;
        if (this.runCoordinator.hasActiveRun(sessionId)) return { kind: "busy" as const };
        const queued = this.store.listQueuedInputs(sessionId);
        if (!queued.length) return undefined;
        // Serialize transcript inspection with normal admission and deletion.
        // A crash can separate Pi's commit from our delivered receipt.
        if (queued.some((input) => input.wireInput) && !this.options.readCommittedInputs)
          throw new Error("Queued input recovery requires native transcript receipts.");
        const committed = queued.some((input) => input.wireInput)
          ? await this.options.readCommittedInputs!(sessionId)
          : new Set<string>();
        if (this.stopping) return undefined;
        for (const input of queued) {
          if (input.state !== "delivered" && (!input.wireInput || !committed.has(input.wireInput))) continue;
          const parent = this.store.loadRunSnapshot(sessionId, input.parentRequestId);
          const state =
            parent?.status === "completed" ? "completed" : parent?.status === "cancelled" ? "cancelled" : "failed";
          const updated = { ...input, state, updatedAt: new Date().toISOString() } as const;
          this.store.saveQueuedInput(updated);
          await publishAgentSessionQueuedInput(updated, this.queuedInputSink?.(updated));
        }
        const pending = this.store.listQueuedInputs(sessionId).filter((input) => input.state === "pending");
        // Quiet notices join a permitted turn; they must never become its wake trigger.
        const next = pending.find(
          (input) =>
            input.entry.metadata?.hostInput?.wake !== false && (this.options.canWakeQueuedInputs?.([input]) ?? true),
        );
        if (!next) return undefined;
        const sink = this.queuedInputSink?.(next);
        if (!sink) return undefined;
        try {
          const managed = this.options.activateQueuedInput?.(next, sink);
          if (managed?.parked) return undefined;
          if (managed) return { kind: "accepted" as const, ...managed, input: next, sink };
          const acceptance = await this.messageCoordinator.acceptUnderAdmission({
            ...next.request,
            queueMode: undefined,
            onEvent: sink,
          });
          return { ...acceptance, input: next, sink };
        } catch (error) {
          if (!this.stopping) await this.failQueuedRecovery(next, sink, errorMessage(error));
          throw error;
        }
      });
      if (!recovered) return;
      if (recovered.kind === "busy") continue;
      if (recovered.kind !== "accepted" || !("input" in recovered)) return;
      try {
        if ((await recovered.completion) === "parked") return;
      } catch (error) {
        if (!this.stopping) await this.failQueuedRecovery(recovered.input, recovered.sink, errorMessage(error));
        throw error;
      }
      const remaining = this.store.loadQueuedInput(sessionId, recovered.input.requestId);
      // Preparation may fail before Pi sees the input. Show that terminal
      // outcome; do not leave an accepted message pending indefinitely.
      if (remaining?.state === "pending") {
        if (!this.stopping)
          await this.failQueuedRecovery(
            remaining,
            recovered.sink,
            this.store.loadRunSnapshot(sessionId, remaining.requestId)?.errorMessage ??
              "The queued turn ended before model input was committed.",
          );
        return;
      }
    }
  }

  private async failQueuedRecovery(
    input: AgentSessionQueuedInput,
    sink: AgentEventSink,
    message: string,
  ): Promise<void> {
    const failed = { ...input, state: "failed", errorMessage: message, updatedAt: new Date().toISOString() } as const;
    this.store.saveQueuedInput(failed);
    await publishAgentSessionQueuedInput(failed, sink);
  }

  async submitMessage(request: {
    agentId?: string;
    sessionId: string;
    requestId?: string;
    modelProviderId?: string;
    thinkingLevel?: import("@earendil-works/pi-ai").ModelThinkingLevel;
    input: string;
    approvalMode: AgentExecutionApprovalMode;
    attachments?: AgentUploadAttachment[];
    metadata?: AgentConversationEntryMetadata;
    disposition?: AgentSessionMessageDisposition;
    queueMode?: AgentSessionMessageQueueMode;
    activations?: AgentExplicitActivationSet;
    onEvent?: AgentEventSink;
    preparation?: AgentTurnPreparationSnapshot;
    systemPromptLayer?: import("../Orchestration/AgentRunDispatchPort.js").AgentSystemPromptLayer;
    allowedToolNames?: readonly string[];
    executionScope?: "session" | "turn";
    pinnedSkills?: readonly AgentPinnedSkillReference[];
    inheritProjectContext?: boolean;
    sessionOwnership?: AgentSessionOwnership;
    interaction?: AgentInteractionContext;
  }): Promise<AgentSessionMessageAcceptance> {
    try {
      return await this.messageCoordinator.submit(request);
    } finally {
      this.scheduleQueuedRecovery();
    }
  }

  /** Durable admission without holding a protocol request open for model work. */
  async acceptMessage(
    request: import("./AgentSessionMessageCoordinator.js").AgentSessionMessageRequest,
  ): Promise<AgentSessionMessageAcceptance> {
    const acceptance = await this.messageCoordinator.accept(request);
    if (acceptance.completion) {
      void acceptance.completion
        .catch((error: unknown) => {
          this.options.logger?.error("session.accepted_run.failed", {
            sessionId: request.sessionId,
            requestId: request.requestId,
            error,
          });
        })
        .finally(() => {
          this.scheduleQueuedRecovery();
        });
    } else this.scheduleQueuedRecovery();
    return acceptance;
  }

  /** Persist first, then wake through the same admission and Pi boundary as user input. */
  async acceptHostInput(request: {
    readonly sessionId: string;
    readonly deliveryId: string;
    readonly sourceId: string;
    readonly kind: NonNullable<AgentConversationEntryMetadata["hostInput"]>["kind"];
    readonly content: string;
    readonly mode?: AgentSessionMessageQueueMode;
    readonly wake?: boolean;
    readonly executionPolicy?: NonNullable<
      import("../ModelEndpoints/AgentModelMetadata.js").AgentSessionMetadata["executionPolicy"]
    >;
    readonly onEvent?: AgentEventSink;
  }): Promise<"accepted" | "missing"> {
    await this.ready();
    const accepted = await this.sessionAdmissions.run(request.sessionId, async () => {
      if (this.stopping) throw new Error("Session runtime is shutting down.");
      const existing = this.store.loadQueuedInput(request.sessionId, request.deliveryId);
      if (existing) {
        if (
          existing.entry.metadata?.hostInput?.sourceId !== request.sourceId ||
          existing.entry.content !== renderHostInput(request)
        )
          throw new Error("Host delivery identity belongs to different content.");
        return "accepted" as const;
      }
      const lookup = this.store.get(request.sessionId);
      if (lookup.kind === "missing") return "missing" as const;
      const policy = request.executionPolicy ?? lookup.session.metadata?.executionPolicy;
      if (!policy) throw new Error("Host wakeup requires an admitted session execution policy.");
      await this.runCoordinator.deferMessage({
        ...policy,
        ...(request.executionPolicy ? { executionScope: "turn" as const } : {}),
        sessionId: request.sessionId,
        requestId: request.deliveryId,
        input: renderHostInput(request),
        queueMode: request.mode ?? "follow_up",
        metadata: {
          ...(lookup.session.metadata?.channel ? { channel: lookup.session.metadata.channel } : {}),
          hostInput: {
            kind: request.kind,
            sourceId: request.sourceId,
            deliveryId: request.deliveryId,
            ...(request.wake === undefined ? {} : { wake: request.wake }),
          },
        },
        onEvent: request.onEvent,
      });
      return "accepted" as const;
    });
    this.scheduleQueuedRecovery();
    return accepted;
  }

  async acceptScheduledInstruction(
    task: import("../Orchestration/AgentScheduledTaskRunTypes.js").AgentScheduledTaskRecord,
    run: import("../Orchestration/AgentScheduledTaskRunTypes.js").AgentScheduledTaskRunRecord,
    allowedToolNames: readonly string[],
    onEvent?: AgentEventSink,
  ): Promise<"accepted" | "missing"> {
    await this.ready();
    const target =
      task.target === "new_once"
        ? task.targetSessionId
        : task.target === "new"
          ? run.executionSessionId
          : task.sessionId;
    if (!target) throw new Error("Scheduled target has no persistent session identity.");
    const prepared = await this.sessionAdmissions.run(target, async () => {
      const source = this.store.get(task.sessionId);
      if (source.kind === "missing") return undefined;
      const policy = source.session.metadata?.executionPolicy;
      if (!policy) throw new Error("Scheduled instructions require an admitted source execution policy.");
      const ceiling = policy.allowedToolNames ? new Set(policy.allowedToolNames) : undefined;
      const executionPolicy = {
        ...policy,
        allowedToolNames: allowedToolNames.filter((name) => !ceiling || ceiling.has(name)),
        interaction: undefined,
      };
      if (target !== task.sessionId) {
        const opened = this.store.open(target, { type: "scheduled_run", taskId: task.id });
        if (opened.kind === "created") {
          opened.session.metadata = {
            ...opened.session.metadata,
            agentId: source.session.metadata?.agentId,
            executionPolicy,
            sessionModel: source.session.metadata?.sessionModel,
          };
          this.store.persistMetadata(opened.session);
          await emitAgentEvent(onEvent, this.eventFactory.created(opened.session));
        } else if (
          opened.session.metadata?.ownership?.type !== "scheduled_run" ||
          opened.session.metadata.ownership.taskId !== task.id
        ) {
          throw new Error("Scheduled target session belongs to different work.");
        } else {
          opened.session.metadata = { ...opened.session.metadata, executionPolicy };
          this.store.persistMetadata(opened.session);
        }
      }
      return executionPolicy;
    });
    if (!prepared) return "missing";
    return this.acceptHostInput({
      sessionId: target,
      deliveryId: `schedule:${run.id}`,
      sourceId: task.id,
      kind: "schedule",
      content: task.prompt,
      executionPolicy: prepared,
      onEvent,
    });
  }

  /**
   * Appends a durable, idempotent assistant delivery without manufacturing a
   * user turn. Scheduled work uses this only after its execution is terminal.
   */
  async deliverScheduledTaskResult(request: {
    readonly deliveryId: string;
    readonly taskId: string;
    readonly sessionId: string;
    readonly content: string;
    readonly createdAt: string;
    readonly onEvent?: AgentEventSink;
  }): Promise<"delivered" | "busy" | "missing"> {
    return this.deliverProactiveMessage({
      ...request,
      metadata: {
        scheduledTask: {
          taskId: request.taskId,
          runId: request.deliveryId,
        },
      },
    });
  }

  /**
   * Appends one idempotent assistant message without creating a synthetic user
   * turn. All host-driven delivery paths share this admission boundary.
   */
  async deliverProactiveMessage(request: {
    readonly deliveryId: string;
    readonly sessionId: string;
    readonly content: string;
    readonly createdAt: string;
    readonly metadata?: import("../ModelEndpoints/AgentModelMetadata.js").AgentConversationEntryMetadata;
    readonly onEvent?: AgentEventSink;
  }): Promise<"delivered" | "busy" | "missing"> {
    await this.ready();
    const content = request.content.trim();
    if (!content) throw new Error("Proactive delivery content must not be empty.");
    return this.sessionAdmissions.run(request.sessionId, async () => {
      const lookup = this.store.get(request.sessionId);
      if (lookup.kind === "missing") return "missing";
      if (this.runCoordinator.hasActiveRun(request.sessionId)) return "busy";

      const entry = this.conversationProjector.projectAssistantDecision(
        request.deliveryId,
        projectAssistantDeliveryXml(content),
        request.createdAt,
        request.metadata,
      );
      const appended = !lookup.session.conversation.some((candidate) => candidate.id === entry.id);
      if (appended) {
        this.store.persistEntries(request.sessionId, [entry]);
        lookup.session.conversation = mergeSessionConversationEntries([...lookup.session.conversation, entry]);
        lookup.session.updatedAt = request.createdAt;
        this.store.persistMetadata(lookup.session);
        await emitAgentEvent(request.onEvent, {
          kind: AgentEventKinds.AssistantMessageCreated,
          context: { sessionId: request.sessionId, requestId: request.deliveryId },
          data: {
            messageId: entry.id,
            kind: "final_answer",
            content,
            terminal: true,
          },
        });
      }
      return "delivered";
    });
  }

  /** Resolves the durable conversation boundary used by legacy scheduled tasks. */
  async resolveScheduledTaskForkBoundary(sessionId: string): Promise<string | undefined> {
    await this.ready();
    const entries = this.store.loadConversation(sessionId);
    return entries.at(-1)?.requestId;
  }

  async hasSession(sessionId: string): Promise<boolean> {
    await this.ready();
    return this.store.get(sessionId).kind === "found";
  }

  /** Removes an internal scheduled fork without ever closing a user session. */
  async disposeScheduledTaskSession(sessionId: string): Promise<void> {
    await this.sessionAdmissions.run(sessionId, async () => {
      await this.ready();
      const lookup = this.store.get(sessionId);
      if (lookup.kind === "missing") return;
      if (lookup.session.metadata?.ownership?.type !== "scheduled_run") {
        throw new Error(`Refusing to dispose non-scheduled session: ${sessionId}`);
      }
      this.historyController.invalidate(sessionId);
      await this.closeCoordinator.close(lookup.session);
    });
  }

  listSessions(): Array<{
    agentId?: string;
    sessionId: string;
    title: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    entryCount: number;
    messageCount: number;
    activeRequestId?: string;
    channel?: import("../ModelEndpoints/AgentModelMetadata.js").AgentChannelMetadata;
    modelProviderId?: string;
    effectiveModel?: AgentEffectiveModelReceipt;
    modelPreference?: AgentSessionModelPreference;
  }> {
    return this.store
      .listSessions()
      .filter(
        (session) =>
          !this.options.managedSessionIds?.has(session.id) &&
          session.metadata?.ownership?.type !== "child_run" &&
          session.metadata?.ownership?.type !== "scheduled_run",
      )
      .map((session) => ({
        agentId: session.metadata?.agentId,
        sessionId: session.id,
        title: this.titleProjector.project(session),
        status: session.status,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        entryCount: session.entryCount,
        messageCount: session.messageCount,
        activeRequestId: session.activeRequest?.requestId,
        channel: session.metadata?.channel,
        modelProviderId: resolveAgentSessionModelProviderId(session.metadata),
        ...(session.metadata?.activeRun?.receipt
          ? { effectiveModel: session.metadata.activeRun.receipt }
          : session.metadata?.lastRun?.receipt
            ? { effectiveModel: session.metadata.lastRun.receipt }
            : {}),
        ...(session.metadata?.sessionModel ? { modelPreference: session.metadata.sessionModel } : {}),
      }));
  }

  async replayHistory(request: {
    sessionId: string;
    refresh?: boolean;
    initialWindow?: boolean;
    before?: string;
    onEvent?: AgentEventSink;
  }): Promise<void> {
    await this.historyController.replay(request);
  }

  async replayRunHistory(request: { sessionId: string; requestId: string; onEvent?: AgentEventSink }): Promise<void> {
    await this.historyController.replayRunHistory(request);
  }

  async readInsights(input: Parameters<typeof readAgentSessionInsights>[1]) {
    await this.ready();
    return readAgentSessionInsights(this.store, input);
  }

  recordRunEvent(envelope: AgentEventEnvelope): void {
    this.recordRunEvents([envelope]);
  }

  recordRunEvents(envelopes: readonly AgentEventEnvelope[]): void {
    const bySession = new Map<string, AgentEventEnvelope[]>();
    for (const envelope of envelopes) {
      if (!envelope.sessionId || !envelope.requestId) continue;
      const events = bySession.get(envelope.sessionId) ?? [];
      events.push(envelope);
      bySession.set(envelope.sessionId, events);
    }
    for (const [sessionId, events] of bySession) {
      this.store.persistRunEvents(sessionId, events);
    }
  }

  async renameSession(request: { sessionId: string; title: string; onEvent?: AgentEventSink }): Promise<void> {
    await this.sessionAdmissions.run(request.sessionId, async () => {
      await this.ready();
      const lookup = this.store.get(request.sessionId);
      if (lookup.kind === "missing") {
        await emitAgentEvent(
          request.onEvent,
          this.eventFactory.notFound(request.sessionId, AgentSessionOperations.Close),
        );
        return;
      }

      this.store.rename(request.sessionId, request.title);
      await emitAgentEvent(request.onEvent, this.eventFactory.snapshot(lookup.session));
    });
  }

  /**
   * Records or retracts the caller's rating of one finished turn. The record
   * is durable and replaces any earlier one, so `rating: null` retracts.
   */
  async recordMessageFeedback(request: {
    sessionId: string;
    requestId: string;
    rating: AgentFeedbackRating | null;
    category?: AgentFeedbackCategory;
    onEvent?: AgentEventSink;
  }): Promise<void> {
    await this.sessionAdmissions.run(request.sessionId, async () => {
      await this.ready();
      const lookup = this.store.get(request.sessionId);
      if (lookup.kind === "missing") {
        await emitAgentEvent(
          request.onEvent,
          this.eventFactory.notFound(request.sessionId, AgentSessionOperations.Message),
        );
        return;
      }
      if (!this.store.hasRequest(request.sessionId, request.requestId)) {
        await emitAgentEvent(request.onEvent, {
          kind: AgentEventKinds.RequestInvalid,
          context: { sessionId: request.sessionId, requestId: request.requestId },
          data: {
            code: "feedback_request_missing",
            ...projectAgentMessage("feedback.requestMissing", { requestId: request.requestId }),
            details: { sessionId: request.sessionId, requestId: request.requestId },
          },
        });
        return;
      }
      await emitAgentEvent(request.onEvent, {
        kind: AgentEventKinds.FeedbackRecorded,
        context: { sessionId: request.sessionId, requestId: request.requestId },
        data: {
          sessionId: request.sessionId,
          requestId: request.requestId,
          rating: request.rating,
          ...(request.category ? { category: request.category } : {}),
          updatedAt: new Date().toISOString(),
        },
      });
    });
  }

  async cancelActiveRun(request: {
    sessionId: string;
    requestId?: string;
    onEvent?: AgentEventSink;
  }): Promise<boolean> {
    await this.ready();
    this.historyController.invalidate(request.sessionId);
    return this.sessionAdmissions.run(request.sessionId, async () =>
      this.runCoordinator.acceptActiveRunCancellation(request),
    );
  }

  async settleActiveRunCancellation(request: { sessionId: string; onEvent?: AgentEventSink }): Promise<boolean> {
    await this.ready();
    this.historyController.invalidate(request.sessionId);
    return this.runCoordinator.cancelActiveRun(request);
  }

  async requestActiveRunCancellation(request: {
    sessionId: string;
    requestId?: string;
    onEvent?: AgentEventSink;
  }): Promise<boolean> {
    await this.ready();
    this.historyController.invalidate(request.sessionId);
    // Cancellation admission is a control-plane operation. It must not wait
    // behind the session's active data-plane turn or its eventual settlement.
    return this.runCoordinator.acceptActiveRunCancellation(request);
  }

  async requestActiveRunFinalAnswer(request: { sessionId: string; instruction: string }): Promise<boolean> {
    await this.ready();
    return this.runCoordinator.requestActiveRunFinalAnswer(request);
  }

  /** Whether the session currently has a run in flight, including one still settling a cancellation. */
  hasRunInFlight(sessionId: string): boolean {
    return this.runCoordinator.hasRunInFlight(sessionId);
  }

  /** Whether the session currently has an active (non-cancelling) run that can accept queued messages. */
  hasActiveRun(sessionId: string): boolean {
    return this.runCoordinator.hasActiveRun(sessionId);
  }

  hasRequest(sessionId: string, requestId: string): boolean {
    return this.store.hasRequest(sessionId, requestId);
  }

  waitForIdle(sessionId: string): Promise<void> {
    return this.runCoordinator.waitForIdle(sessionId);
  }

  async steerActiveRun(request: {
    sessionId: string;
    requestId?: string;
    queueMode?: AgentSessionMessageQueueMode;
    input: string;
    metadata?: AgentConversationEntryMetadata;
    interaction?: AgentInteractionContext;
    onEvent?: AgentEventSink;
  }): Promise<boolean> {
    await this.ready();
    // Steering is a control-plane operation. It must be able to reach the
    // active Pi turn while a data-plane admission is still doing recovery or
    // history work; waiting here can leave the tool batch without a result.
    return this.runCoordinator.steerActiveRun(request);
  }

  async followUpActiveRun(request: {
    sessionId: string;
    input: string;
    onEvent?: AgentEventSink;
    requestId?: string;
    metadata?: AgentConversationEntryMetadata;
    interaction?: AgentInteractionContext;
  }): Promise<boolean> {
    await this.ready();
    return this.runCoordinator.followUpActiveRun(request);
  }

  async interruptActiveRun(request: { sessionId: string; instruction: string }): Promise<boolean> {
    await this.ready();
    return this.runCoordinator.interruptActiveRun(request);
  }

  async truncateFromRequest(request: {
    sessionId: string;
    requestId: string;
    onEvent?: AgentEventSink;
    preparation?: AgentTurnPreparationSnapshot;
  }): Promise<void> {
    await this.historyController.truncate(request);
  }

  async regenerateFromRequest(request: {
    sessionId: string;
    fromRequestId: string;
    requestId: string;
    modelProviderId?: string;
    thinkingLevel?: import("@earendil-works/pi-ai").ModelThinkingLevel;
    input: string;
    approvalMode: AgentExecutionApprovalMode;
    attachments?: AgentUploadAttachment[];
    activations?: AgentExplicitActivationSet;
    onEvent?: AgentEventSink;
  }): Promise<void> {
    await this.historyController.regenerate(request);
  }

  async retryFailedRun(request: AgentSessionRetryRequest): Promise<void> {
    await this.historyController.retry(request);
  }

  async forkSession(request: {
    sourceSessionId: string;
    sessionId: string;
    throughRequestId: string;
    ownership?: AgentSessionOwnership;
    onEvent?: AgentEventSink;
  }): Promise<void> {
    await this.ready();
    const result = await this.forkCoordinator.fork(request);
    switch (result.kind) {
      case "source_missing":
        await emitAgentEvent(
          request.onEvent,
          this.eventFactory.notFound(result.sourceSessionId, AgentSessionOperations.Fork),
        );
        return;
      case "target_exists":
        await emitAgentEvent(request.onEvent, {
          kind: AgentEventKinds.RequestInvalid,
          context: { sessionId: result.sessionId },
          data: {
            code: "session_fork_target_exists",
            ...projectAgentMessage("session.forkTargetExists", { sessionId: result.sessionId }),
          },
        });
        return;
      case "request_missing":
        await emitAgentEvent(request.onEvent, {
          kind: AgentEventKinds.RequestInvalid,
          context: { sessionId: result.sourceSessionId },
          data: {
            code: "session_fork_boundary_missing",
            ...projectAgentMessage("session.forkBoundaryMissing", { requestId: result.requestId }),
          },
        });
        return;
      case "pi_failed":
        await this.rejectPiSessionFork(result.sessionId, request.onEvent);
        return;
      case "forked":
        await emitAgentEvent(request.onEvent, this.eventFactory.created(result.session));
        await emitAgentEvent(request.onEvent, {
          kind: AgentEventKinds.SessionForked,
          context: { sessionId: result.session.id },
          data: {
            sessionId: result.session.id,
            sourceSessionId: result.sourceSessionId,
            throughRequestId: result.throughRequestId,
            title: this.titleProjector.project({
              ...result.session,
              entryCount: result.session.conversation.length,
              messageCount: result.session.conversation.length,
            }),
            createdAt: result.session.createdAt,
          },
        });
        await this.historyController.replay({ sessionId: result.session.id, onEvent: request.onEvent });
    }
  }

  async compactSession(request: {
    sessionId: string;
    customInstructions?: string;
    onEvent?: AgentEventSink;
  }): Promise<void> {
    await this.ready();
    await this.piManagement.run(
      request,
      AgentSessionOperations.Compact,
      (service, modelProviderId) =>
        service.compact({
          sessionId: request.sessionId,
          modelProviderId,
          customInstructions: request.customInstructions,
        }),
      (result) => ({
        kind: AgentEventKinds.SessionCompacted,
        context: { sessionId: request.sessionId },
        data: {
          sessionId: request.sessionId,
          tokensBefore: result.tokensBefore,
          estimatedTokensAfter: result.estimatedTokensAfter,
        },
      }),
    );
  }

  async emitPiSessionRuntimeStatus(request: { sessionId: string; onEvent?: AgentEventSink }): Promise<void> {
    await this.ready();
    const lookup = this.store.get(request.sessionId);
    if (lookup.kind === "missing") {
      await emitAgentEvent(
        request.onEvent,
        this.eventFactory.notFound(request.sessionId, AgentSessionOperations.RuntimeStatus),
      );
      return;
    }

    const lifecycle = resolveAgentPiSessionLifecycle(lookup.session.metadata);
    const runtime =
      lifecycle.initialized && this.options.piSessionManagement
        ? await this.options.piSessionManagement.status({
            sessionId: request.sessionId,
            modelProviderId: lifecycle.modelProviderId,
          })
        : undefined;
    await emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.SessionRuntimeStatus,
      context: { sessionId: request.sessionId },
      data: {
        sessionId: request.sessionId,
        available: runtime !== undefined,
        runtime,
      },
    });
  }

  exportPiSession(request: {
    sessionId: string;
    format: AgentPiSessionExportFormat;
    onEvent?: AgentEventSink;
  }): Promise<void> {
    return this.piManagement.run(
      request,
      AgentSessionOperations.Export,
      (service, modelProviderId) =>
        service.export({
          sessionId: request.sessionId,
          modelProviderId,
          format: request.format,
        }),
      (result) => ({
        kind: AgentEventKinds.SessionExported,
        context: { sessionId: request.sessionId },
        data: result,
      }),
    );
  }

  async emitSessionListSnapshot(request: { onEvent?: AgentEventSink }): Promise<void> {
    await this.ready();
    await emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.SessionListSnapshot,
      context: {},
      data: { sessions: this.listSessions() },
    });
  }

  private async rejectPiSessionFork(sessionId: string, onEvent?: AgentEventSink): Promise<void> {
    await emitAgentEvent(onEvent, {
      kind: AgentEventKinds.RequestInvalid,
      context: { sessionId },
      data: {
        code: "session_pi_fork_failed",
        ...projectAgentMessage("session.forkPiFailed"),
      },
    });
  }
}
