import type { AgentEventSink } from "../Events/AgentEvent.js";
import { serializeError } from "../Diagnostics/AgentErrorSerializer.js";
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
import {
  AgentSessionMessageDispositions,
  type AgentSessionMessageDisposition,
} from "./AgentSessionMessageDisposition.js";
import type { AgentSessionMessageQueueMode } from "./AgentSessionMessageQueueMode.js";
import { AgentSessionMessageQueueModes } from "./AgentSessionMessageQueueMode.js";
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
import { AgentSessionHistoryController } from "./AgentSessionHistoryController.js";
import type { AgentConversationEntryMetadata, AgentSessionOwnership } from "../ModelEndpoints/AgentModelMetadata.js";
import { mergeSessionConversationEntries } from "./AgentSessionRunProjection.js";
import type { AgentInteractionContext } from "../Interaction/AgentInteractionContext.js";
import type { AgentChannelFinalizationRecord } from "../Channels/AgentChannelFinalizationTypes.js";
import type { AgentChannelKind } from "../Channels/AgentChannelTypes.js";
import {
  appendAgentChannelFinalizationRecord,
  readAgentChannelFinalizationHistory,
} from "../Channels/AgentChannelFinalizationTypes.js";

export type { AgentContinuityLearningSink, AgentSessionManagerOptions } from "./AgentSessionManagerOptions.js";

export class AgentSessionManager {
  private readonly store: AgentSessionStore;
  private readonly memory: AgentMemoryService;
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
        continuityLearning: options.continuityLearning,
        sourceRepository: options.memorySourceRepository,
      });
    this.eventFactory = new AgentSessionEventFactory(conversationPolicy);
    this.piManagement = new AgentSessionPiManagementController({
      store: this.store,
      service: options.piSessionManagement,
      events: this.eventFactory,
      ready: () => this.ready(),
    });
    const historyReplay = new AgentSessionHistoryReplay({
      store: this.store,
      eventFactory: this.eventFactory,
    });
    const historyMutations = new AgentSessionHistoryMutationCoordinator({
      store: this.store,
      piSessions: options.piSessionMutations,
      memory: this.memory,
      artifacts: options.artifactSessionCleanup,
    });
    this.runCoordinator = new AgentSessionRunCoordinator({
      store: this.store,
      conversationProjector: this.conversationProjector,
      conversationPolicy,
      memory: this.memory,
      logger: options.logger,
      runResources: options.runResources,
      piSessions: options.piSessions,
      piDiagnostics: options.piDiagnostics,
      uploadStore: options.uploadStore,
      piSessionMutations: options.piSessionMutations,
      runControl: options.runControl,
      loopFactory: options.loopFactory,
      eventObserver: options.eventObserver,
    });
    this.messageCoordinator = new AgentSessionMessageCoordinator({
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
      piSessions: options.piSessionMutations,
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
    this.runCoordinator.beginShutdown();
  }

  shutdown(): Promise<void> {
    this.beginShutdown();
    return (this.shutdownPromise ??= this.runCoordinator.shutdown());
  }

  async createSession(request: { sessionId?: string; onEvent?: AgentEventSink }): Promise<void> {
    await this.sessionAdmissions.run(request.sessionId ?? createOpaqueId("automatic_session_creation"), async () => {
      await this.ready();
      const opened = this.store.open(request.sessionId);
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

  private async recoverRuntimeState(): Promise<void> {
    await this.forkCoordinator.recoverAll();
    await this.historyController.recoverAll();
    await this.closeCoordinator.recoverAll();
  }

  async submitMessage(request: {
    sessionId: string;
    requestId?: string;
    modelProviderId?: string;
    input: string;
    approvalMode: AgentExecutionApprovalMode;
    attachments?: AgentUploadAttachment[];
    metadata?: AgentConversationEntryMetadata;
    disposition?: AgentSessionMessageDisposition;
    queueMode?: AgentSessionMessageQueueMode;
    onEvent?: AgentEventSink;
    preparation?: AgentTurnPreparationSnapshot;
    systemPromptLayer?: import("../Orchestration/AgentRunDispatchPort.js").AgentSystemPromptLayer;
    allowedToolNames?: readonly string[];
    pinnedSkills?: readonly AgentPinnedSkillReference[];
    thinkingLevel?: import("@earendil-works/pi-ai").ModelThinkingLevel;
    inheritProjectContext?: boolean;
    sessionOwnership?: AgentSessionOwnership;
    interaction?: AgentInteractionContext;
  }): Promise<AgentSessionMessageAcceptance> {
    return this.messageCoordinator.submit(request);
  }

  /**
   * Re-enters a user session when detached work finishes. The first attempt
   * queues behind an active turn; otherwise it creates a fresh model turn.
   * The request id is supplied by the caller so replay after restart is
   * idempotent through the normal session command store.
   */
  async wakeFromBackgroundTask(request: {
    readonly sessionId: string;
    readonly requestId: string;
    readonly input: string;
    readonly approvalMode: AgentExecutionApprovalMode;
    readonly modelProviderId?: string;
    readonly onEvent?: AgentEventSink;
    readonly metadata?: AgentConversationEntryMetadata;
  }): Promise<"accepted" | "queued" | "missing" | "busy"> {
    await this.ready();
    const lookup = this.store.get(request.sessionId);
    if (lookup.kind === "missing") return "missing";

    if (this.runCoordinator.hasRunInFlight(request.sessionId)) {
      const queued = await this.runCoordinator.enqueueActiveRunMessage({
        session: lookup.session,
        requestId: request.requestId,
        input: request.input,
        metadata: request.metadata,
        queueMode: AgentSessionMessageQueueModes.FollowUp,
        onEvent: request.onEvent,
      });
      if (queued) return "queued";
      await this.runCoordinator.waitForIdle(request.sessionId);
    }

    // Admission can race with another request that starts between the idle
    // check and accept(). Follow the active run to its settled boundary rather
    // than relying on an arbitrary retry count or dropping the completion.
    while (true) {
      const acceptance = await this.messageCoordinator.accept({
        sessionId: request.sessionId,
        requestId: request.requestId,
        modelProviderId: request.modelProviderId,
        input: request.input,
        approvalMode: request.approvalMode,
        metadata: request.metadata,
        reclaimRunningCommand: true,
        disposition: AgentSessionMessageDispositions.RequireExisting,
        onEvent: request.onEvent,
      });
      if (acceptance.kind === "accepted") {
        void acceptance.completion?.catch(() => undefined);
        return "accepted";
      }
      if (acceptance.kind === "missing") return "missing";
      if (!this.runCoordinator.hasRunInFlight(request.sessionId)) return "busy";
      await this.runCoordinator.waitForIdle(request.sessionId);
    }
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

  /** Reads the bounded channel serializer context persisted with the session. */
  async loadChannelFinalizationContext(
    sessionId: string,
    platform?: AgentChannelKind,
  ): Promise<readonly AgentChannelFinalizationRecord[]> {
    await this.ready();
    const lookup = this.store.get(sessionId);
    return lookup.kind === "found"
      ? readAgentChannelFinalizationHistory(lookup.session.metadata?.channelFinalization).filter(
          (record) => platform === undefined || record.platform === platform,
        )
      : [];
  }

  /** Persists one successful ordered channel projection without polluting the user transcript. */
  async recordChannelFinalization(sessionId: string, record: AgentChannelFinalizationRecord): Promise<void> {
    await this.ready();
    await this.sessionAdmissions.run(sessionId, async () => {
      const lookup = this.store.get(sessionId);
      if (lookup.kind === "missing") return;
      lookup.session.metadata = {
        ...lookup.session.metadata,
        channelFinalization: appendAgentChannelFinalizationRecord(lookup.session.metadata?.channelFinalization, record),
      };
      lookup.session.updatedAt = laterIsoTimestamp(lookup.session.updatedAt, record.createdAt);
      this.store.persistMetadata(lookup.session);
    });
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
    sessionId: string;
    title: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    entryCount: number;
    messageCount: number;
    activeRequestId?: string;
    channel?: import("../ModelEndpoints/AgentModelMetadata.js").AgentChannelMetadata;
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
        sessionId: session.id,
        title: this.titleProjector.project(session),
        status: session.status,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        entryCount: session.entryCount,
        messageCount: session.messageCount,
        activeRequestId: session.activeRequest?.requestId,
        channel: session.metadata?.channel,
      }));
  }

  async replayHistory(request: { sessionId: string; refresh?: boolean; onEvent?: AgentEventSink }): Promise<void> {
    await this.historyController.replay(request);
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

  async steerActiveRun(request: {
    sessionId: string;
    input: string;
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
    input: string;
    approvalMode: AgentExecutionApprovalMode;
    attachments?: AgentUploadAttachment[];
    onEvent?: AgentEventSink;
  }): Promise<void> {
    await this.historyController.regenerate(request);
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
    try {
      await this.memory.flushContinuityLearning();
    } catch (error) {
      this.options.logger?.warn("continuity.learning.flush_before_compaction_failed", {
        sessionId: request.sessionId,
        error: serializeError(error),
      });
    }
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

function laterIsoTimestamp(current: string, candidate: string): string {
  return candidate > current ? candidate : current;
}

function projectAssistantDeliveryXml(content: string): string {
  return `<response><answer>${escapeXmlText(content)}</answer></response>`;
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
