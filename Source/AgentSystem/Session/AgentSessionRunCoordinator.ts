import type { AgentEventSink, AgentDomainEvent } from "../Events/AgentEvent.js";
import { AgentEventKinds, emitAgentEvent, withEventContext } from "../Events/AgentEvent.js";
import { AgentCancellationError } from "../Core/AgentCancellation.js";
import { createOpaqueId, createRequestId } from "../Core/AgentIds.js";
import { serializeError } from "../Diagnostics/AgentErrorSerializer.js";
import { type AgentConversationPolicy } from "../Conversation/AgentConversationPolicy.js";
import { type AgentConversationProjector } from "../Conversation/AgentConversationProjector.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { AgentLoopRunner } from "../Loop/AgentLoopRunner.js";
import { type AgentMemoryService } from "../Memory/AgentMemoryService.js";
import type { AgentMemoryCompletedTurnInput } from "../Memory/AgentMemorySourceRepository.js";
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
import type { AgentTurnPreparationSnapshot } from "../Loop/AgentTurnPreparationSnapshot.js";
import { AgentPiSessionLifecycleStates, withAgentPiSessionLifecycle } from "../Pi/AgentPiSessionLifecycleMetadata.js";
import type { AgentSessionMessageQueueMode } from "./AgentSessionMessageQueueMode.js";
import {
  AgentSessionRunSettlementTimeoutError,
  type AgentSessionRunControlPolicy,
  waitForAgentSessionRunSettlement,
} from "./AgentSessionRunControlPolicy.js";
import type { AgentSessionRunResource } from "./AgentSessionRunResource.js";
import { releaseAgentLifecycleResources } from "../Core/AgentLifecycleResource.js";
import {
  resolveAgentToolAvailabilitySnapshot,
  withAgentToolAvailabilitySnapshot,
} from "../ToolRuntime/AgentToolAvailabilitySnapshot.js";
import { clearAgentSessionCancellation, withAgentSessionCancellationPending } from "./AgentSessionLifecycleMetadata.js";

export interface AgentSessionRunCoordinatorOptions {
  store: AgentSessionStore;
  conversationPolicy: AgentConversationPolicy;
  conversationProjector: AgentConversationProjector;
  memory: AgentMemoryService;
  logger?: AgentLogger;
  runResources?: readonly AgentSessionRunResource[];
  piSessions?: AgentPiActiveSessionRegistry;
  runControl: AgentSessionRunControlPolicy;
  loopFactory: (modelProviderId?: string) => AgentLoopRunner;
}

export type AgentSessionAvailability =
  { kind: "available"; current: AgentSession } | { kind: "busy"; current: AgentSession };

export class AgentSessionRunCoordinator {
  private readonly activeRuns = new Map<string, ActiveSessionRun>();
  private readonly snapshots: AgentSessionRunSnapshotWriter;
  private readonly runResources: readonly AgentSessionRunResource[];

  constructor(private readonly options: AgentSessionRunCoordinatorOptions) {
    this.snapshots = new AgentSessionRunSnapshotWriter(options.store);
    this.runResources = [...(options.runResources ?? [])];
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
      preparation?: AgentTurnPreparationSnapshot;
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
    const runStartedEvent = withEventContext(
      {
        eventId: createOpaqueId("event"),
        kind: AgentEventKinds.RunStarted,
        context: { requestId },
        data: { input: request.input },
      },
      { sessionId: session.id },
    );
    this.options.store.persistRunStart(
      session,
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
    );
    session.conversation = mergeSessionConversationEntries([...session.conversation, userEntry]);
    const run = this.registerActiveRun(session.id, requestId, request.onEvent);
    const terminalEvents: AgentDomainEvent[] = [];
    let terminalSessionCommitted = false;

    try {
      await emitAgentEvent(request.onEvent, runStartedEvent);
      const loop = this.options.loopFactory(request.modelProviderId);
      const inheritedToolNames = resolveAgentToolAvailabilitySnapshot(session.metadata, loop.preparationFingerprint);
      const result = await loop.run({
        sessionId: session.id,
        requestId,
        input: request.input,
        messages,
        conversationEntries: [...session.conversation],
        loadedToolNames: inheritedToolNames,
        signal: run.controller.signal,
        emitRunStarted: false,
        onEvent: async (event) => {
          if (!this.isActiveRun(session.id, run)) {
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
          if (loop.preparationFingerprint) {
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

      const freshEntries = collectFreshConversationEntries(session.conversation, [
        ...result.conversationEntries,
        assistantEntry,
      ]);
      const completedAt = assistantEntry.timestamp;
      session.conversation = mergeSessionConversationEntries([
        ...session.conversation,
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
      if (loop.preparationFingerprint && result.loadedToolNames) {
        session.metadata = withAgentToolAvailabilitySnapshot(
          session.metadata,
          loop.preparationFingerprint,
          result.loadedToolNames,
        );
      }
      this.releaseSession(session);
      session.updatedAt = completedAt;
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
        session,
      );
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
        turnUnderstanding: result.turnUnderstanding,
        conversationEntries: freshEntries,
        modelProvider: result.modelProvider,
      });
    } catch (error) {
      if (!this.isActiveRun(session.id, run)) {
        return;
      }

      if (error instanceof AgentCancellationError) {
        if (!run.suppressCancellationEvent) {
          const endedAt = new Date().toISOString();
          const cancelledEvent = this.createRunCancelledEvent(session.id, requestId);
          this.releaseSession(session);
          session.updatedAt = endedAt;
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
            session,
          );
          terminalSessionCommitted = true;
          await this.publishTerminalEvents(request.onEvent, [cancelledEvent]);
        }
        return;
      }

      const endedAt = new Date().toISOString();
      const failedEvent = this.createRunFailedEvent(session.id, requestId, error);
      this.releaseSession(session);
      session.updatedAt = endedAt;
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
          errorMessage: readErrorMessage(error),
        },
        [failedEvent],
        session,
      );
      terminalSessionCommitted = true;
      await this.publishTerminalEvents(request.onEvent, [failedEvent]);
      return;
    } finally {
      try {
        if (this.isActiveRun(session.id, run)) {
          await this.cleanupRunOwnedResources(session.id, requestId);
          this.activeRuns.delete(session.id);
          if (!terminalSessionCommitted) {
            this.releaseSession(session);
            this.options.store.persistMetadata(session);
          }
        }
      } finally {
        run.resolveSettled();
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

  private async cleanupRunOwnedResources(sessionId: string, requestId: string): Promise<void> {
    const failures = await releaseAgentLifecycleResources(this.runResources, { sessionId, requestId });
    failures.forEach((failure) => {
      this.options.logger?.warn("session.run_owned_resource.cleanup_failed", {
        sessionId,
        requestId,
        resource: failure.resourceId,
        error: serializeError(failure.error),
      });
    });
  }

  async cancelActiveRun(request: { sessionId: string; onEvent?: AgentEventSink }): Promise<boolean> {
    const run = this.activeRuns.get(request.sessionId);
    if (!run) {
      return false;
    }

    const lookup = this.options.store.get(request.sessionId);
    await this.stopActiveRun(lookup.kind === "found" ? lookup.session : undefined, run);

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

  async enqueueActiveRunMessage(request: {
    session: AgentSession;
    requestId?: string;
    input: string;
    attachments?: AgentUploadAttachment[];
    queueMode: AgentSessionMessageQueueMode;
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

    const queueMode = request.queueMode;
    await ActiveRunQueueHandlers[queueMode](handle.session, request.input);

    this.options.store.persistEntries(request.session.id, [userEntry]);
    request.session.conversation = mergeSessionConversationEntries([...request.session.conversation, userEntry]);
    request.session.updatedAt = timestamp;
    this.options.store.persistMetadata(request.session);

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

  async discardActiveRun(session: AgentSession): Promise<boolean> {
    const run = this.activeRuns.get(session.id);
    if (run) {
      await this.stopActiveRun(session, run);
      return true;
    }
    this.releaseSession(session);
    return false;
  }

  hasActiveRun(sessionId: string): boolean {
    return this.activeRuns.has(sessionId);
  }

  cleanupOrphanedRunningSnapshots(): void {
    this.snapshots.reconcileOrphanedRunningSnapshots();
  }

  requestActiveRunCancellation(sessionId: string): boolean {
    const run = this.activeRuns.get(sessionId);
    if (!run) return false;
    const lookup = this.options.store.get(sessionId);
    void this.beginStopActiveRun(lookup.kind === "found" ? lookup.session : undefined, run).catch(() => undefined);
    return true;
  }

  private markSessionRunning(session: AgentSession, activeRequest: NonNullable<AgentSession["activeRequest"]>): void {
    session.status = AgentSessionStatuses.Running;
    session.updatedAt = activeRequest.startedAt;
    session.activeRequest = activeRequest;
  }

  private registerActiveRun(sessionId: string, requestId: string, onEvent?: AgentEventSink): ActiveSessionRun {
    if (this.activeRuns.has(sessionId)) {
      throw new Error(`Session ${sessionId} already has an active run.`);
    }
    const settlement = createRunSettlement();
    const run: ActiveSessionRun = {
      requestId,
      controller: new AbortController(),
      onEvent,
      settled: settlement.promise,
      resolveSettled: settlement.resolve,
    };
    this.activeRuns.set(sessionId, run);
    return run;
  }

  private async stopActiveRun(session: AgentSession | undefined, run: ActiveSessionRun): Promise<void> {
    const settlement = this.beginStopActiveRun(session, run);
    try {
      await waitForAgentSessionRunSettlement({
        sessionId: session?.id ?? "unknown",
        requestId: run.requestId,
        settlement,
        policy: this.options.runControl,
      });
    } catch (error) {
      if (error instanceof AgentSessionRunSettlementTimeoutError) {
        if (session?.activeRequest?.requestId === run.requestId && this.isActiveRun(session.id, run)) {
          session.metadata = withAgentSessionCancellationPending(session.metadata, {
            requestId: run.requestId,
            input: session.activeRequest.input,
            startedAt: session.activeRequest.startedAt,
            requestedAt: new Date().toISOString(),
            timeoutMs: error.timeoutMs,
          });
          this.options.store.persistMetadata(session);
        }
        this.options.logger?.warn("session.run_settlement.timeout", {
          sessionId: error.sessionId,
          requestId: error.requestId,
          timeoutMs: error.timeoutMs,
        });
      }
      throw error;
    }
  }

  private beginStopActiveRun(session: AgentSession | undefined, run: ActiveSessionRun): Promise<void> {
    if (!run.stopPromise) {
      run.suppressCancellationEvent = true;
      const cancellation = new AgentCancellationError();
      const activeRequest =
        session?.activeRequest?.requestId === run.requestId ? { ...session.activeRequest } : undefined;
      const piHandle = session ? this.options.piSessions?.get(session.id) : undefined;
      const cancellationStartedAt = performance.now();
      const abortPiSession = piHandle?.requestId === run.requestId ? piHandle.session.abort() : Promise.resolve();
      run.controller.abort(cancellation);
      const settleRun = run.settled.then(() => {
        if (!session || !activeRequest) return;
        this.snapshots.cancelled({
          sessionId: session.id,
          requestId: activeRequest.requestId,
          text: activeRequest.input,
          startedAt: activeRequest.startedAt,
          error: cancellation,
        });
      });
      run.stopPromise = this.settleActiveRunWithTelemetry({
        sessionId: session?.id,
        run,
        startedAt: cancellationStartedAt,
        components: [
          { name: "agent_loop", settlement: settleRun, startedAt: cancellationStartedAt },
          { name: "pi_session", settlement: abortPiSession, startedAt: cancellationStartedAt },
        ],
      });
    }
    return run.stopPromise;
  }

  private async settleActiveRunWithTelemetry(input: {
    sessionId?: string;
    run: ActiveSessionRun;
    startedAt: number;
    components: readonly AgentRunCancellationComponent[];
  }): Promise<void> {
    await this.emitCancellationProgress(input, { stage: "started" });
    const settlements = input.components.map((component) => this.observeCancellationComponent(input, component));
    try {
      await settleActiveRun(settlements);
      await this.emitCancellationProgress(input, {
        stage: "completed",
        durationMs: elapsedMilliseconds(input.startedAt),
      });
    } catch (error) {
      await this.emitCancellationProgress(input, {
        stage: "failed",
        durationMs: elapsedMilliseconds(input.startedAt),
        message: readErrorMessage(error),
      });
      throw error;
    }
  }

  private async observeCancellationComponent(
    input: { sessionId?: string; run: ActiveSessionRun; startedAt: number },
    component: AgentRunCancellationComponent,
  ): Promise<void> {
    try {
      await component.settlement;
      await this.emitCancellationProgress(input, {
        stage: "component_completed",
        component: component.name,
        durationMs: elapsedMilliseconds(component.startedAt),
      });
    } catch (error) {
      await this.emitCancellationProgress(input, {
        stage: "component_failed",
        component: component.name,
        durationMs: elapsedMilliseconds(component.startedAt),
        message: readErrorMessage(error),
      });
      throw error;
    }
  }

  private async emitCancellationProgress(
    input: { sessionId?: string; run: ActiveSessionRun },
    data: {
      stage: "started" | "component_completed" | "component_failed" | "completed" | "failed";
      component?: "agent_loop" | "pi_session";
      durationMs?: number;
      message?: string;
    },
  ): Promise<void> {
    try {
      await emitAgentEvent(input.run.onEvent, {
        kind: AgentEventKinds.RunCancellationProgress,
        context: { sessionId: input.sessionId, requestId: input.run.requestId },
        data,
      });
    } catch (error) {
      this.options.logger?.warn("session.run_cancellation.telemetry_failed", {
        sessionId: input.sessionId,
        requestId: input.run.requestId,
        stage: data.stage,
        component: data.component,
        error: serializeError(error),
      });
    }
  }

  private async emitRunCancelled(sessionId: string, requestId: string, onEvent?: AgentEventSink): Promise<void> {
    await emitAgentEvent(onEvent, this.createRunCancelledEvent(sessionId, requestId));
  }

  private createRunCancelledEvent(sessionId: string, requestId: string): AgentDomainEvent {
    return {
      eventId: createOpaqueId("event"),
      kind: AgentEventKinds.RunCancelled,
      context: { sessionId, requestId },
      data: { reason: "user_cancelled" },
    };
  }

  private createRunFailedEvent(sessionId: string, requestId: string, error: unknown): AgentDomainEvent {
    return {
      eventId: createOpaqueId("event"),
      kind: AgentEventKinds.RunFailed,
      context: { sessionId, requestId },
      data: {
        message: readErrorMessage(error),
        details: serializeError(error),
      },
    };
  }

  private releaseSession(session: AgentSession): void {
    session.status = AgentSessionStatuses.Idle;
    session.updatedAt = new Date().toISOString();
    session.activeRequest = undefined;
    session.metadata = clearAgentSessionCancellation(session.metadata);
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
  settled: Promise<void>;
  resolveSettled: () => void;
  stopPromise?: Promise<void>;
  suppressCancellationEvent?: boolean;
}

interface AgentRunCancellationComponent {
  name: "agent_loop" | "pi_session";
  settlement: Promise<void>;
  startedAt: number;
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100);
}

function createRunSettlement(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settled) => {
    resolve = settled;
  });
  return { promise, resolve };
}

async function settleActiveRun(settlements: readonly Promise<void>[]): Promise<void> {
  const outcomes = await Promise.allSettled(settlements);
  const failures = outcomes.flatMap((outcome) => (outcome.status === "rejected" ? [outcome.reason] : []));
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Active run settlement failed.");
}

const ActiveRunQueueEventTypes = {
  steer: "steer",
  follow_up: "follow_up",
} as const;

const ActiveRunQueueHandlers = {
  steer: (session: AgentPiSession, input: string) => session.steer(input),
  follow_up: (session: AgentPiSession, input: string) => session.followUp(input),
} satisfies Record<keyof typeof ActiveRunQueueEventTypes, (session: AgentPiSession, input: string) => Promise<void>>;
