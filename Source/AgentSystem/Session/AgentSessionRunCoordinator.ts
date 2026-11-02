import type { AgentSessionInputSource } from "./AgentSessionQueuedInput.js";
import type { AgentEventSink, AgentDomainEvent } from "../Events/AgentEvent.js";
import { AgentEventKinds, emitAgentEvent, withEventContext } from "../Events/AgentEvent.js";
import { AgentCancellationError } from "../Core/AgentCancellation.js";
import { createOpaqueId, createRequestId } from "../Core/AgentIds.js";
import { serializeError } from "../Diagnostics/AgentErrorSerializer.js";
import { type AgentConversationProjector } from "../Conversation/AgentConversationProjector.js";
import {
  AgentConversationEntryKinds,
  isAgentHumanUserMessage,
  type AgentConversationEntry,
} from "../Conversation/AgentConversation.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { AgentLoopRunner } from "../Loop/AgentLoopRunner.js";
import { type AgentMemoryService } from "../Memory/AgentMemoryService.js";
import type { AgentMemoryCompletedTurnInput } from "../Memory/AgentMemorySourceRepository.js";
import type { AgentPiActiveSessionRegistry } from "../Pi/AgentPiActiveSessionRegistry.js";
import type { AgentPiDiagnosticSink } from "../Pi/AgentPiDiagnostics.js";
import type { AgentUploadAttachment } from "../Uploads/AgentUploadTypes.js";
import type { AgentSession } from "./AgentSession.js";
import { deriveAgentSessionTitle } from "./AgentSessionTitleProjector.js";
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
import type { AgentSessionRunRecovery } from "./AgentSessionRunRecovery.js";
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
import {
  resolveAgentSessionModelProviderId,
  type AgentConversationEntryMetadata,
  type AgentEffectiveModelReceipt,
  type AgentModelSelectionSource,
  type AgentSessionOwnership,
} from "../ModelEndpoints/AgentModelMetadata.js";
import type { AgentTurnAttachmentUploadStore } from "../Prompt/AgentTurnRequestComposer.js";
import type { AgentImageNormalizationService } from "../Images/AgentImageNormalizationService.js";
import type { AgentInteractionContext } from "../Interaction/AgentInteractionContext.js";
import { createAgentPiLogicalCacheScope } from "../Pi/AgentPiPromptCache.js";
import type { AgentToolResourceLeaseOwner } from "../ToolRuntime/AgentToolResourceScheduler.js";
import type { AgentExplicitActivationSet } from "../Activation/AgentActivationTypes.js";

export interface AgentSessionRunCoordinatorOptions {
  onTurnStart?: import("./AgentSessionManagerOptions.js").AgentSessionManagerOptions["onTurnStart"];
  onQueuedInputAccepted?: import("./AgentSessionInputDelivery.js").AgentSessionInputDeliveryOptions["onQueuedInputAccepted"];
  store: AgentSessionStore;
  conversationProjector: AgentConversationProjector;
  conversationPolicy: AgentConversationPolicy;
  memory: Pick<AgentMemoryService, "recordCompletedTurn">;
  logger?: AgentLogger;
  runResources?: readonly AgentSessionRunResource[];
  piSessions?: AgentPiActiveSessionRegistry;
  piDiagnostics?: AgentPiDiagnosticSink;
  uploadStore?: AgentTurnAttachmentUploadStore;
  imageNormalization?: Pick<AgentImageNormalizationService, "normalize">;
  piSessionMutations?: Pick<AgentPiSessionMutationPort, "reset">;
  runControl: AgentSessionRunControlPolicy;
  loopFactory: (modelProviderId?: string, session?: AgentSession) => AgentLoopRunner;
  /** Projects a live session snapshot for UI/channel observers. */
  snapshotEvent?: (session: AgentSession) => AgentDomainEvent;
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
  executionScope?: "session" | "turn";
  pinnedSkills?: readonly AgentPinnedSkillReference[];
  activations?: AgentExplicitActivationSet;
  thinkingLevel?: import("@earendil-works/pi-ai").ModelThinkingLevel;
  inheritProjectContext?: boolean;
  sessionOwnership?: AgentSessionOwnership;
  metadata?: AgentConversationEntryMetadata;
  modelSelectionSource?: AgentModelSelectionSource;
  interaction?: AgentInteractionContext;
  /** Replays a failed turn without appending a duplicate user entry. */
  reuseUserEntryFromRequestId?: string;
  /** Requests Pi to continue its existing transcript rather than prompt text. */
  continueFromTranscript?: boolean;
  /** Identifies the durable turn whose Pi transcript should be resumed. */
  continuationSourceRequestId?: string;
  recovery?: AgentSessionRunRecovery;
}

export type { AgentSessionAvailability } from "./AgentSessionActiveRunController.js";
export { AgentSessionRunCoordinatorShuttingDownError } from "./AgentSessionActiveRunController.js";

export class AgentSessionRunCoordinator {
  private readonly inputSources = new Set<AgentSessionInputSource>();
  private readonly activeRuns: AgentSessionActiveRunController;

  constructor(private readonly options: AgentSessionRunCoordinatorOptions) {
    this.activeRuns = new AgentSessionActiveRunController(options);
  }

  assertAvailable(session: AgentSession): AgentSessionAvailability {
    return this.activeRuns.assertAvailable(session);
  }

  async runTurn(session: AgentSession, request: AgentSessionRunRequest): Promise<void> {
    await this.startTurn(session, request);
  }

  /** Commits admission synchronously; model execution continues in the returned promise. */
  startTurn(session: AgentSession, request: AgentSessionRunRequest): Promise<void> {
    this.activeRuns.assertAcceptingRuns();
    const requestId = request.requestId?.trim() || createRequestId();
    const timestamp = new Date().toISOString();
    const conversationSpaceId =
      request.interaction?.spaceId ?? request.metadata?.channel?.spaceId ?? session.metadata?.channel?.spaceId;
    const logicalCacheScope = createAgentPiLogicalCacheScope({
      ...(conversationSpaceId ? { identity: conversationSpaceId } : { sessionId: session.id }),
      family: "conversation",
    });
    const channelScope = request.metadata?.channel?.platform
      ? { channel: request.metadata.channel.platform }
      : undefined;
    const reusedUserEntry = request.reuseUserEntryFromRequestId
      ? session.conversation.find(
          (entry): entry is Extract<AgentConversationEntry, { kind: "user.message" }> =>
            entry.kind === AgentConversationEntryKinds.UserMessage &&
            entry.requestId === request.reuseUserEntryFromRequestId,
        )
      : undefined;
    if (request.reuseUserEntryFromRequestId && !reusedUserEntry) {
      throw new Error(`User entry ${request.reuseUserEntryFromRequestId} is unavailable for recovery.`);
    }
    const userEntry =
      reusedUserEntry ?? projectSessionUserEntry(this.options.conversationProjector, requestId, request, timestamp);
    const persistUserEntry = !reusedUserEntry;
    const command = createAgentSessionMessageCommand({
      requestId,
      modelProviderId: request.modelProviderId,
      text: request.input,
      approvalMode: request.approvalMode,
      attachments: request.attachments,
      systemPromptLayer: request.systemPromptLayer,
      allowedToolNames: request.allowedToolNames,
      pinnedSkills: request.pinnedSkills,
      activations: request.activations,
      thinkingLevel: request.thinkingLevel,
      inheritProjectContext: request.inheritProjectContext,
      createdAt: timestamp,
    });
    const runningSession = cloneAgentSessionState(session);
    if (request.executionScope !== "turn")
      runningSession.metadata = {
        ...runningSession.metadata,
        executionPolicy: {
          approvalMode: request.approvalMode,
          allowedToolNames: request.allowedToolNames,
          systemPromptLayer: request.systemPromptLayer,
          pinnedSkills: request.pinnedSkills,
          thinkingLevel: request.thinkingLevel,
          inheritProjectContext: request.inheritProjectContext,
          ...(request.interaction ? { interaction: { ...request.interaction, event: undefined } } : {}),
        },
      };
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
    runningSession.conversation = persistUserEntry
      ? mergeSessionConversationEntries([...runningSession.conversation, userEntry])
      : mergeSessionConversationEntries(runningSession.conversation);
    const runStartedEvent = withEventContext(
      {
        eventId: createOpaqueId("event"),
        kind: AgentEventKinds.RunStarted,
        context: { requestId },
        data: {
          input: request.input,
          title: deriveAgentSessionTitle(runningSession),
          approvalMode: request.approvalMode,
          ...(request.attachments?.length ? { attachments: request.attachments } : {}),
          ...(userEntry.metadata ? { metadata: userEntry.metadata } : {}),
          ...(request.recovery ? { recovery: request.recovery } : {}),
        },
      },
      { sessionId: session.id, scope: channelScope },
    );
    const admission = this.options.store.persistRunStart(
      runningSession,
      requestId,
      persistUserEntry ? userEntry : undefined,
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
      return this.replayDurableRunEvents(session.id, requestId, request.onEvent);
    }

    replaceAgentSessionState(session, runningSession);
    const {
      reuseUserEntryFromRequestId: _reuse,
      continueFromTranscript: _continue,
      continuationSourceRequestId: _source,
      recovery: _recovery,
      ...messageRequest
    } = request;
    const run = this.activeRuns.register(session.id, requestId, request.onEvent, {
      ...messageRequest,
      sessionId: session.id,
    });
    const terminalEvents: AgentDomainEvent[] = [];
    const onRunEvent: AgentEventSink = async (event) => {
      if (!this.activeRuns.isCurrent(session.id, run)) return;
      const contextualEvent = withEventContext(event, { sessionId: session.id, requestId, scope: channelScope });
      await emitAgentEvent(request.onEvent, contextualEvent);
    };
    let terminalSessionCommitted = false;
    let terminalCommitFailed = false;
    let loop: AgentLoopRunner | undefined;
    let completedResult: Awaited<ReturnType<AgentLoopRunner["run"]>> | undefined;
    let learningFinalized = false;

    return (async () => {
      try {
        await emitAgentEvent(request.onEvent, runStartedEvent);
        if (
          isAgentHumanUserMessage(userEntry) &&
          !request.continueFromTranscript &&
          !request.reuseUserEntryFromRequestId
        )
          await this.options.onTurnStart?.({ sessionId: session.id, requestId, onEvent: onRunEvent });
        const turnTerminalEvents: AgentDomainEvent[] = [];
        loop = this.options.loopFactory(request.modelProviderId, session);
        const effectiveModel = loop.modelProvider
          ? {
              sessionId: session.id,
              requestId,
              providerId: loop.modelProvider.id,
              model: loop.modelProvider.model,
              endpoint: loop.modelProvider.endpoint,
              baseUrl: loop.modelProvider.baseUrl,
              source: request.modelSelectionSource ?? (request.modelProviderId ? "request" : "default"),
              effectiveAt: timestamp,
              logicalCacheScope,
            }
          : undefined;
        if (effectiveModel && session.activeRequest?.requestId === requestId) {
          session.activeRequest = { ...session.activeRequest, effectiveModel };
          session.metadata = {
            ...session.metadata,
            activeRun: {
              modelProvider: loop.modelProvider!,
              receipt: effectiveModel,
            },
          };
          this.options.store.persistMetadata(session);
          const snapshot = this.options.snapshotEvent?.(session);
          if (snapshot)
            await this.publishSessionSnapshot(request.onEvent, snapshot, session.id, requestId, channelScope);
        }
        const result = await this.runLoopTurn({
          session,
          run,
          loop,
          logicalCacheScope,
          effectiveModel,
          request,
          requestId,
          input: request.input,
          step: 1,
          preparation: request.preparation,
          terminalEvents: turnTerminalEvents,
          onEvent: onRunEvent,
        });
        completedResult = result;
        const allFreshEntries: AgentConversationEntry[] = [];
        const pendingEntries: AgentConversationEntry[] = [];
        const pendingStepTraces = [] as typeof result.stepTraces;
        const allExecutedTools = [] as typeof result.executedTools;

        if (!this.activeRuns.isCurrent(session.id, run)) {
          loop.discardCompletedTurn?.(completedResult);
          return;
        }
        const completedAt = new Date().toISOString();
        const assistantMetadata: AgentConversationEntryMetadata | undefined = buildAssistantEntryMetadata(
          request,
          result,
          effectiveModel,
        );
        const assistantEntry = this.options.conversationProjector.projectAssistantDecision(
          requestId,
          result.decisionXml,
          completedAt,
          assistantMetadata,
        );
        const freshEntries = collectFreshConversationEntries(session.conversation, [assistantEntry]);
        allFreshEntries.push(...freshEntries);
        const turnStepTraces = stampSessionStepTraces(result.stepTraces, timestamp, completedAt);
        pendingEntries.push(...freshEntries);
        pendingStepTraces.push(...turnStepTraces);
        allExecutedTools.push(...result.executedTools);
        terminalEvents.push(...turnTerminalEvents);

        run.terminalStatus = "completed";
        const completedSession = cloneAgentSessionState(session);
        completedSession.conversation = mergeSessionConversationEntries([
          ...completedSession.conversation,
          ...allFreshEntries,
        ]);
        if (result.modelProvider) {
          const completedReceipt = effectiveModel
            ? {
                ...effectiveModel,
                ...(result.physicalPiSessionId ? { physicalPiSessionId: result.physicalPiSessionId } : {}),
              }
            : undefined;
          completedSession.metadata = {
            ...completedSession.metadata,
            activeRun: undefined,
            lastRun: {
              modelProvider: result.modelProvider,
              usage: result.usage,
              ...(completedReceipt ? { receipt: completedReceipt } : {}),
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
        try {
          loop.finalizeCompletedTurn?.(completedResult);
        } catch (error) {
          // Scenario learning is a post-commit side effect. A custom loop must
          // not be able to reopen an already durable assistant response as a
          // foreground run failure.
          this.options.logger?.warn("routing.scenario.finalize_failed", {
            sessionId: session.id,
            requestId,
            error: serializeError(error),
          });
        }
        learningFinalized = true;
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
          stateCard: completedResult.stateCard,
          interaction: request.interaction,
        });
      } catch (error) {
        if (!learningFinalized) {
          try {
            loop?.discardCompletedTurn?.(completedResult);
          } catch (cleanupError) {
            this.options.logger?.warn("routing.request_cleanup_failed", {
              sessionId: session.id,
              requestId,
              error: serializeError(cleanupError),
            });
          }
        }
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
          cancelledSession.metadata = { ...cancelledSession.metadata, activeRun: undefined };
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
        failedSession.metadata = { ...failedSession.metadata, activeRun: undefined };
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
        try {
          await this.activeRuns.settleQueuedInputs(session.id, run, terminalSessionCommitted && !terminalCommitFailed);
        } catch (error) {
          this.options.logger?.error("session.queued_input.settlement_failed", {
            sessionId: session.id,
            requestId,
            error,
          });
        }
        try {
          await this.activeRuns.finalize({
            session,
            requestId,
            run,
            terminalSessionCommitted,
            terminalCommitFailed,
          });
        } catch (error) {
          // Resource cleanup is detached from the authoritative terminal
          // commit. Keep the persisted run terminal when lifecycle cleanup is
          // unavailable instead of emitting a second failure outcome.
          this.options.logger?.error("session.run_finalization_failed", {
            sessionId: session.id,
            requestId,
            terminalSessionCommitted,
            terminalCommitFailed,
            error: serializeError(error),
          });
        }
      }
    })();
  }

  private runLoopTurn(input: {
    readonly session: AgentSession;
    readonly run: AgentSessionActiveRun;
    readonly loop: AgentLoopRunner;
    readonly logicalCacheScope: string;
    readonly effectiveModel?: AgentEffectiveModelReceipt;
    readonly request: AgentSessionRunRequest;
    readonly requestId: string;
    readonly input: string;
    readonly step: number;
    readonly preparation?: AgentTurnPreparationSnapshot;
    readonly loadedToolNames?: readonly string[];
    readonly terminalEvents: AgentDomainEvent[];
    readonly onEvent: AgentEventSink;
  }): Promise<Awaited<ReturnType<AgentLoopRunner["run"]>>> {
    const loadedToolNames =
      input.loadedToolNames ??
      resolveAgentToolAvailabilitySnapshot(input.session.metadata, input.loop.preparationFingerprint);
    const resourceOwner: AgentToolResourceLeaseOwner | undefined =
      input.session.metadata?.ownership?.type === "child_run" ? { type: "session", id: input.session.id } : undefined;
    const resultPromise = input.loop.run({
      sessionId: input.session.id,
      logicalCacheScope: input.logicalCacheScope,
      requestId: input.requestId,
      conversationRequestId: input.request.reuseUserEntryFromRequestId ?? input.requestId,
      effectiveModel: input.effectiveModel,
      turnNumber: input.session.conversation.filter(isAgentHumanUserMessage).length,
      step: input.step,
      input: input.input,
      hostInput: input.request.metadata?.hostInput,
      continueFromTranscript:
        input.request.continueFromTranscript === true || input.request.recovery?.mode === "continue",
      continuationSourceRequestId: input.request.continuationSourceRequestId,
      attachments: input.request.attachments,
      approvalMode: input.request.approvalMode,
      loadedToolNames: loadedToolNames ? [...loadedToolNames] : undefined,
      systemPromptLayer: input.request.systemPromptLayer,
      allowedToolNames: input.request.allowedToolNames,
      pinnedSkills: input.request.pinnedSkills,
      explicitActivations: input.request.activations?.explicit,
      activationCatalogRevision: input.request.activations?.catalogRevision,
      thinkingLevel: input.request.thinkingLevel,
      inheritProjectContext: input.request.inheritProjectContext,
      resourceOwner,
      interaction: input.request.interaction,
      signal: input.run.controller.signal,
      emitRunStarted: false,
      onEvent: input.onEvent,
      preparation: input.preparation,
      onPreparation: (snapshot) => {
        this.options.store.persistTurnPreparation(input.session.id, input.requestId, snapshot);
        if (input.loop.preparationFingerprint && snapshot.loadedToolNames.length > 0) {
          input.session.metadata = withAgentToolAvailabilitySnapshot(
            input.session.metadata,
            input.loop.preparationFingerprint,
            snapshot.loadedToolNames,
          );
          this.options.store.persistMetadata(input.session);
        }
      },
      inputBoundary: async (boundary) => {
        const current = {
          ...boundary,
          sessionId: input.session.id,
          requestId: input.requestId,
          interaction: input.request.interaction,
          humanInput: !input.request.metadata?.hostInput,
          hostInput: input.request.metadata?.hostInput,
        };
        for (const source of this.inputSources) await source.observed?.(current);
        if (!input.run.controller.signal.aborted) {
          for (const source of this.inputSources) await source.beforeInput(current);
        }
        await this.activeRuns.inputBoundary(current, async (message) => {
          for (const source of this.inputSources) await source.delivered?.(message);
        });
      },
      onPiBranchBoundary: (entryId) => {
        this.options.store.persistTurnPreparationBoundary(input.session.id, input.requestId, entryId);
        const lifecycleModelProviderId =
          input.effectiveModel?.providerId ??
          input.request.modelProviderId ??
          resolveAgentSessionModelProviderId(input.session.metadata);
        input.session.metadata = withAgentPiSessionLifecycle(
          input.session.metadata,
          AgentPiSessionLifecycleStates.Initialized,
          lifecycleModelProviderId,
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
      if (input.loop.preparationFingerprint && result.loadedToolNames && result.loadedToolNames.length > 0) {
        input.session.metadata = withAgentToolAvailabilitySnapshot(
          input.session.metadata,
          input.loop.preparationFingerprint,
          result.loadedToolNames,
        );
        this.options.store.persistMetadata(input.session);
      }
      return result;
    });
  }

  private recordCompletedTurn(input: AgentMemoryCompletedTurnInput): void {
    if (!isAgentHumanUserMessage(input.userEntry)) return;
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

  private async publishSessionSnapshot(
    onEvent: AgentEventSink | undefined,
    event: AgentDomainEvent,
    sessionId: string,
    requestId: string,
    scope: Record<string, string> | undefined,
  ): Promise<void> {
    const contextual = withEventContext(event, { sessionId, requestId, scope });
    await emitAgentEvent(onEvent, contextual);
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

  registerInputSource(source: AgentSessionInputSource): () => void {
    this.inputSources.add(source);
    return () => {
      this.inputSources.delete(source);
    };
  }

  async enqueueActiveRunMessage(request: {
    session: AgentSession;
    requestId?: string;
    input: string;
    attachments?: AgentUploadAttachment[];
    metadata?: AgentConversationEntryMetadata;
    interaction?: AgentInteractionContext;
    activations?: AgentExplicitActivationSet;
    queueMode: AgentSessionMessageQueueMode;
    onEvent?: AgentEventSink;
  }): Promise<boolean> {
    return this.activeRuns.enqueueActiveRunMessage(request);
  }

  deferMessage(request: import("./AgentSessionMessageCoordinator.js").AgentSessionMessageRequest): Promise<void> {
    return this.activeRuns.deferMessage(request);
  }

  requestActiveRunFinalAnswer(request: { sessionId: string; instruction: string }): Promise<boolean> {
    return this.activeRuns.requestActiveRunFinalAnswer(request);
  }

  steerActiveRun(request: {
    sessionId: string;
    requestId?: string;
    queueMode?: AgentSessionMessageQueueMode;
    input: string;
    metadata?: AgentConversationEntryMetadata;
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
    metadata?: AgentConversationEntryMetadata;
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

function buildAssistantEntryMetadata(
  request: AgentSessionRunRequest,
  result: Awaited<ReturnType<AgentLoopRunner["run"]>>,
  effectiveModel: AgentEffectiveModelReceipt | undefined,
): AgentConversationEntryMetadata | undefined {
  const metadata: AgentConversationEntryMetadata = {};
  if (request.reuseUserEntryFromRequestId) {
    metadata.sourceRequestId = request.reuseUserEntryFromRequestId;
  }
  if (result.modelProvider) {
    metadata.run = {
      modelProvider: result.modelProvider,
      usage: result.usage,
      ...(effectiveModel
        ? {
            receipt: {
              ...effectiveModel,
              ...(result.physicalPiSessionId ? { physicalPiSessionId: result.physicalPiSessionId } : {}),
            },
          }
        : {}),
    };
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}
