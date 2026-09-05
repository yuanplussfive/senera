import type { AgentEventSink, AgentDomainEvent } from "../Events/AgentEvent.js";
import { AgentEventKinds, emitAgentEvent, withEventContext } from "../Events/AgentEvent.js";
import { AgentCancellationError } from "../Core/AgentCancellation.js";
import { createOpaqueId, createRequestId } from "../Core/AgentIds.js";
import { serializeError } from "../Diagnostics/AgentErrorSerializer.js";
import { type AgentConversationProjector } from "../Conversation/AgentConversationProjector.js";
import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
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
import type { AgentPiSessionMutationPort } from "../Pi/AgentPiSessionMutationService.js";
import type { AgentConversationPolicy } from "../Conversation/AgentConversationPolicy.js";
import { createAgentSessionMessageCommand } from "./AgentSessionCommand.js";
import {
  AgentSessionActiveRunController,
  createAgentSessionRunCancelledEvent,
  createAgentSessionRunFailedEvent,
  readAgentSessionRunErrorMessage,
  type AgentSessionAvailability,
  type AgentSessionActiveRun,
} from "./AgentSessionActiveRunController.js";
import type { AgentExecutionApprovalMode } from "../Safety/AgentExecutionApprovalMode.js";
import type { AgentPinnedSkillReference } from "../Skills/AgentSkillActivation.js";
import type { AgentConversationEntryMetadata, AgentSessionOwnership } from "../ModelEndpoints/AgentModelMetadata.js";
import type { AgentUploadStore } from "../Uploads/AgentUploadStore.js";
import type { AgentInteractionContext } from "../Interaction/AgentInteractionContext.js";

export interface AgentSessionRunCoordinatorOptions {
  store: AgentSessionStore;
  conversationProjector: AgentConversationProjector;
  conversationPolicy: AgentConversationPolicy;
  memory: AgentMemoryService;
  logger?: AgentLogger;
  runResources?: readonly AgentSessionRunResource[];
  piSessions?: AgentPiActiveSessionRegistry;
  piDiagnostics?: AgentPiDiagnosticSink;
  uploadStore?: Pick<AgentUploadStore, "resolve">;
  piSessionMutations?: Pick<AgentPiSessionMutationPort, "reset">;
  runControl: AgentSessionRunControlPolicy;
  loopFactory: (modelProviderId?: string) => AgentLoopRunner;
  eventObserver?: AgentEventSink;
}

interface AgentSessionRunRequest {
  requestId?: string;
  modelProviderId?: string;
  input: string;
  approvalMode: AgentExecutionApprovalMode;
  attachments?: AgentUploadAttachment[];
  onEvent?: AgentEventSink;
  preparation?: AgentTurnPreparationSnapshot;
  systemPromptLayer?: import("../Orchestration/AgentRunDispatchPort.js").AgentSystemPromptLayer;
  allowedToolNames?: readonly string[];
  pinnedSkills?: readonly AgentPinnedSkillReference[];
  thinkingLevel?: import("@earendil-works/pi-ai").ModelThinkingLevel;
  inheritProjectContext?: boolean;
  sessionOwnership?: AgentSessionOwnership;
  metadata?: AgentConversationEntryMetadata;
  interaction?: AgentInteractionContext;
  /** Allows a durable internal wake to reclaim its own crashed run receipt. */
  reclaimRunningCommand?: boolean;
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

  async runTurn(session: AgentSession, request: AgentSessionRunRequest): Promise<void> {
    this.activeRuns.assertAcceptingRuns();
    const requestId = request.requestId?.trim() || createRequestId();
    const timestamp = new Date().toISOString();
    const channelScope = request.metadata?.channel?.platform
      ? { channel: request.metadata.channel.platform }
      : undefined;
    const userEntry = projectSessionUserEntry(this.options.conversationProjector, requestId, request, timestamp);
    const command = createAgentSessionMessageCommand({
      requestId,
      modelProviderId: request.modelProviderId,
      text: request.input,
      approvalMode: request.approvalMode,
      attachments: request.attachments,
      systemPromptLayer: request.systemPromptLayer,
      allowedToolNames: request.allowedToolNames,
      pinnedSkills: request.pinnedSkills,
      thinkingLevel: request.thinkingLevel,
      inheritProjectContext: request.inheritProjectContext,
      createdAt: timestamp,
    });
    const runningSession = cloneAgentSessionState(session);
    if (request.metadata?.channel) {
      runningSession.metadata = {
        ...runningSession.metadata,
        channel: request.metadata.channel,
      };
    }
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
        data: {
          input: request.input,
          approvalMode: request.approvalMode,
          ...(request.attachments?.length ? { attachments: request.attachments } : {}),
          ...(request.metadata?.backgroundTask ? { internal: true, displayInput: "后台任务完成通知" } : {}),
        },
      },
      { sessionId: session.id, scope: channelScope },
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
    const reclaimRunningCommand =
      admission.kind === "replayed" &&
      request.reclaimRunningCommand === true &&
      admission.command.state === "running" &&
      this.options.store.hasRequest(session.id, requestId);
    if (admission.kind === "replayed" && !reclaimRunningCommand) {
      await this.replayDurableRunEvents(session.id, requestId, request.onEvent);
      return;
    }

    // The command receipt and user entry were committed before the process
    // crashed. Reuse that entry instead of appending a duplicate turn while
    // reclaiming the internal completion wake.
    if (reclaimRunningCommand) runningSession.conversation = [...session.conversation];

    replaceAgentSessionState(session, runningSession);
    const run = this.activeRuns.register(session.id, requestId, request.onEvent);
    const terminalEvents: AgentDomainEvent[] = [];
    const onRunEvent: AgentEventSink = async (event) => {
      if (!this.activeRuns.isCurrent(session.id, run)) return;
      const contextualEvent = withEventContext(event, { sessionId: session.id, requestId, scope: channelScope });
      await this.observeEvent(contextualEvent);
      await emitAgentEvent(request.onEvent, contextualEvent);
    };
    let terminalSessionCommitted = false;
    let terminalCommitFailed = false;

    try {
      await emitAgentEvent(request.onEvent, runStartedEvent);
      const workingConversation = [...session.conversation];
      const turnTerminalEvents: AgentDomainEvent[] = [];
      const result = await this.runLoopTurn({
        session,
        run,
        request,
        requestId,
        input: request.input,
        step: 1,
        preparation: request.preparation,
        conversationEntries: workingConversation,
        terminalEvents: turnTerminalEvents,
        onEvent: onRunEvent,
      });
      let completedAt = timestamp;
      const allFreshEntries: AgentConversationEntry[] = [];
      const pendingEntries: AgentConversationEntry[] = [];
      const pendingStepTraces = [] as typeof result.stepTraces;
      const allExecutedTools = [] as typeof result.executedTools;
      const allContinuityRuleDeliveryUris: string[] = [];

      if (!this.activeRuns.isCurrent(session.id, run)) return;
      completedAt = new Date().toISOString();
      const assistantEntry = this.options.conversationProjector.projectAssistantDecision(
        requestId,
        result.decisionXml,
        completedAt,
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
      allFreshEntries.push(...freshEntries);
      const turnStepTraces = stampSessionStepTraces(result.stepTraces, timestamp, completedAt);
      pendingEntries.push(...freshEntries);
      pendingStepTraces.push(...turnStepTraces);
      allExecutedTools.push(...result.executedTools);
      allContinuityRuleDeliveryUris.push(...(result.continuityRuleDeliveryUris ?? []));
      terminalEvents.push(...turnTerminalEvents);

      run.terminalStatus = "completed";
      const completedSession = cloneAgentSessionState(session);
      completedSession.conversation = mergeSessionConversationEntries([
        ...completedSession.conversation,
        ...allFreshEntries,
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
      completedSession.updatedAt = completedAt;
      this.activeRuns.releaseSession(completedSession);
      try {
        this.options.store.persistTurnCommit(
          session.id,
          requestId,
          pendingEntries,
          pendingStepTraces,
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
      this.acknowledgeContinuityRuleDeliveries(allContinuityRuleDeliveryUris, completedAt);
      this.activeRuns.detachTerminalRun(session.id, run);
      await this.publishTerminalEvents(request.onEvent, terminalEvents);
      this.recordCompletedTurn({
        sessionId: session.id,
        requestId,
        startedAt: timestamp,
        completedAt: assistantEntry.timestamp,
        userEntry,
        assistantEntry,
        terminal: result.terminal,
        executedTools: allExecutedTools,
        modelProvider: result.modelProvider,
      });
    } catch (error) {
      if (!this.activeRuns.isCurrent(session.id, run)) {
        return;
      }

      if (error instanceof AgentCancellationError) {
        run.terminalStatus = "cancelled";
        const endedAt = new Date().toISOString();
        const cancelledEvent = withEventContext(createAgentSessionRunCancelledEvent(session.id, requestId), {
          scope: channelScope,
        });
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
        this.activeRuns.detachTerminalRun(session.id, run);
        if (!run.suppressCancellationEvent) {
          await this.publishTerminalEvents(request.onEvent, [cancelledEvent]);
        }
        return;
      }

      const endedAt = new Date().toISOString();
      run.terminalStatus = "failed";
      const failedEvent = withEventContext(createAgentSessionRunFailedEvent(session.id, requestId, error), {
        scope: channelScope,
      });
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
      this.activeRuns.detachTerminalRun(session.id, run);
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

  private runLoopTurn(input: {
    readonly session: AgentSession;
    readonly run: AgentSessionActiveRun;
    readonly request: AgentSessionRunRequest;
    readonly requestId: string;
    readonly input: string;
    readonly step: number;
    readonly preparation?: AgentTurnPreparationSnapshot;
    readonly loadedToolNames?: readonly string[];
    readonly conversationEntries: readonly AgentConversationEntry[];
    readonly terminalEvents: AgentDomainEvent[];
    readonly onEvent: AgentEventSink;
  }): Promise<Awaited<ReturnType<AgentLoopRunner["run"]>>> {
    const loop = this.options.loopFactory(input.request.modelProviderId);
    const loadedToolNames =
      input.loadedToolNames ??
      resolveAgentToolAvailabilitySnapshot(input.session.metadata, loop.preparationFingerprint);
    const resultPromise = loop.run({
      sessionId: input.session.id,
      requestId: input.requestId,
      step: input.step,
      input: input.input,
      attachments: input.request.attachments,
      approvalMode: input.request.approvalMode,
      conversationEntries: [...input.conversationEntries],
      loadedToolNames: loadedToolNames ? [...loadedToolNames] : undefined,
      systemPromptLayer: input.request.systemPromptLayer,
      allowedToolNames: input.request.allowedToolNames,
      pinnedSkills: input.request.pinnedSkills,
      thinkingLevel: input.request.thinkingLevel,
      inheritProjectContext: input.request.inheritProjectContext,
      interaction: input.request.interaction,
      signal: input.run.controller.signal,
      emitRunStarted: false,
      onEvent: input.onEvent,
      preparation: input.preparation,
      onPreparation: (snapshot) => {
        this.options.store.persistTurnPreparation(input.session.id, input.requestId, snapshot);
        if (loop.preparationFingerprint && snapshot.loadedToolNames.length > 0) {
          input.session.metadata = withAgentToolAvailabilitySnapshot(
            input.session.metadata,
            loop.preparationFingerprint,
            snapshot.loadedToolNames,
          );
          this.options.store.persistMetadata(input.session);
        }
      },
      onPiBranchBoundary: (entryId) => {
        this.options.store.persistTurnPreparationBoundary(input.session.id, input.requestId, entryId);
        input.session.metadata = withAgentPiSessionLifecycle(
          input.session.metadata,
          AgentPiSessionLifecycleStates.Initialized,
          input.request.modelProviderId,
        );
        this.options.store.persistMetadata(input.session);
      },
      commitTerminalEvents: (events) => {
        input.terminalEvents.push(
          ...events.map((event) =>
            withEventContext(event, {
              sessionId: input.session.id,
              requestId: input.run.requestId,
              scope: input.request.metadata?.channel?.platform
                ? { channel: input.request.metadata.channel.platform }
                : undefined,
            }),
          ),
        );
      },
    });
    return resultPromise.then((result) => {
      if (loop.preparationFingerprint && result.loadedToolNames && result.loadedToolNames.length > 0) {
        input.session.metadata = withAgentToolAvailabilitySnapshot(
          input.session.metadata,
          loop.preparationFingerprint,
          result.loadedToolNames,
        );
        this.options.store.persistMetadata(input.session);
      }
      return result;
    });
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

  private acknowledgeContinuityRuleDeliveries(ruleUris: readonly string[] | undefined, deliveredAt: string): void {
    if (!ruleUris || ruleUris.length === 0) return;
    try {
      this.options.memory.acknowledgeRuleDeliveries(ruleUris, deliveredAt);
    } catch (error) {
      this.options.logger?.warn("continuity.rule_delivery.acknowledgement_failed", {
        ruleCount: ruleUris.length,
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
        await this.observeEvent(event);
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

  private async observeEvent(event: AgentDomainEvent): Promise<void> {
    try {
      await emitAgentEvent(this.options.eventObserver, event);
    } catch (error) {
      this.options.logger?.warn("continuity.event_observer.failed", {
        kind: event.kind,
        error: serializeError(error),
      });
    }
  }

  async cancelActiveRun(request: {
    sessionId: string;
    requestId?: string;
    onEvent?: AgentEventSink;
  }): Promise<boolean> {
    return this.activeRuns.cancelActiveRun(request);
  }

  acceptActiveRunCancellation(request: { sessionId: string; requestId?: string; onEvent?: AgentEventSink }): boolean {
    return this.activeRuns.acceptActiveRunCancellation(request);
  }

  async enqueueActiveRunMessage(request: {
    session: AgentSession;
    requestId?: string;
    input: string;
    attachments?: AgentUploadAttachment[];
    metadata?: AgentConversationEntryMetadata;
    interaction?: AgentInteractionContext;
    queueMode: AgentSessionMessageQueueMode;
    onEvent?: AgentEventSink;
  }): Promise<boolean> {
    return this.activeRuns.enqueueActiveRunMessage(request);
  }

  requestActiveRunFinalAnswer(request: { sessionId: string; instruction: string }): Promise<boolean> {
    return this.activeRuns.requestActiveRunFinalAnswer(request);
  }

  steerActiveRun(request: {
    sessionId: string;
    input: string;
    interaction?: AgentInteractionContext;
    onEvent?: AgentEventSink;
  }): Promise<boolean> {
    return this.activeRuns.steerActiveRun(request);
  }

  followUpActiveRun(request: {
    sessionId: string;
    input: string;
    onEvent?: AgentEventSink;
    requestId?: string;
    interaction?: AgentInteractionContext;
  }): Promise<boolean> {
    return this.activeRuns.followUpActiveRun(request);
  }

  interruptActiveRun(request: { sessionId: string; instruction: string }): Promise<boolean> {
    return this.activeRuns.interruptActiveRun(request);
  }

  async discardActiveRun(session: AgentSession): Promise<boolean> {
    return this.activeRuns.discardActiveRun(session);
  }

  hasActiveRun(sessionId: string): boolean {
    return this.activeRuns.hasActiveRun(sessionId);
  }

  hasRunInFlight(sessionId: string): boolean {
    return this.activeRuns.hasRunInFlight(sessionId);
  }

  waitForIdle(sessionId: string): Promise<void> {
    return this.activeRuns.waitForIdle(sessionId);
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
