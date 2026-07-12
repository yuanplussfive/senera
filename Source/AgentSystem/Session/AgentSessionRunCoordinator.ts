import type { AgentEventSink } from "../Events/AgentEvent.js";
import { AgentEventKinds, emitAgentEvent, withEventContext } from "../Events/AgentEvent.js";
import { AgentCancellationError } from "../Core/AgentCancellation.js";
import { createRequestId } from "../Core/AgentIds.js";
import { serializeError } from "../Diagnostics/AgentErrorSerializer.js";
import { type AgentConversationPolicy } from "../Conversation/AgentConversationPolicy.js";
import { type AgentConversationProjector } from "../Conversation/AgentConversationProjector.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { AgentLoopRunner } from "../Loop/AgentLoopRunner.js";
import { type AgentMemoryService } from "../Memory/AgentMemoryService.js";
import type { AgentMemoryCompletedTurnInput } from "../Memory/AgentMemorySourceRepository.js";
import type { AgentApprovalRuntime } from "../Approvals/AgentApprovalRuntime.js";
import type { AgentPiActiveSessionRegistry } from "../Pi/AgentPiActiveSessionRegistry.js";
import type { AgentPiSession } from "../Pi/AgentPiSubstrate.js";
import { createPiTraceEvent } from "../Pi/AgentPiTraceProjector.js";
import type { AgentUploadAttachment } from "../Uploads/AgentUploadTypes.js";
import { AgentSessionStatuses, type AgentSession } from "./AgentSession.js";
import {
  collectFreshConversationEntries,
  materializeSessionRunMessages,
  mergeSessionConversationEntries,
  projectSessionUserEntry,
  stampSessionStepTraces,
} from "./AgentSessionRunProjection.js";
import { AgentSessionRunSnapshotWriter } from "./AgentSessionRunSnapshotWriter.js";
import { type AgentSessionStore } from "./AgentSessionStore.js";

export interface AgentSessionRunCoordinatorOptions {
  store: AgentSessionStore;
  conversationPolicy: AgentConversationPolicy;
  conversationProjector: AgentConversationProjector;
  memory: AgentMemoryService;
  logger?: AgentLogger;
  approvalRuntime?: AgentApprovalRuntime;
  piSessions?: AgentPiActiveSessionRegistry;
  loopFactory: (modelProviderId?: string) => AgentLoopRunner;
}

export type AgentSessionAvailability =
  { kind: "available"; current: AgentSession } | { kind: "busy"; current: AgentSession };

export class AgentSessionRunCoordinator {
  private readonly activeRuns = new Map<string, ActiveSessionRun>();
  private readonly snapshots: AgentSessionRunSnapshotWriter;

  constructor(private readonly options: AgentSessionRunCoordinatorOptions) {
    this.snapshots = new AgentSessionRunSnapshotWriter(options.store);
  }

  assertAvailable(session: AgentSession): AgentSessionAvailability {
    const activeRun = this.activeRuns.get(session.id);
    if (session.status === AgentSessionStatuses.Running && !activeRun) {
      this.releaseSession(session);
      this.options.store.persistMetadata(session);
    }

    return activeRun
      ? {
          kind: "busy",
          current: session,
        }
      : {
          kind: "available",
          current: session,
        };
  }

  async runTurn(
    session: AgentSession,
    request: {
      requestId?: string;
      modelProviderId?: string;
      input: string;
      attachments?: AgentUploadAttachment[];
      onEvent?: AgentEventSink;
    },
  ): Promise<void> {
    const requestId = request.requestId?.trim() || createRequestId();
    const timestamp = new Date().toISOString();
    const userEntry = projectSessionUserEntry(this.options.conversationProjector, requestId, request, timestamp);
    const messages = materializeSessionRunMessages(this.options.conversationPolicy, session, userEntry);

    this.markSessionRunning(session, {
      requestId,
      input: request.input,
      startedAt: timestamp,
      attachments: request.attachments,
    });

    this.options.store.persistEntries(session.id, [userEntry]);
    this.snapshots.running({
      sessionId: session.id,
      requestId,
      text: request.input,
      startedAt: timestamp,
    });
    const run = this.registerActiveRun(session.id, requestId, request.onEvent);

    try {
      const result = await this.options.loopFactory(request.modelProviderId).run({
        sessionId: session.id,
        requestId,
        input: request.input,
        messages,
        conversationEntries: [...session.conversation, userEntry],
        signal: run.controller.signal,
        onEvent: async (event) => {
          if (!this.isActiveRun(session.id, run)) {
            return;
          }

          const contextualEvent = withEventContext(event, {
            sessionId: session.id,
          });
          await emitAgentEvent(request.onEvent, contextualEvent);
        },
      });
      if (!this.isActiveRun(session.id, run)) {
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

      const freshEntries = collectFreshConversationEntries(
        [...session.conversation, userEntry],
        [...result.conversationEntries, assistantEntry],
      );
      this.options.store.persistTurnArtifacts(
        session.id,
        requestId,
        freshEntries,
        stampSessionStepTraces(result.stepTraces, timestamp, assistantEntry.timestamp),
      );
      this.snapshots.completed({
        sessionId: session.id,
        requestId,
        text: request.input,
        startedAt: timestamp,
        endedAt: assistantEntry.timestamp,
        modelProvider: result.modelProvider,
      });
      this.recordCompletedTurn({
        sessionId: session.id,
        requestId,
        startedAt: timestamp,
        completedAt: assistantEntry.timestamp,
        userEntry,
        assistantEntry,
        terminal: result.terminal,
        turnUnderstanding: result.turnUnderstanding,
        conversationEntries: freshEntries,
        modelProvider: result.modelProvider,
      });

      session.conversation = mergeSessionConversationEntries([
        ...session.conversation,
        userEntry,
        ...result.conversationEntries,
        assistantEntry,
      ]);
      if (result.modelProvider) {
        session.metadata = {
          ...session.metadata,
          lastRun: {
            modelProvider: result.modelProvider,
            usage: result.usage,
          },
        };
      }
    } catch (error) {
      if (!this.isActiveRun(session.id, run)) {
        return;
      }

      if (error instanceof AgentCancellationError) {
        this.snapshots.cancelled({
          sessionId: session.id,
          requestId,
          text: request.input,
          startedAt: timestamp,
          error,
        });
        await this.emitRunCancelled(session.id, requestId, request.onEvent);
        return;
      }

      this.snapshots.failed({
        sessionId: session.id,
        requestId,
        text: request.input,
        startedAt: timestamp,
        error,
      });
      await this.emitRunFailed(session.id, requestId, error, request.onEvent);
      return;
    } finally {
      if (this.isActiveRun(session.id, run)) {
        this.options.approvalRuntime?.cancelByRequestId(requestId);
        this.activeRuns.delete(session.id);
        this.releaseSession(session);
        this.options.store.persistMetadata(session);
      }
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

  async cancelActiveRun(request: { sessionId: string; onEvent?: AgentEventSink }): Promise<boolean> {
    const run = this.activeRuns.get(request.sessionId);
    if (!run) {
      return false;
    }

    if (!run.cancelled) {
      run.cancelled = true;
      run.controller.abort(new AgentCancellationError());
      this.options.approvalRuntime?.cancelByRequestId(run.requestId);
    }

    this.activeRuns.delete(request.sessionId);
    const lookup = this.options.store.get(request.sessionId);
    if (lookup.kind === "found") {
      this.releaseSession(lookup.session);
      this.options.store.persistMetadata(lookup.session);
    }

    await this.emitRunCancelled(request.sessionId, run.requestId, request.onEvent ?? run.onEvent);

    const removedEntries = this.options.store.truncateFromRequest(request.sessionId, run.requestId);
    this.options.memory.deleteFromSessionRequest(request.sessionId, run.requestId);
    if (lookup.kind === "found") {
      lookup.session.updatedAt = new Date().toISOString();
      this.options.store.persistMetadata(lookup.session);
    }
    await emitAgentEvent(request.onEvent ?? run.onEvent, {
      kind: AgentEventKinds.SessionTruncated,
      context: { sessionId: request.sessionId },
      data: {
        sessionId: request.sessionId,
        fromRequestId: run.requestId,
        removedEntries,
      },
    });
    return true;
  }

  async steerActiveRun(request: {
    session: AgentSession;
    requestId?: string;
    input: string;
    attachments?: AgentUploadAttachment[];
    queueMode?: "steer" | "follow_up";
    onEvent?: AgentEventSink;
  }): Promise<boolean> {
    const run = this.activeRuns.get(request.session.id);
    const handle = this.options.piSessions?.get(request.session.id);
    if (!run || !handle || handle.requestId !== run.requestId) {
      return false;
    }

    const requestId = request.requestId?.trim() || createRequestId();
    const timestamp = new Date().toISOString();
    const userEntry = projectSessionUserEntry(this.options.conversationProjector, requestId, request, timestamp);

    this.options.store.persistEntries(request.session.id, [userEntry]);
    request.session.conversation = mergeSessionConversationEntries([...request.session.conversation, userEntry]);
    request.session.updatedAt = timestamp;
    this.options.store.persistMetadata(request.session);

    const queueMode = request.queueMode ?? "steer";
    await ActiveRunQueueHandlers[queueMode](handle.session, request.input);
    await emitAgentEvent(
      request.onEvent ?? run.onEvent,
      createPiTraceEvent({
        requestId: run.requestId,
        step: handle.step,
        source: "substrate",
        eventType: `runtime_queue.${ActiveRunQueueEventTypes[queueMode]}.accepted`,
        payload: {
          sessionId: request.session.id,
          queueMode,
          steeringRequestId: requestId,
          inputChars: request.input.length,
          attachmentCount: request.attachments?.length ?? 0,
        },
      }),
    );
    return true;
  }

  discardActiveRun(session: AgentSession): void {
    const run = this.activeRuns.get(session.id);
    if (run) {
      this.snapshots.activeRequestCancelled(session);
      run.controller.abort();
      this.activeRuns.delete(session.id);
    }
    this.releaseSession(session);
  }

  cleanupOrphanedRunningSnapshots(): void {
    this.snapshots.failOrphanedRunningSnapshots();
  }

  private markSessionRunning(session: AgentSession, activeRequest: NonNullable<AgentSession["activeRequest"]>): void {
    session.status = AgentSessionStatuses.Running;
    session.updatedAt = activeRequest.startedAt;
    session.activeRequest = activeRequest;
    this.options.store.persistMetadata(session);
  }

  private registerActiveRun(sessionId: string, requestId: string, onEvent?: AgentEventSink): ActiveSessionRun {
    this.activeRuns.get(sessionId)?.controller.abort();
    const run: ActiveSessionRun = {
      requestId,
      controller: new AbortController(),
      onEvent,
    };
    this.activeRuns.set(sessionId, run);
    return run;
  }

  private async emitRunCancelled(sessionId: string, requestId: string, onEvent?: AgentEventSink): Promise<void> {
    const event = {
      kind: AgentEventKinds.RunCancelled,
      context: { sessionId, requestId },
      data: { reason: "user_cancelled" },
    } as const;
    await emitAgentEvent(onEvent, event);
  }

  private async emitRunFailed(
    sessionId: string,
    requestId: string,
    error: unknown,
    onEvent?: AgentEventSink,
  ): Promise<void> {
    const event = {
      kind: AgentEventKinds.RunFailed,
      context: { sessionId, requestId },
      data: {
        message: readErrorMessage(error),
        details: serializeError(error),
      },
    } as const;
    await emitAgentEvent(onEvent, event);
  }

  private releaseSession(session: AgentSession): void {
    session.status = AgentSessionStatuses.Idle;
    session.updatedAt = new Date().toISOString();
    session.activeRequest = undefined;
  }

  private isActiveRun(sessionId: string, run: ActiveSessionRun): boolean {
    return this.activeRuns.get(sessionId) === run;
  }
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return agentErrorMessage("session.runFailed");
}

interface ActiveSessionRun {
  requestId: string;
  controller: AbortController;
  onEvent?: AgentEventSink;
  cancelled?: boolean;
}

const ActiveRunQueueEventTypes = {
  steer: "steer",
  follow_up: "follow_up",
} as const;

const ActiveRunQueueHandlers = {
  steer: (session: AgentPiSession, input: string) => session.steer(input),
  follow_up: (session: AgentPiSession, input: string) => session.followUp(input),
} satisfies Record<keyof typeof ActiveRunQueueEventTypes, (session: AgentPiSession, input: string) => Promise<void>>;
