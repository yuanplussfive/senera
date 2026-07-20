import type { AgentEventSink } from "../Events/AgentEvent.js";
import { AgentEventKinds, emitAgentEvent } from "../Events/AgentEvent.js";
import type { AgentEventEnvelope } from "../Events/AgentEventBase.js";
import { matchByKind } from "../Core/AgentMatch.js";
import { AgentConversationPolicy } from "../Conversation/AgentConversationPolicy.js";
import { AgentConversationProjector } from "../Conversation/AgentConversationProjector.js";
import type { AgentLoopRunner } from "../Loop/AgentLoopRunner.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import { serializeError } from "../Diagnostics/AgentErrorSerializer.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import { AgentMemoryService, type AgentMemoryLearningSink } from "../Memory/AgentMemoryService.js";
import type { AgentMemorySourceRepository } from "../Memory/AgentMemorySourceRepository.js";
import type { AgentPiActiveSessionRegistry } from "../Pi/AgentPiActiveSessionRegistry.js";
import type { AgentPiSessionMutationPort } from "../Pi/AgentPiSessionMutationService.js";
import type { AgentUploadAttachment } from "../Uploads/AgentUploadTypes.js";
import type { AgentSession } from "./AgentSession.js";
import { AgentSessionEventFactory } from "./AgentSessionEventFactory.js";
import { AgentSessionHistoryReplay } from "./AgentSessionHistoryReplay.js";
import { AgentSessionRunCoordinator } from "./AgentSessionRunCoordinator.js";
import { AgentSessionStore, type AgentSessionCloseResult } from "./AgentSessionStore.js";
import { AgentSessionTitleProjector } from "./AgentSessionTitleProjector.js";
import type { AgentTurnPreparationSnapshot } from "../Loop/AgentTurnPreparationSnapshot.js";
import { resolveAgentPiSessionLifecycle } from "../Pi/AgentPiSessionLifecycleMetadata.js";
import {
  AgentSessionMessageDispositions,
  type AgentSessionMessageDisposition,
} from "./AgentSessionMessageDisposition.js";
import { AgentSessionControlEpoch } from "./AgentSessionControlEpoch.js";
import type { AgentSessionMessageQueueMode } from "./AgentSessionMessageQueueMode.js";
import type { AgentSessionRunControlPolicy } from "./AgentSessionRunControlPolicy.js";
import type { AgentSessionRunResource } from "./AgentSessionRunResource.js";
import type { AgentSessionResource } from "./AgentSessionResource.js";
import { releaseAgentLifecycleResources } from "../Core/AgentLifecycleResource.js";
import { resolveAgentSessionLifecycle, withAgentSessionCloseFailure } from "./AgentSessionLifecycleMetadata.js";
import {
  AgentSessionHistoryMutationCoordinator,
  type AgentSessionHistoryMutationResult,
} from "./AgentSessionHistoryMutationCoordinator.js";
import { AgentKeyedLeaseQueue } from "../Core/AgentKeyedLeaseQueue.js";
import { createOpaqueId } from "../Core/AgentIds.js";

export interface AgentSessionManagerOptions {
  loopFactory: (modelProviderId?: string) => AgentLoopRunner;
  store?: AgentSessionStore;
  conversationPolicy?: AgentConversationPolicy;
  conversationProjector?: AgentConversationProjector;
  memoryService?: AgentMemoryService;
  memorySourceRepository?: AgentMemorySourceRepository;
  memoryLearning?: AgentMemoryLearningSink;
  logger?: AgentLogger;
  runResources?: readonly AgentSessionRunResource[];
  sessionResources?: readonly AgentSessionResource[];
  piSessions?: AgentPiActiveSessionRegistry;
  piSessionMutations?: AgentPiSessionMutationPort;
  runControl: AgentSessionRunControlPolicy;
  artifactSessionCleanup?: {
    removeSessionArtifacts(sessionId: string): Promise<unknown>;
  };
}

export type { AgentMemoryLearningSink } from "../Memory/AgentMemoryService.js";

export class AgentSessionManager {
  private readonly store: AgentSessionStore;
  private readonly memory: AgentMemoryService;
  private readonly eventFactory: AgentSessionEventFactory;
  private readonly historyReplay: AgentSessionHistoryReplay;
  private readonly runCoordinator: AgentSessionRunCoordinator;
  private readonly titleProjector: AgentSessionTitleProjector;
  private readonly historyMutations: AgentSessionHistoryMutationCoordinator;
  private readyPromise?: Promise<void>;
  private readonly controlEpoch = new AgentSessionControlEpoch();
  private readonly sessionAdmissions = new AgentKeyedLeaseQueue<string>();
  private readonly regenerationLineages = new Map<string, AgentSessionRegenerationLineage>();

  constructor(private readonly options: AgentSessionManagerOptions) {
    const conversationPolicy = options.conversationPolicy ?? new AgentConversationPolicy();
    const conversationProjector = options.conversationProjector ?? new AgentConversationProjector();

    this.store = options.store ?? new AgentSessionStore();
    this.memory =
      options.memoryService ??
      new AgentMemoryService({
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
      runResources: options.runResources,
      piSessions: options.piSessions,
      runControl: options.runControl,
      loopFactory: options.loopFactory,
    });
    this.titleProjector = new AgentSessionTitleProjector((sessionId) => this.store.loadConversation(sessionId));
    this.runCoordinator.cleanupOrphanedRunningSnapshots();
    this.historyMutations = new AgentSessionHistoryMutationCoordinator({
      store: this.store,
      piSessions: options.piSessionMutations,
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

  async createSession(request: { sessionId?: string; onEvent?: AgentEventSink }): Promise<void> {
    await this.sessionAdmissions.run(request.sessionId ?? createOpaqueId("automatic_session_creation"), async () => {
      await this.ready();
      const opened = this.store.open(request.sessionId);
      await this.recoverSessionHistoryMutation(opened.session.id, request.onEvent);

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
      this.controlEpoch.issue(request.sessionId);
      const lookup = this.store.get(request.sessionId);

      await matchByKind(lookup, {
        missing: async ({ sessionId }) => {
          await emitAgentEvent(request.onEvent, this.eventFactory.notFound(sessionId, "session.close"));
        },
        found: async ({ session }) => {
          let closed: AgentSessionCloseResult;
          try {
            closed = await this.cleanupAndDeleteSession(session, request.onEvent);
          } catch (error) {
            this.persistSessionCloseFailure(session, error);
            throw error;
          }
          await emitAgentEvent(
            request.onEvent,
            matchByKind(closed, {
              closed: ({ session: current }) => this.eventFactory.closed(current),
              missing: ({ sessionId }) => this.eventFactory.notFound(sessionId, "session.close"),
            }),
          );
        },
      });
    });
  }

  private async releaseSessionResources(session: AgentSession, onEvent?: AgentEventSink): Promise<void> {
    const piSession = resolveAgentPiSessionLifecycle(session.metadata);
    const piReset = piSession.initialized
      ? this.options.piSessionMutations?.reset({
          sessionId: session.id,
          modelProviderId: piSession.modelProviderId,
          onEvent,
        })
      : undefined;
    const [piOutcome, resourceFailures] = await Promise.all([
      piReset ? Promise.allSettled([piReset]) : Promise.resolve([]),
      releaseAgentLifecycleResources(this.options.sessionResources ?? [], { sessionId: session.id }),
    ]);
    const failures: unknown[] = [];
    for (const outcome of piOutcome) {
      if (outcome.status === "fulfilled") continue;
      failures.push(outcome.reason);
      this.options.logger?.warn("session.pi_resource.cleanup_failed", {
        sessionId: session.id,
        error: serializeError(outcome.reason),
      });
    }
    for (const failure of resourceFailures) {
      failures.push(failure.error);
      this.options.logger?.warn("session.resource.cleanup_failed", {
        sessionId: session.id,
        resource: failure.resourceId,
        error: serializeError(failure.error),
      });
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, `Session ${session.id} cleanup failed.`);
  }

  private async cleanupAndDeleteSession(
    session: AgentSession,
    onEvent?: AgentEventSink,
  ): Promise<AgentSessionCloseResult> {
    await this.runCoordinator.discardActiveRun(session);
    await this.releaseSessionResources(session, onEvent);
    await this.options.artifactSessionCleanup?.removeSessionArtifacts(session.id);
    this.memory.deleteSession(session.id);
    this.regenerationLineages.delete(session.id);
    const closed = this.store.close(session.id);
    if (closed.kind === "missing") {
      throw new Error(`Session ${session.id} disappeared during close cleanup.`);
    }
    return closed;
  }

  private persistSessionCloseFailure(session: AgentSession, error: unknown): void {
    session.metadata = withAgentSessionCloseFailure(session.metadata, {
      requestedAt: new Date().toISOString(),
      failures: cleanupFailureMessages(error),
    });
    session.updatedAt = new Date().toISOString();
    this.store.persistMetadata(session);
  }

  private async recoverRuntimeState(): Promise<void> {
    await this.recoverPendingHistoryMutations();
    for (const session of this.store.listSessions()) {
      if (!resolveAgentSessionLifecycle(session.metadata).close) continue;
      try {
        await this.cleanupAndDeleteSession(session);
      } catch (error) {
        this.persistSessionCloseFailure(session, error);
        this.options.logger?.warn("session.close_recovery.failed", {
          sessionId: session.id,
          error: serializeError(error),
        });
      }
    }
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
    const { completion } = await this.acceptMessage(request);
    await completion;
  }

  private async acceptMessage(request: {
    sessionId: string;
    requestId?: string;
    modelProviderId?: string;
    input: string;
    attachments?: AgentUploadAttachment[];
    disposition?: AgentSessionMessageDisposition;
    queueMode?: AgentSessionMessageQueueMode;
    onEvent?: AgentEventSink;
    preparation?: AgentTurnPreparationSnapshot;
  }): Promise<{ completion?: Promise<void> }> {
    return this.sessionAdmissions.run(request.sessionId, () => this.acceptMessageUnderAdmission(request));
  }

  private async acceptMessageUnderAdmission(request: {
    sessionId: string;
    requestId?: string;
    modelProviderId?: string;
    input: string;
    attachments?: AgentUploadAttachment[];
    disposition?: AgentSessionMessageDisposition;
    queueMode?: AgentSessionMessageQueueMode;
    onEvent?: AgentEventSink;
    preparation?: AgentTurnPreparationSnapshot;
  }): Promise<{ completion?: Promise<void> }> {
    let completion: Promise<void> | undefined;
    await this.ready();
    let lookup = this.store.get(request.sessionId);
    if (lookup.kind === "missing" && request.disposition === AgentSessionMessageDispositions.CreateIfMissing) {
      const opened = this.store.open(request.sessionId);
      lookup = { kind: "found", session: opened.session };
      await emitAgentEvent(
        request.onEvent,
        matchByKind(opened, {
          created: ({ session }) => this.eventFactory.created(session),
          existing: ({ session }) => this.eventFactory.snapshot(session),
        }),
      );
    }

    await matchByKind(lookup, {
      missing: async ({ sessionId }) => {
        await emitAgentEvent(request.onEvent, this.eventFactory.notFound(sessionId, "session.message"));
      },
      found: async ({ session }) => {
        await this.recoverSessionHistoryMutation(session.id, request.onEvent);
        const gate = this.runCoordinator.assertAvailable(session);
        await matchByKind(gate, {
          available: ({ current }) => {
            completion = this.runCoordinator.runTurn(current, request);
          },
          busy: async ({ current }) => {
            if (request.queueMode) {
              const queued = await this.runCoordinator.enqueueActiveRunMessage({
                session: current,
                requestId: request.requestId,
                input: request.input,
                attachments: request.attachments,
                queueMode: request.queueMode,
                onEvent: request.onEvent,
              });
              if (queued) return;

              const refreshed = this.runCoordinator.assertAvailable(current);
              if (refreshed.kind === "available") {
                completion = this.runCoordinator.runTurn(refreshed.current, request);
                return;
              }
            }

            await emitAgentEvent(
              request.onEvent,
              this.eventFactory.busy(current, "session.message", request.requestId),
            );
          },
        });
      },
    });
    return { completion };
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
    await this.sessionAdmissions.run(request.sessionId, async () => {
      await this.ready();
      await this.recoverSessionHistoryMutation(request.sessionId, request.onEvent);
      await this.historyReplay.replay(request);
    });
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
        await emitAgentEvent(request.onEvent, this.eventFactory.notFound(request.sessionId, "session.close"));
        return;
      }

      this.store.rename(request.sessionId, request.title);
      await emitAgentEvent(request.onEvent, this.eventFactory.snapshot(lookup.session));
    });
  }

  async cancelActiveRun(request: { sessionId: string; onEvent?: AgentEventSink }): Promise<boolean> {
    await this.ready();
    this.controlEpoch.issue(request.sessionId);
    this.runCoordinator.requestActiveRunCancellation(request.sessionId);
    return this.sessionAdmissions.run(request.sessionId, () => this.runCoordinator.cancelActiveRun(request));
  }

  async truncateFromRequest(request: {
    sessionId: string;
    requestId: string;
    onEvent?: AgentEventSink;
    preparation?: AgentTurnPreparationSnapshot;
  }): Promise<void> {
    await this.sessionAdmissions.run(request.sessionId, async () => {
      await this.ready();
      this.controlEpoch.issue(request.sessionId);
      const lookup = this.store.get(request.sessionId);
      let truncated: AgentSessionHistoryMutationResult | undefined;
      if (lookup.kind === "found") {
        await this.runCoordinator.discardActiveRun(lookup.session);
        const preparation = request.preparation ?? this.store.loadTurnPreparation(request.sessionId, request.requestId);
        truncated = await this.historyMutations.truncate({
          session: lookup.session,
          fromRequestId: request.requestId,
          preparation,
          onEvent: request.onEvent,
        });
      }
      this.deleteMutationMemory(truncated);
      this.regenerationLineages.delete(request.sessionId);
      await this.emitSessionTruncated(request, { removedEntries: truncated?.removedEntries ?? 0 });
    });
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
    await this.ready();
    const token = this.controlEpoch.issue(request.sessionId);
    this.runCoordinator.requestActiveRunCancellation(request.sessionId);
    let completion: Promise<void> | undefined;
    await this.sessionAdmissions.run(request.sessionId, async () => {
      if (!this.controlEpoch.isCurrent(token)) {
        await this.emitSupersededRegeneration(request);
        return;
      }

      const inheritedLineage = this.resolveRegenerationLineage(request.sessionId, request.fromRequestId);
      const preparation =
        this.store.loadTurnPreparation(request.sessionId, request.fromRequestId) ?? inheritedLineage?.preparation;
      const lookup = this.store.get(request.sessionId);
      if (lookup.kind === "found") {
        await this.discardActiveRunForRegeneration(lookup.session, {
          requestId: request.requestId,
          onEvent: request.onEvent,
        });
      }
      if (!this.controlEpoch.isCurrent(token)) {
        await this.emitSupersededRegeneration(request);
        return;
      }

      const truncationRequestId = this.resolveRegenerationTruncationRequestId(
        request.sessionId,
        request.fromRequestId,
        inheritedLineage?.currentRequestId,
      );
      const mutationResult =
        lookup.kind === "found"
          ? await this.historyMutations.truncate({
              session: lookup.session,
              fromRequestId: truncationRequestId,
              preparation,
              onEvent: request.onEvent,
            })
          : undefined;
      this.deleteMutationMemory(mutationResult);
      this.regenerationLineages.set(request.sessionId, {
        sourceRequestId: inheritedLineage?.sourceRequestId ?? request.fromRequestId,
        currentRequestId: request.requestId,
        preparation,
      });
      await this.emitSessionTruncated(
        {
          sessionId: request.sessionId,
          requestId: truncationRequestId,
          replacementRequestId: request.requestId,
          onEvent: request.onEvent,
        },
        { removedEntries: mutationResult?.removedEntries ?? 0 },
      );
      if (!this.controlEpoch.isCurrent(token)) {
        await this.emitSupersededRegeneration(request);
        return;
      }

      const accepted = await this.acceptMessageUnderAdmission({
        sessionId: request.sessionId,
        requestId: request.requestId,
        modelProviderId: request.modelProviderId,
        input: request.input,
        attachments: request.attachments,
        preparation,
        onEvent: request.onEvent,
      });
      completion = accepted.completion;
    });
    await completion;
  }

  async forkSession(request: {
    sourceSessionId: string;
    sessionId: string;
    throughRequestId: string;
    onEvent?: AgentEventSink;
  }): Promise<void> {
    await this.ready();
    await this.recoverSessionHistoryMutation(request.sourceSessionId, request.onEvent);
    const result = this.store.fork(request);
    switch (result.kind) {
      case "source_missing":
        await emitAgentEvent(request.onEvent, this.eventFactory.notFound(result.sourceSessionId, "session.fork"));
        return;
      case "target_exists":
        await emitAgentEvent(request.onEvent, {
          kind: AgentEventKinds.RequestInvalid,
          context: { sessionId: result.sessionId },
          data: { message: agentErrorMessage("session.forkTargetExists", { sessionId: result.sessionId }) },
        });
        return;
      case "request_missing":
        await emitAgentEvent(request.onEvent, {
          kind: AgentEventKinds.RequestInvalid,
          context: { sessionId: result.sourceSessionId },
          data: { message: agentErrorMessage("session.forkBoundaryMissing", { requestId: result.requestId }) },
        });
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
        await this.historyReplay.replay({ sessionId: result.session.id, onEvent: request.onEvent });
    }
  }

  async emitSessionListSnapshot(request: { onEvent?: AgentEventSink }): Promise<void> {
    await this.ready();
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

  private async discardActiveRunForRegeneration(
    session: AgentSession,
    progress: { requestId: string; onEvent?: AgentEventSink },
  ): Promise<void> {
    if (!this.runCoordinator.hasActiveRun(session.id)) {
      await this.runCoordinator.discardActiveRun(session);
      return;
    }

    const startedAt = performance.now();
    await this.emitRegenerationCancellationProgress(session.id, progress, { stage: "started" });
    try {
      await this.runCoordinator.discardActiveRun(session);
      await this.emitRegenerationCancellationProgress(session.id, progress, {
        stage: "completed",
        durationMs: elapsedMilliseconds(startedAt),
      });
    } catch (error) {
      await this.emitRegenerationCancellationProgress(session.id, progress, {
        stage: "failed",
        durationMs: elapsedMilliseconds(startedAt),
        message: readErrorMessage(error),
      });
      throw error;
    }
  }

  private async emitRegenerationCancellationProgress(
    sessionId: string,
    progress: { requestId: string; onEvent?: AgentEventSink },
    data: {
      stage: "started" | "completed" | "failed";
      durationMs?: number;
      message?: string;
    },
  ): Promise<void> {
    try {
      await emitAgentEvent(progress.onEvent, {
        kind: AgentEventKinds.RunCancellationProgress,
        context: { sessionId, requestId: progress.requestId },
        data,
      });
    } catch (error) {
      this.options.logger?.warn("session.regeneration_cancellation.telemetry_failed", {
        sessionId,
        requestId: progress.requestId,
        stage: data.stage,
        error: serializeError(error),
      });
    }
  }

  private async recoverPendingHistoryMutations(): Promise<void> {
    for (const result of await this.historyMutations.recoverAll()) {
      this.deleteMutationMemory(result);
    }
  }

  private async recoverSessionHistoryMutation(sessionId: string, onEvent?: AgentEventSink): Promise<void> {
    this.deleteMutationMemory(await this.historyMutations.recoverSession(sessionId, onEvent));
  }

  private deleteMutationMemory(result: AgentSessionHistoryMutationResult | undefined): void {
    if (!result) return;
    this.memory.deleteFromSessionRequest(result.mutation.sessionId, result.mutation.fromRequestId);
  }

  private emitSessionTruncated(
    request: {
      sessionId: string;
      requestId: string;
      replacementRequestId?: string;
      onEvent?: AgentEventSink;
    },
    result: AgentSessionTruncationResult,
  ): Promise<void> {
    return emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.SessionTruncated,
      context: { sessionId: request.sessionId },
      data: {
        sessionId: request.sessionId,
        fromRequestId: request.requestId,
        removedEntries: result.removedEntries,
        replacementRequestId: request.replacementRequestId,
      },
    });
  }

  private emitSupersededRegeneration(request: {
    sessionId: string;
    requestId: string;
    onEvent?: AgentEventSink;
  }): Promise<void> {
    return emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.RunCancelled,
      context: { sessionId: request.sessionId, requestId: request.requestId },
      data: { reason: "user_cancelled" },
    });
  }

  private resolveRegenerationLineage(
    sessionId: string,
    requestId: string,
  ): AgentSessionRegenerationLineage | undefined {
    const lineage = this.regenerationLineages.get(sessionId);
    return lineage && (lineage.sourceRequestId === requestId || lineage.currentRequestId === requestId)
      ? lineage
      : undefined;
  }

  private resolveRegenerationTruncationRequestId(
    sessionId: string,
    requestedId: string,
    inheritedCurrentId: string | undefined,
  ): string {
    const requestIds = new Set(this.store.loadConversation(sessionId).map((entry) => entry.requestId));
    if (requestIds.has(requestedId)) return requestedId;
    return inheritedCurrentId && requestIds.has(inheritedCurrentId) ? inheritedCurrentId : requestedId;
  }
}

interface AgentSessionTruncationResult {
  readonly removedEntries: number;
}

interface AgentSessionRegenerationLineage {
  readonly sourceRequestId: string;
  readonly currentRequestId: string;
  readonly preparation?: AgentTurnPreparationSnapshot;
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100);
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cleanupFailureMessages(error: unknown): string[] {
  if (error instanceof AggregateError) return error.errors.flatMap(cleanupFailureMessages);
  return [readErrorMessage(error)];
}
