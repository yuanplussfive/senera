import { AgentCancellationError } from "../Core/AgentCancellation.js";
import { releaseAgentLifecycleResources } from "../Core/AgentLifecycleResource.js";
import { createOpaqueId, createRequestId } from "../Core/AgentIds.js";
import type { AgentConversationPolicy } from "../Conversation/AgentConversationPolicy.js";
import type { AgentConversationProjector } from "../Conversation/AgentConversationProjector.js";
import { serializeError } from "../Diagnostics/AgentErrorSerializer.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import { AgentEventKinds, emitAgentEvent, type AgentDomainEvent, type AgentEventSink } from "../Events/AgentEvent.js";
import { agentErrorMessage, type AgentLocalizedMessage } from "../I18n/AgentMessageCatalog.js";
import { projectAgentErrorMessage } from "../I18n/AgentMessageProjection.js";
import type { AgentPiActiveSessionRegistry } from "../Pi/AgentPiActiveSessionRegistry.js";
import {
  AgentPiDiagnosticSources,
  emitAgentPiDiagnostic,
  type AgentPiDiagnosticSink,
} from "../Pi/AgentPiDiagnostics.js";
import type { AgentPiSession } from "../Pi/AgentPiRuntimeTypes.js";
import type { AgentUploadAttachment } from "../Uploads/AgentUploadTypes.js";
import { AgentSessionStatuses, type AgentSession } from "./AgentSession.js";
import type { AgentSessionHistoryMutationCoordinator } from "./AgentSessionHistoryMutationCoordinator.js";
import { clearAgentSessionCancellation, withAgentSessionCancellationPending } from "./AgentSessionLifecycleMetadata.js";
import { AgentSessionMessageQueueModes, type AgentSessionMessageQueueMode } from "./AgentSessionMessageQueueMode.js";
import {
  AgentSessionRunSettlementTimeoutError,
  type AgentSessionRunControlPolicy,
  waitForAgentSessionRunSettlement,
} from "./AgentSessionRunControlPolicy.js";
import type { AgentSessionRunResource } from "./AgentSessionRunResource.js";
import {
  cloneAgentSessionState,
  mergeSessionConversationEntries,
  projectSessionUserEntry,
  replaceAgentSessionState,
} from "./AgentSessionRunProjection.js";
import { AgentSessionRunSnapshotWriter } from "./AgentSessionRunSnapshotWriter.js";
import type { AgentSessionStore } from "./AgentSessionStore.js";

export interface AgentSessionActiveRunControllerOptions {
  readonly store: AgentSessionStore;
  readonly conversationProjector: AgentConversationProjector;
  readonly conversationPolicy: AgentConversationPolicy;
  readonly runControl: AgentSessionRunControlPolicy;
  readonly historyMutations: Pick<AgentSessionHistoryMutationCoordinator, "truncate">;
  readonly runResources?: readonly AgentSessionRunResource[];
  readonly piSessions?: AgentPiActiveSessionRegistry;
  readonly piDiagnostics?: AgentPiDiagnosticSink;
  readonly logger?: AgentLogger;
}

export interface AgentSessionActiveRun {
  readonly requestId: string;
  readonly controller: AbortController;
  readonly onEvent?: AgentEventSink;
  readonly settled: Promise<void>;
  readonly resolveSettled: () => void;
  stopPromise?: Promise<void>;
  suppressCancellationEvent?: boolean;
}

export type AgentSessionAvailability =
  { kind: "available"; current: AgentSession } | { kind: "busy"; current: AgentSession };

export class AgentSessionActiveRunController {
  private readonly activeRuns = new Map<string, AgentSessionActiveRun>();
  private readonly snapshots: AgentSessionRunSnapshotWriter;
  private readonly runResources: readonly AgentSessionRunResource[];
  private acceptingRuns = true;
  private shutdownPromise?: Promise<void>;

  constructor(private readonly options: AgentSessionActiveRunControllerOptions) {
    this.snapshots = new AgentSessionRunSnapshotWriter(options.store);
    this.runResources = [...(options.runResources ?? [])];
  }

  assertAcceptingRuns(): void {
    if (!this.acceptingRuns) throw new AgentSessionRunCoordinatorShuttingDownError();
  }

  assertAvailable(session: AgentSession): AgentSessionAvailability {
    const activeRun = this.activeRuns.get(session.id);
    if (session.status === AgentSessionStatuses.Running && !activeRun) {
      this.releaseSession(session);
      this.options.store.persistMetadata(session);
    }
    return activeRun ? { kind: "busy", current: session } : { kind: "available", current: session };
  }

  markSessionRunning(session: AgentSession, activeRequest: NonNullable<AgentSession["activeRequest"]>): void {
    session.status = AgentSessionStatuses.Running;
    session.updatedAt = activeRequest.startedAt;
    session.activeRequest = activeRequest;
  }

  register(sessionId: string, requestId: string, onEvent?: AgentEventSink): AgentSessionActiveRun {
    if (this.activeRuns.has(sessionId)) throw new Error(`Session ${sessionId} already has an active run.`);
    const settlement = createRunSettlement();
    const run: AgentSessionActiveRun = {
      requestId,
      controller: new AbortController(),
      onEvent,
      settled: settlement.promise,
      resolveSettled: settlement.resolve,
    };
    this.activeRuns.set(sessionId, run);
    return run;
  }

  isCurrent(sessionId: string, run: AgentSessionActiveRun): boolean {
    return this.activeRuns.get(sessionId) === run;
  }

  async finalize(input: {
    session: AgentSession;
    requestId: string;
    run: AgentSessionActiveRun;
    terminalSessionCommitted: boolean;
    terminalCommitFailed: boolean;
  }): Promise<void> {
    try {
      if (!this.isCurrent(input.session.id, input.run)) return;
      await this.cleanupRunOwnedResources(input.session.id, input.requestId);
      this.activeRuns.delete(input.session.id);
      if (!input.terminalSessionCommitted && !input.terminalCommitFailed) {
        const releasedSession = cloneAgentSessionState(input.session);
        this.releaseSession(releasedSession);
        this.options.store.persistMetadata(releasedSession);
        replaceAgentSessionState(input.session, releasedSession);
      }
      this.options.store.trimWorkingSet();
    } finally {
      input.run.resolveSettled();
    }
  }

  async cancelActiveRun(request: { sessionId: string; onEvent?: AgentEventSink }): Promise<boolean> {
    const run = this.activeRuns.get(request.sessionId);
    if (!run) return false;

    const lookup = this.options.store.get(request.sessionId);
    await this.stopActiveRun(lookup.kind === "found" ? lookup.session : undefined, run);
    await emitAgentEvent(
      request.onEvent ?? run.onEvent,
      createAgentSessionRunCancelledEvent(request.sessionId, run.requestId),
    );

    if (lookup.kind === "missing") {
      throw new Error(`Active session disappeared during cancellation: ${request.sessionId}`);
    }
    const mutation = await this.options.historyMutations.truncate({
      session: lookup.session,
      fromRequestId: run.requestId,
      preparation: this.options.store.loadTurnPreparation(request.sessionId, run.requestId),
    });
    if (mutation.kind === "boundary_missing") {
      throw new Error(`Active request disappeared during cancellation: ${request.sessionId}/${run.requestId}`);
    }
    await emitAgentEvent(request.onEvent ?? run.onEvent, {
      kind: AgentEventKinds.SessionTruncated,
      context: { sessionId: request.sessionId },
      data: {
        sessionId: request.sessionId,
        fromRequestId: run.requestId,
        removedEntries: mutation.removedEntries,
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
    if (!run || !handle || handle.requestId !== run.requestId) return false;

    const requestId = request.requestId?.trim() || createRequestId();
    const timestamp = new Date().toISOString();
    const userEntry = projectSessionUserEntry(
      this.options.conversationProjector,
      requestId,
      { ...request, queue: { parentRequestId: run.requestId, mode: request.queueMode } },
      timestamp,
    );
    const renderedInput = this.options.conversationPolicy.renderCurrentUserMessage(userEntry);
    await ActiveRunQueueHandlers[request.queueMode](handle.session, renderedInput);

    this.options.store.persistEntries(request.session.id, [userEntry]);
    request.session.conversation = mergeSessionConversationEntries([...request.session.conversation, userEntry]);
    request.session.updatedAt = timestamp;
    this.options.store.persistMetadata(request.session);

    await emitAgentPiDiagnostic(this.options.piDiagnostics, {
      context: { sessionId: request.session.id, requestId: run.requestId, step: handle.step },
      source: AgentPiDiagnosticSources.Substrate,
      name: `runtime_queue.${request.queueMode}.accepted`,
      details: {
        queueMode: request.queueMode,
        steeringRequestId: requestId,
        inputChars: request.input.length,
        attachmentCount: request.attachments?.length ?? 0,
      },
    });
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

  requestActiveRunCancellation(sessionId: string): boolean {
    const run = this.activeRuns.get(sessionId);
    if (!run) return false;
    const lookup = this.options.store.get(sessionId);
    void this.beginStopActiveRun(lookup.kind === "found" ? lookup.session : undefined, run).catch(() => undefined);
    return true;
  }

  beginShutdown(): void {
    this.acceptingRuns = false;
  }

  shutdown(): Promise<void> {
    this.beginShutdown();
    return (this.shutdownPromise ??= this.settleAllActiveRuns());
  }

  cleanupOrphanedRunningSnapshots(): void {
    this.snapshots.reconcileOrphanedRunningSnapshots();
  }

  releaseSession(session: AgentSession): void {
    session.status = AgentSessionStatuses.Idle;
    session.updatedAt = new Date().toISOString();
    session.activeRequest = undefined;
    session.metadata = clearAgentSessionCancellation(session.metadata);
  }

  private async settleAllActiveRuns(): Promise<void> {
    const settlements = [...this.activeRuns.entries()].map(([sessionId, run]) => {
      const lookup = this.options.store.get(sessionId);
      return this.stopActiveRun(lookup.kind === "found" ? lookup.session : undefined, run);
    });
    const outcomes = await Promise.allSettled(settlements);
    const failures = outcomes.flatMap((outcome) => (outcome.status === "rejected" ? [outcome.reason] : []));
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Session run shutdown failed.");
  }

  private async stopActiveRun(session: AgentSession | undefined, run: AgentSessionActiveRun): Promise<void> {
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
        if (session?.activeRequest?.requestId === run.requestId && this.isCurrent(session.id, run)) {
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

  private beginStopActiveRun(session: AgentSession | undefined, run: AgentSessionActiveRun): Promise<void> {
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
    run: AgentSessionActiveRun;
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
        ...projectAgentErrorMessage(error, "session.runFailed"),
      });
      throw error;
    }
  }

  private async observeCancellationComponent(
    input: { sessionId?: string; run: AgentSessionActiveRun; startedAt: number },
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
        ...projectAgentErrorMessage(error, "session.runFailed"),
      });
      throw error;
    }
  }

  private async emitCancellationProgress(
    input: { sessionId?: string; run: AgentSessionActiveRun },
    data: {
      stage: "started" | "component_completed" | "component_failed" | "completed" | "failed";
      component?: "agent_loop" | "pi_session";
      durationMs?: number;
      message?: string;
      localizedMessage?: AgentLocalizedMessage;
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
}

export class AgentSessionRunCoordinatorShuttingDownError extends Error {
  constructor() {
    super("Session run coordinator is shutting down.");
    this.name = "AgentSessionRunCoordinatorShuttingDownError";
  }
}

export function readAgentSessionRunErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return agentErrorMessage("session.runFailed");
}

export function createAgentSessionRunCancelledEvent(sessionId: string, requestId: string): AgentDomainEvent {
  return {
    eventId: createOpaqueId("event"),
    kind: AgentEventKinds.RunCancelled,
    context: { sessionId, requestId },
    data: { reason: "user_cancelled" },
  };
}

export function createAgentSessionRunFailedEvent(
  sessionId: string,
  requestId: string,
  error: unknown,
): AgentDomainEvent {
  return {
    eventId: createOpaqueId("event"),
    kind: AgentEventKinds.RunFailed,
    context: { sessionId, requestId },
    data: {
      ...projectAgentErrorMessage(error, "session.runFailed"),
      details: serializeError(error),
    },
  };
}

interface AgentRunCancellationComponent {
  readonly name: "agent_loop" | "pi_session";
  readonly settlement: Promise<void>;
  readonly startedAt: number;
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

const ActiveRunQueueHandlers = {
  [AgentSessionMessageQueueModes.Steer]: (session: AgentPiSession, input: string) => session.steer(input),
  [AgentSessionMessageQueueModes.FollowUp]: (session: AgentPiSession, input: string) => session.followUp(input),
} satisfies Record<AgentSessionMessageQueueMode, (session: AgentPiSession, input: string) => Promise<void>>;
