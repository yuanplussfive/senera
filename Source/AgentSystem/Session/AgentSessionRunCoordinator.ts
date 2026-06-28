import type { AgentEventSink } from "../Events/AgentEvent.js";
import { AgentEventKinds, emitAgentEvent, withEventContext } from "../Events/AgentEvent.js";
import { AgentCancellationError } from "../Core/AgentCancellation.js";
import { createRequestId } from "../Core/AgentIds.js";
import { AgentConversationPolicy } from "../Conversation/AgentConversationPolicy.js";
import { AgentConversationProjector } from "../Conversation/AgentConversationProjector.js";
import type { AgentLoop } from "../Loop/AgentLoop.js";
import { AgentMemoryService } from "../Memory/AgentMemoryService.js";
import type { AgentUploadAttachment } from "../Uploads/AgentUploadTypes.js";
import {
  AgentSessionStatuses,
  type AgentSession,
} from "./AgentSession.js";
import {
  collectFreshConversationEntries,
  materializeSessionRunMessages,
  mergeSessionConversationEntries,
  projectSessionUserEntry,
  stampSessionStepTraces,
} from "./AgentSessionRunProjection.js";
import { AgentSessionRunSnapshotWriter } from "./AgentSessionRunSnapshotWriter.js";
import { AgentSessionStore } from "./AgentSessionStore.js";

export interface AgentSessionRunCoordinatorOptions {
  store: AgentSessionStore;
  conversationPolicy: AgentConversationPolicy;
  conversationProjector: AgentConversationProjector;
  memory: AgentMemoryService;
  loopFactory: (modelProviderId?: string) => AgentLoop;
}

export type AgentSessionAvailability =
  | { kind: "available"; current: AgentSession }
  | { kind: "busy"; current: AgentSession };

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
    const userEntry = projectSessionUserEntry(
      this.options.conversationProjector,
      requestId,
      request,
      timestamp,
    );
    const messages = materializeSessionRunMessages(
      this.options.conversationPolicy,
      session,
      userEntry,
    );

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
        requestId,
        input: request.input,
        messages,
        conversationEntries: [
          ...session.conversation,
          userEntry,
        ],
        signal: run.controller.signal,
        onEvent: (event) => this.isActiveRun(session.id, run)
          ? emitAgentEvent(
            request.onEvent,
            withEventContext(event, {
              sessionId: session.id,
            }),
          )
          : undefined,
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

      const freshEntries = collectFreshConversationEntries([
        ...session.conversation,
        userEntry,
      ], [
        ...result.conversationEntries,
        assistantEntry,
      ]);
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
      this.options.memory.recordCompletedTurn({
        sessionId: session.id,
        requestId,
        startedAt: timestamp,
        completedAt: assistantEntry.timestamp,
        userEntry,
        assistantEntry,
        terminal: result.terminal,
        turnUnderstanding: result.turnUnderstanding,
        conversationEntries: [
          ...result.conversationEntries,
          assistantEntry,
        ],
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
      throw error;
    } finally {
      if (this.isActiveRun(session.id, run)) {
        this.activeRuns.delete(session.id);
        this.releaseSession(session);
        this.options.store.persistMetadata(session);
      }
    }
  }

  async cancelActiveRun(request: {
    sessionId: string;
    onEvent?: AgentEventSink;
  }): Promise<boolean> {
    const run = this.activeRuns.get(request.sessionId);
    if (!run) {
      return false;
    }

    if (!run.cancelled) {
      run.cancelled = true;
      run.controller.abort(new AgentCancellationError());
    }

    this.activeRuns.delete(request.sessionId);
    const lookup = this.options.store.get(request.sessionId);
    if (lookup.kind === "found") {
      this.releaseSession(lookup.session);
      this.options.store.persistMetadata(lookup.session);
    }

    await emitAgentEvent(request.onEvent ?? run.onEvent, {
      kind: AgentEventKinds.RunCancelled,
      context: {
        sessionId: request.sessionId,
        requestId: run.requestId,
      },
      data: { reason: "user_cancelled" },
    });

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

  private markSessionRunning(
    session: AgentSession,
    activeRequest: NonNullable<AgentSession["activeRequest"]>,
  ): void {
    session.status = AgentSessionStatuses.Running;
    session.updatedAt = activeRequest.startedAt;
    session.activeRequest = activeRequest;
    this.options.store.persistMetadata(session);
  }

  private registerActiveRun(
    sessionId: string,
    requestId: string,
    onEvent?: AgentEventSink,
  ): ActiveSessionRun {
    this.activeRuns.get(sessionId)?.controller.abort();
    const run: ActiveSessionRun = {
      requestId,
      controller: new AbortController(),
      onEvent,
    };
    this.activeRuns.set(sessionId, run);
    return run;
  }

  private async emitRunCancelled(
    sessionId: string,
    requestId: string,
    onEvent?: AgentEventSink,
  ): Promise<void> {
    await emitAgentEvent(onEvent, {
      kind: AgentEventKinds.RunCancelled,
      context: { sessionId, requestId },
      data: { reason: "user_cancelled" },
    });
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

interface ActiveSessionRun {
  requestId: string;
  controller: AbortController;
  onEvent?: AgentEventSink;
  cancelled?: boolean;
}
