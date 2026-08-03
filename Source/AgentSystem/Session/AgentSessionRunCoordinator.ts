import type { AgentEventSink, AgentDomainEvent } from "../Events/AgentEvent.js";
import { AgentEventKinds, emitAgentEvent, withEventContext } from "../Events/AgentEvent.js";
import { AgentCancellationError } from "../Core/AgentCancellation.js";
import { createOpaqueId, createRequestId } from "../Core/AgentIds.js";
import { serializeError } from "../Diagnostics/AgentErrorSerializer.js";
import { type AgentConversationProjector } from "../Conversation/AgentConversationProjector.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { AgentLoopRunner } from "../Loop/AgentLoopRunner.js";
import { type AgentMemoryService } from "../Memory/AgentMemoryService.js";
import type { AgentMemoryCompletedTurnInput } from "../Memory/AgentMemorySourceRepository.js";
import type { AgentPiActiveSessionRegistry } from "../Pi/AgentPiActiveSessionRegistry.js";
import type { AgentPiDiagnosticSink } from "../Pi/AgentPiDiagnostics.js";
import type { AgentUploadAttachment } from "../Uploads/AgentUploadTypes.js";
import type { AgentSession } from "./AgentSession.js";
import {
  cloneAgentSessionState,
  collectFreshConversationEntries,
  mergeSessionConversationEntries,
  projectSessionUserEntry,
  replaceAgentSessionState,
  stampSessionStepTraces,
} from "./AgentSessionRunProjection.js";
import { type AgentSessionStore } from "./AgentSessionStore.js";
import type { AgentTurnPreparationSnapshot } from "../Loop/AgentTurnPreparationSnapshot.js";
import { AgentPiSessionLifecycleStates, withAgentPiSessionLifecycle } from "../Pi/AgentPiSessionLifecycleMetadata.js";
import type { AgentSessionMessageQueueMode } from "./AgentSessionMessageQueueMode.js";
import type { AgentSessionRunControlPolicy } from "./AgentSessionRunControlPolicy.js";
import type { AgentSessionRunResource } from "./AgentSessionRunResource.js";
import {
  resolveAgentToolAvailabilitySnapshot,
  withAgentToolAvailabilitySnapshot,
} from "../ToolRuntime/AgentToolAvailabilitySnapshot.js";
import type { AgentSessionHistoryMutationCoordinator } from "./AgentSessionHistoryMutationCoordinator.js";
import type { AgentConversationPolicy } from "../Conversation/AgentConversationPolicy.js";
import { createAgentSessionMessageCommand } from "./AgentSessionCommand.js";
import {
  AgentSessionActiveRunController,
  createAgentSessionRunCancelledEvent,
  createAgentSessionRunFailedEvent,
  readAgentSessionRunErrorMessage,
  type AgentSessionAvailability,
} from "./AgentSessionActiveRunController.js";

export interface AgentSessionRunCoordinatorOptions {
  store: AgentSessionStore;
  conversationProjector: AgentConversationProjector;
  conversationPolicy: AgentConversationPolicy;
  memory: AgentMemoryService;
  logger?: AgentLogger;
  runResources?: readonly AgentSessionRunResource[];
  piSessions?: AgentPiActiveSessionRegistry;
  piDiagnostics?: AgentPiDiagnosticSink;
  historyMutations: Pick<AgentSessionHistoryMutationCoordinator, "truncate">;
  runControl: AgentSessionRunControlPolicy;
  loopFactory: (modelProviderId?: string) => AgentLoopRunner;
}

export type { AgentSessionAvailability } from "./AgentSessionActiveRunController.js";
export { AgentSessionRunCoordinatorShuttingDownError } from "./AgentSessionActiveRunController.js";

export class AgentSessionRunCoordinator {
  private readonly activeRuns: AgentSessionActiveRunController;

  constructor(private readonly options: AgentSessionRunCoordinatorOptions) {
    this.activeRuns = new AgentSessionActiveRunController(options);
  }

  assertAvailable(session: AgentSession): AgentSessionAvailability {
    return this.activeRuns.assertAvailable(session);
  }

  async runTurn(
    session: AgentSession,
    request: {
      requestId?: string;
      modelProviderId?: string;
      input: string;
      attachments?: AgentUploadAttachment[];
      onEvent?: AgentEventSink;
      preparation?: AgentTurnPreparationSnapshot;
    },
  ): Promise<void> {
    this.activeRuns.assertAcceptingRuns();
    const requestId = request.requestId?.trim() || createRequestId();
    const timestamp = new Date().toISOString();
    const userEntry = projectSessionUserEntry(this.options.conversationProjector, requestId, request, timestamp);
    const command = createAgentSessionMessageCommand({
      requestId,
      modelProviderId: request.modelProviderId,
      text: request.input,
      attachments: request.attachments,
      createdAt: timestamp,
    });
    const runningSession = cloneAgentSessionState(session);
    this.activeRuns.markSessionRunning(runningSession, {
      requestId,
      input: request.input,
      startedAt: timestamp,
      attachments: request.attachments,
    });
    runningSession.conversation = mergeSessionConversationEntries([...runningSession.conversation, userEntry]);
    const runStartedEvent = withEventContext(
      {
        eventId: createOpaqueId("event"),
        kind: AgentEventKinds.RunStarted,
        context: { requestId },
        data: { input: request.input },
      },
      { sessionId: session.id },
    );
    const admission = this.options.store.persistRunStart(
      runningSession,
      requestId,
      userEntry,
      {
        sessionId: session.id,
        requestId,
        input: request.input,
        status: "running",
        startedAt: timestamp,
        updatedAt: timestamp,
      },
      runStartedEvent,
      command,
    );
    if (admission.kind === "replayed") {
      await this.replayDurableRunEvents(session.id, requestId, request.onEvent);
      return;
    }

    replaceAgentSessionState(session, runningSession);
    const run = this.activeRuns.register(session.id, requestId, request.onEvent);
    const terminalEvents: AgentDomainEvent[] = [];
    let terminalSessionCommitted = false;
    let terminalCommitFailed = false;

    try {
      await emitAgentEvent(request.onEvent, runStartedEvent);
      const loop = this.options.loopFactory(request.modelProviderId);
      const inheritedToolNames = resolveAgentToolAvailabilitySnapshot(session.metadata, loop.preparationFingerprint);
      const result = await loop.run({
        sessionId: session.id,
        requestId,
        input: request.input,
        conversationEntries: [...session.conversation],
        loadedToolNames: inheritedToolNames,
        signal: run.controller.signal,
        emitRunStarted: false,
        onEvent: async (event) => {
          if (!this.activeRuns.isCurrent(session.id, run)) {
            return;
          }

          const contextualEvent = withEventContext(event, {
            sessionId: session.id,
          });
          await emitAgentEvent(request.onEvent, contextualEvent);
        },
        preparation: request.preparation,
        onPreparation: (snapshot) => {
          this.options.store.persistTurnPreparation(session.id, requestId, snapshot);
          if (loop.preparationFingerprint && snapshot.loadedToolNames.length > 0) {
            session.metadata = withAgentToolAvailabilitySnapshot(
              session.metadata,
              loop.preparationFingerprint,
              snapshot.loadedToolNames,
            );
            this.options.store.persistMetadata(session);
          }
        },
        onPiBranchBoundary: (entryId) => {
          this.options.store.persistTurnPreparationBoundary(session.id, requestId, entryId);
          session.metadata = withAgentPiSessionLifecycle(
            session.metadata,
            AgentPiSessionLifecycleStates.Initialized,
            request.modelProviderId,
          );
          this.options.store.persistMetadata(session);
        },
        commitTerminalEvents: (events) => {
          terminalEvents.push(
            ...events.map((event) =>
              withEventContext(event, {
                sessionId: session.id,
                requestId,
              }),
            ),
          );
        },
      });
      if (!this.activeRuns.isCurrent(session.id, run)) {
        return;
      }

      const assistantEntry = this.options.conversationProjector.projectAssistantDecision(
        requestId,
        result.decisionXml,
        new Date().toISOString(),
        result.modelProvider
          ? {
              run: {
                modelProvider: result.modelProvider,
                usage: result.usage,
              },
            }
          : undefined,
      );

      const freshEntries = collectFreshConversationEntries(session.conversation, [
        ...result.conversationEntries,
        assistantEntry,
      ]);
      const completedAt = assistantEntry.timestamp;
      const completedSession = cloneAgentSessionState(session);
      completedSession.conversation = mergeSessionConversationEntries([
        ...completedSession.conversation,
        ...result.conversationEntries,
        assistantEntry,
      ]);
      if (result.modelProvider) {
        completedSession.metadata = {
          ...completedSession.metadata,
          lastRun: {
            modelProvider: result.modelProvider,
            usage: result.usage,
          },
        };
      }
      if (loop.preparationFingerprint && result.loadedToolNames && result.loadedToolNames.length > 0) {
        completedSession.metadata = withAgentToolAvailabilitySnapshot(
          completedSession.metadata,
          loop.preparationFingerprint,
          result.loadedToolNames,
        );
      }
      this.activeRuns.releaseSession(completedSession);
      completedSession.updatedAt = completedAt;
      try {
        this.options.store.persistTurnCommit(
          session.id,
          requestId,
          freshEntries,
          stampSessionStepTraces(result.stepTraces, timestamp, assistantEntry.timestamp),
          {
            sessionId: session.id,
            requestId,
            input: request.input,
            status: "completed",
            startedAt: timestamp,
            updatedAt: completedAt,
            endedAt: completedAt,
            modelProvider: result.modelProvider,
          },
          terminalEvents,
          completedSession,
        );
      } catch (error) {
        terminalCommitFailed = true;
        throw error;
      }
      replaceAgentSessionState(session, completedSession);
      terminalSessionCommitted = true;
      await this.publishTerminalEvents(request.onEvent, terminalEvents);
      this.recordCompletedTurn({
        sessionId: session.id,
        requestId,
        startedAt: timestamp,
        completedAt: assistantEntry.timestamp,
        userEntry,
        assistantEntry,
        terminal: result.terminal,
        conversationEntries: freshEntries,
        executedTools: result.executedTools,
        modelProvider: result.modelProvider,
      });
    } catch (error) {
      if (!this.activeRuns.isCurrent(session.id, run)) {
        return;
      }

      if (error instanceof AgentCancellationError) {
        const endedAt = new Date().toISOString();
        const cancelledEvent = createAgentSessionRunCancelledEvent(session.id, requestId);
        const cancelledSession = cloneAgentSessionState(session);
        this.activeRuns.releaseSession(cancelledSession);
        cancelledSession.updatedAt = endedAt;
        try {
          this.options.store.persistTurnCommit(
            session.id,
            requestId,
            [],
            [],
            {
              sessionId: session.id,
              requestId,
              input: request.input,
              status: "cancelled",
              startedAt: timestamp,
              updatedAt: endedAt,
              endedAt,
              errorMessage: error.message,
            },
            [cancelledEvent],
            cancelledSession,
          );
        } catch (commitError) {
          terminalCommitFailed = true;
          throw commitError;
        }
        replaceAgentSessionState(session, cancelledSession);
        terminalSessionCommitted = true;
        if (!run.suppressCancellationEvent) {
          await this.publishTerminalEvents(request.onEvent, [cancelledEvent]);
        }
        return;
      }

      const endedAt = new Date().toISOString();
      const failedEvent = createAgentSessionRunFailedEvent(session.id, requestId, error);
      const failedSession = cloneAgentSessionState(session);
      this.activeRuns.releaseSession(failedSession);
      failedSession.updatedAt = endedAt;
      try {
        this.options.store.persistTurnCommit(
          session.id,
          requestId,
          [],
          [],
          {
            sessionId: session.id,
            requestId,
            input: request.input,
            status: "failed",
            startedAt: timestamp,
            updatedAt: endedAt,
            endedAt,
            errorMessage: readAgentSessionRunErrorMessage(error),
          },
          [failedEvent],
          failedSession,
        );
      } catch (commitError) {
        terminalCommitFailed = true;
        throw commitError;
      }
      replaceAgentSessionState(session, failedSession);
      terminalSessionCommitted = true;
      await this.publishTerminalEvents(request.onEvent, [failedEvent]);
      return;
    } finally {
      await this.activeRuns.finalize({
        session,
        requestId,
        run,
        terminalSessionCommitted,
        terminalCommitFailed,
      });
    }
  }

  private recordCompletedTurn(input: AgentMemoryCompletedTurnInput): void {
    try {
      this.options.memory.recordCompletedTurn(input);
    } catch (error) {
      this.options.logger?.warn("memory.record_completed_turn.failed", {
        error: serializeError(error),
      });
    }
  }

  private async replayDurableRunEvents(
    sessionId: string,
    requestId: string,
    onEvent: AgentEventSink | undefined,
  ): Promise<void> {
    for (const event of this.options.store.loadRunEventsForRequest(sessionId, requestId)) {
      await emitAgentEvent(onEvent, {
        eventId: event.eventId,
        kind: event.kind,
        context: {
          sessionId: event.sessionId ?? sessionId,
          requestId: event.requestId ?? requestId,
          step: event.step,
          scope: event.scope,
        },
        data: event.data,
      } as AgentDomainEvent);
    }
  }

  private async publishTerminalEvents(
    onEvent: AgentEventSink | undefined,
    events: readonly AgentDomainEvent[],
  ): Promise<void> {
    for (const event of events) {
      try {
        await emitAgentEvent(onEvent, event);
      } catch (error) {
        this.options.logger?.warn("session.terminal_event.publish_failed", {
          kind: event.kind,
          sessionId: "sessionId" in event.context ? event.context.sessionId : undefined,
          requestId: "requestId" in event.context ? event.context.requestId : undefined,
          error: serializeError(error),
        });
      }
    }
  }

  async cancelActiveRun(request: { sessionId: string; onEvent?: AgentEventSink }): Promise<boolean> {
    return this.activeRuns.cancelActiveRun(request);
  }

  async enqueueActiveRunMessage(request: {
    session: AgentSession;
    requestId?: string;
    input: string;
    attachments?: AgentUploadAttachment[];
    queueMode: AgentSessionMessageQueueMode;
    onEvent?: AgentEventSink;
  }): Promise<boolean> {
    return this.activeRuns.enqueueActiveRunMessage(request);
  }

  async discardActiveRun(session: AgentSession): Promise<boolean> {
    return this.activeRuns.discardActiveRun(session);
  }

  hasActiveRun(sessionId: string): boolean {
    return this.activeRuns.hasActiveRun(sessionId);
  }

  beginShutdown(): void {
    this.activeRuns.beginShutdown();
  }

  shutdown(): Promise<void> {
    return this.activeRuns.shutdown();
  }

  cleanupOrphanedRunningSnapshots(): void {
    this.activeRuns.cleanupOrphanedRunningSnapshots();
  }

  requestActiveRunCancellation(sessionId: string): boolean {
    return this.activeRuns.requestActiveRunCancellation(sessionId);
  }
}
