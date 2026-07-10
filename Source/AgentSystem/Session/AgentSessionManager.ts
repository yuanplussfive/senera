import type { AgentEventSink } from "../Events/AgentEvent.js";
import { AgentEventKinds, emitAgentEvent } from "../Events/AgentEvent.js";
import type { AgentEventEnvelope } from "../Events/AgentEventBase.js";
import { matchByKind } from "../Core/AgentMatch.js";
import { AgentConversationPolicy } from "../Conversation/AgentConversationPolicy.js";
import { AgentConversationProjector } from "../Conversation/AgentConversationProjector.js";
import type { AgentLoopRunner } from "../Loop/AgentLoopRunner.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import { AgentMemoryService, type AgentMemoryLearningSink } from "../Memory/AgentMemoryService.js";
import type { AgentMemorySourceRepository } from "../Memory/AgentMemorySourceRepository.js";
import type { AgentApprovalRuntime } from "../Approvals/AgentApprovalRuntime.js";
import type { AgentPiActiveSessionRegistry } from "../Pi/AgentPiActiveSessionRegistry.js";
import type { AgentPiSessionBootstrapPort } from "../Pi/AgentPiSessionBootstrapService.js";
import type { AgentUploadAttachment } from "../Uploads/AgentUploadTypes.js";
import type { AgentSession } from "./AgentSession.js";
import { AgentSessionEventFactory } from "./AgentSessionEventFactory.js";
import { AgentSessionHistoryReplay } from "./AgentSessionHistoryReplay.js";
import { AgentSessionRunCoordinator } from "./AgentSessionRunCoordinator.js";
import { AgentSessionStore } from "./AgentSessionStore.js";
import { AgentSessionTitleProjector } from "./AgentSessionTitleProjector.js";

export interface AgentSessionManagerOptions {
  loopFactory: (modelProviderId?: string) => AgentLoopRunner;
  store?: AgentSessionStore;
  conversationPolicy?: AgentConversationPolicy;
  conversationProjector?: AgentConversationProjector;
  memoryService?: AgentMemoryService;
  memorySourceRepository?: AgentMemorySourceRepository;
  memoryLearning?: AgentMemoryLearningSink;
  logger?: AgentLogger;
  approvalRuntime?: AgentApprovalRuntime;
  piSessions?: AgentPiActiveSessionRegistry;
  piSessionBootstrap?: AgentPiSessionBootstrapPort;
}

export type { AgentMemoryLearningSink } from "../Memory/AgentMemoryService.js";

export class AgentSessionManager {
  private readonly store: AgentSessionStore;
  private readonly memory: AgentMemoryService;
  private readonly eventFactory: AgentSessionEventFactory;
  private readonly historyReplay: AgentSessionHistoryReplay;
  private readonly runCoordinator: AgentSessionRunCoordinator;
  private readonly titleProjector: AgentSessionTitleProjector;

  constructor(private readonly options: AgentSessionManagerOptions) {
    const conversationPolicy = options.conversationPolicy ?? new AgentConversationPolicy();
    const conversationProjector = options.conversationProjector ?? new AgentConversationProjector();

    this.store = options.store ?? new AgentSessionStore();
    this.memory = options.memoryService ?? new AgentMemoryService({
      learning: options.memoryLearning,
      sourceRepository: options.memorySourceRepository,
    });
    this.eventFactory = new AgentSessionEventFactory(conversationPolicy);
    this.historyReplay = new AgentSessionHistoryReplay({
      store: this.store,
      conversationPolicy,
      eventFactory: this.eventFactory,
    });
    this.runCoordinator = new AgentSessionRunCoordinator({
      store: this.store,
      conversationPolicy,
      conversationProjector,
      memory: this.memory,
      logger: options.logger,
      approvalRuntime: options.approvalRuntime,
      piSessions: options.piSessions,
      loopFactory: options.loopFactory,
    });
    this.titleProjector = new AgentSessionTitleProjector((sessionId) => (
      this.store.loadConversation(sessionId)
    ));
    this.runCoordinator.cleanupOrphanedRunningSnapshots();
  }

  async createSession(request: {
    sessionId?: string;
    modelProviderId?: string;
    onEvent?: AgentEventSink;
  }): Promise<void> {
    const opened = this.store.open(request.sessionId);

    await emitAgentEvent(
      request.onEvent,
      matchByKind(opened, {
        created: ({ session }) => this.eventFactory.created(session),
        existing: ({ session }) => this.eventFactory.snapshot(session),
      }),
    );

    await this.options.piSessionBootstrap?.bootstrap({
      sessionId: opened.session.id,
      modelProviderId: request.modelProviderId,
      onEvent: request.onEvent,
    });
  }

  async closeSession(request: {
    sessionId: string;
    onEvent?: AgentEventSink;
  }): Promise<void> {
    const lookup = this.store.get(request.sessionId);

    await matchByKind(lookup, {
      missing: async ({ sessionId }) => {
        await emitAgentEvent(
          request.onEvent,
          this.eventFactory.notFound(sessionId, "session.close"),
        );
      },
      found: async ({ session }) => {
        this.runCoordinator.discardActiveRun(session);
        const closed = this.store.close(session.id);
        this.memory.deleteSession(session.id);
        await emitAgentEvent(
          request.onEvent,
          matchByKind(closed, {
            closed: ({ session: current }) => this.eventFactory.closed(current),
            missing: ({ sessionId }) => this.eventFactory.notFound(sessionId, "session.close"),
          }),
        );
      },
    });
  }

  async submitMessage(request: {
    sessionId: string;
    requestId?: string;
    modelProviderId?: string;
    input: string;
    attachments?: AgentUploadAttachment[];
    queueMode?: "steer" | "follow_up";
    onEvent?: AgentEventSink;
  }): Promise<void> {
    const lookup = this.store.get(request.sessionId);

    await matchByKind(lookup, {
      missing: async ({ sessionId }) => {
        await emitAgentEvent(
          request.onEvent,
          this.eventFactory.notFound(sessionId, "session.message"),
        );
      },
      found: async ({ session }) => {
        const gate = this.runCoordinator.assertAvailable(session);
        await matchByKind(gate, {
          available: async ({ current }) => {
            await this.runCoordinator.runTurn(current, request);
          },
          busy: async ({ current }) => {
            const steered = await this.runCoordinator.steerActiveRun({
              session: current,
              requestId: request.requestId,
              input: request.input,
              attachments: request.attachments,
              queueMode: request.queueMode,
              onEvent: request.onEvent,
            });
            if (steered) {
              return;
            }

            await emitAgentEvent(
              request.onEvent,
              this.eventFactory.busy(current, "session.message", request.requestId),
            );
          },
        });
      },
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
  }> {
    return this.store.listSessions().map((session) => ({
      sessionId: session.id,
      title: this.titleProjector.project(session),
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      entryCount: session.entryCount,
      messageCount: session.messageCount,
    }));
  }

  async replayHistory(request: {
    sessionId: string;
    refresh?: boolean;
    onEvent?: AgentEventSink;
  }): Promise<void> {
    await this.historyReplay.replay(request);
  }

  recordRunEvent(envelope: AgentEventEnvelope): void {
    if (!envelope.sessionId || !envelope.requestId) {
      return;
    }

    this.store.persistRunEvent(envelope.sessionId, envelope);
  }

  async renameSession(request: {
    sessionId: string;
    title: string;
    onEvent?: AgentEventSink;
  }): Promise<void> {
    const lookup = this.store.get(request.sessionId);
    if (lookup.kind === "missing") {
      await emitAgentEvent(
        request.onEvent,
        this.eventFactory.notFound(request.sessionId, "session.close"),
      );
      return;
    }

    this.store.rename(request.sessionId, request.title);
    await emitAgentEvent(request.onEvent, this.eventFactory.snapshot(lookup.session));
  }

  async cancelActiveRun(request: {
    sessionId: string;
    onEvent?: AgentEventSink;
  }): Promise<boolean> {
    return this.runCoordinator.cancelActiveRun(request);
  }

  async truncateFromRequest(request: {
    sessionId: string;
    requestId: string;
    onEvent?: AgentEventSink;
  }): Promise<void> {
    const lookup = this.store.get(request.sessionId);
    if (lookup.kind === "found") {
      this.runCoordinator.discardActiveRun(lookup.session);
    }

    const removed = this.store.truncateFromRequest(request.sessionId, request.requestId);
    this.memory.deleteFromSessionRequest(request.sessionId, request.requestId);
    this.persistTruncatedSessionMetadata(lookup.kind === "found" ? lookup.session : undefined);
    await emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.SessionTruncated,
      context: { sessionId: request.sessionId },
      data: {
        sessionId: request.sessionId,
        fromRequestId: request.requestId,
        removedEntries: removed,
      },
    });
  }

  async emitSessionListSnapshot(request: { onEvent?: AgentEventSink }): Promise<void> {
    await emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.SessionListSnapshot,
      context: {},
      data: { sessions: this.listSessions() },
    });
  }

  private persistTruncatedSessionMetadata(session: AgentSession | undefined): void {
    if (!session) {
      return;
    }

    session.updatedAt = new Date().toISOString();
    this.store.persistMetadata(session);
  }
}
