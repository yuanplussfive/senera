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
import { AgentSessionMessageCoordinator } from "./AgentSessionMessageCoordinator.js";
import { AgentSessionHistoryController } from "./AgentSessionHistoryController.js";

export type { AgentMemoryLearningSink, AgentSessionManagerOptions } from "./AgentSessionManagerOptions.js";

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
  private readyPromise?: Promise<void>;
  private readonly sessionAdmissions: AgentSessionAdmissionCoordinator;
  private shutdownPromise?: Promise<void>;

  constructor(private readonly options: AgentSessionManagerOptions) {
    const conversationPolicy = options.conversationPolicy ?? new AgentConversationPolicy();
    const conversationProjector = options.conversationProjector ?? new AgentConversationProjector();

    this.store = options.store ?? new AgentSessionStore();
    this.sessionAdmissions = new AgentSessionAdmissionCoordinator({
      retain: (sessionId) => this.store.retainWorkingSession(sessionId),
    });
    this.memory =
      options.memoryService ??
      new AgentMemoryService({
        learning: options.memoryLearning,
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
      conversationProjector,
      conversationPolicy,
      memory: this.memory,
      logger: options.logger,
      runResources: options.runResources,
      piSessions: options.piSessions,
      piDiagnostics: options.piDiagnostics,
      historyMutations,
      runControl: options.runControl,
      loopFactory: options.loopFactory,
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
    attachments?: AgentUploadAttachment[];
    disposition?: AgentSessionMessageDisposition;
    queueMode?: AgentSessionMessageQueueMode;
    onEvent?: AgentEventSink;
    preparation?: AgentTurnPreparationSnapshot;
  }): Promise<void> {
    await this.messageCoordinator.submit(request);
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
  }> {
    return this.store.listSessions().map((session) => ({
      sessionId: session.id,
      title: this.titleProjector.project(session),
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      entryCount: session.entryCount,
      messageCount: session.messageCount,
      activeRequestId: session.activeRequest?.requestId,
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

  async cancelActiveRun(request: { sessionId: string; onEvent?: AgentEventSink }): Promise<boolean> {
    await this.ready();
    this.historyController.invalidate(request.sessionId);
    this.runCoordinator.requestActiveRunCancellation(request.sessionId);
    return this.sessionAdmissions.run(request.sessionId, () => this.runCoordinator.cancelActiveRun(request));
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
    attachments?: AgentUploadAttachment[];
    onEvent?: AgentEventSink;
  }): Promise<void> {
    await this.historyController.regenerate(request);
  }

  async forkSession(request: {
    sourceSessionId: string;
    sessionId: string;
    throughRequestId: string;
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
      case "pi_unavailable":
        await this.piManagement.emitUnavailable(request, AgentSessionOperations.Fork);
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

  compactSession(request: { sessionId: string; customInstructions?: string; onEvent?: AgentEventSink }): Promise<void> {
    return this.piManagement.run(
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
