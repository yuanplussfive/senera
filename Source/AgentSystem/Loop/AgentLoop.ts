import type { AgentDomainEvent, AgentEventSink } from "../Events/AgentEvent.js";
import { emitAgentEvent } from "../Events/AgentEvent.js";
import type { AgentSystemRuntime } from "../Runtime/AgentSystemRuntime.js";
import type { AgentCompletedRunResult } from "../Runtime/AgentExecutionProjector.js";
import { createAssistantMessageId, createOpaqueId } from "../Core/AgentIds.js";
import { AgentModelUsageLedger, withAgentModelUsageLedger } from "../ModelEndpoints/AgentModelUsage.js";
import { withAgentModelDiagnosticScope } from "../Diagnostics/AgentModelDiagnosticScope.js";
import {
  createAgentTurnPreparationSnapshot,
  isAgentTurnPreparationReusable,
  type AgentTurnPreparationSnapshot,
} from "./AgentTurnPreparationSnapshot.js";
import { AgentTurnPreparationService, type AgentPreparedTurn } from "./AgentTurnPreparationService.js";
import { AgentTurnPromptRenderer } from "./AgentTurnPromptRenderer.js";
import { AgentPiTurnExecutor, type AgentPiTurnRuntimePort } from "../Pi/AgentPiTurnExecutor.js";
import { AgentLoopEventFactory } from "./AgentLoopEventFactory.js";
import type { AgentExecutionApprovalMode } from "../Safety/AgentExecutionApprovalMode.js";
import { resolveAgentModelToolPlanningMode } from "../ModelEndpoints/AgentModelToolPlanning.js";
import type { AgentPinnedSkillReference } from "../Skills/AgentSkillActivation.js";
import type { AgentExplicitActivationReference } from "../Activation/AgentActivationTypes.js";
import type { AgentSystemPromptLayer } from "../Orchestration/AgentRunDispatchPort.js";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { AgentUploadAttachment } from "../Uploads/AgentUploadTypes.js";
import {
  AgentInteractionSurfaces,
  normalizeAgentInteractionContext,
  type AgentInteractionContext,
} from "../Interaction/AgentInteractionContext.js";
import { createAgentPiLogicalCacheScope } from "../Pi/AgentPiPromptCache.js";
import {
  createModelProviderMetadata,
  type AgentConversationEntryMetadata,
  type AgentEffectiveModelReceipt,
} from "../ModelEndpoints/AgentModelMetadata.js";
import type { AgentToolResourceLeaseOwner } from "../ToolRuntime/AgentToolResourceScheduler.js";
import { errorMessage } from "../Core/AgentErrors.js";

export interface AgentLoopOptions {
  runtime: AgentSystemRuntime;
  preparationFingerprint?: string;
}

export interface AgentRunRequest {
  sessionId?: string;
  /** Stable cache affinity; defaults to the durable conversation session. */
  logicalCacheScope?: string;
  requestId: string;
  /** Durable user-message identity backing this execution request. */
  conversationRequestId?: string;
  /** Authoritative provider receipt resolved by the session admission layer. */
  effectiveModel?: AgentEffectiveModelReceipt;
  turnNumber?: number;
  step?: number;
  input: string;
  hostInput?: AgentConversationEntryMetadata["hostInput"];
  /** Resume the existing Pi transcript without creating a synthetic user turn. */
  continueFromTranscript?: boolean;
  /** Identifies the durable turn whose Pi transcript should be resumed. */
  continuationSourceRequestId?: string;
  attachments?: AgentUploadAttachment[];
  interaction?: AgentInteractionContext;
  approvalMode: AgentExecutionApprovalMode;
  loadedToolNames?: string[];
  systemPromptLayer?: AgentSystemPromptLayer;
  allowedToolNames?: readonly string[];
  pinnedSkills?: readonly AgentPinnedSkillReference[];
  explicitActivations?: readonly AgentExplicitActivationReference[];
  activationCatalogRevision?: string;
  thinkingLevel?: ModelThinkingLevel;
  inheritProjectContext?: boolean;
  /** Assignment owner propagated only for leased child-run sessions. */
  resourceOwner?: AgentToolResourceLeaseOwner;
  onEvent?: AgentEventSink;
  signal?: AbortSignal;
  emitRunStarted?: boolean;
  preparation?: AgentTurnPreparationSnapshot;
  onPreparation?: (snapshot: AgentTurnPreparationSnapshot) => void | Promise<void>;
  inputBoundary?: import("../Pi/AgentPiInputBoundary.js").AgentPiInputBoundaryHandler;
  onPiBranchBoundary?: (entryId: string) => void | Promise<void>;
  /** Owns terminal-event commit and publication when supplied. */
  commitTerminalEvents?: (events: AgentDomainEvent[]) => void | Promise<void>;
}

export class AgentLoop {
  private readonly preparation: AgentTurnPreparationService;
  private readonly promptRenderer: AgentTurnPromptRenderer;
  private readonly piTurn: AgentPiTurnExecutor;
  private readonly events = new AgentLoopEventFactory();

  constructor(private readonly options: AgentLoopOptions) {
    this.preparation = new AgentTurnPreparationService(options.runtime);
    this.promptRenderer = new AgentTurnPromptRenderer(options.runtime);
    this.piTurn = new AgentPiTurnExecutor({
      runtime: {
        services: options.runtime.services,
        modelProviderConfig: options.runtime.modelProviderConfig,
        agentLoopConfig: options.runtime.agentLoopConfig,
        tokenEstimator: options.runtime.tokenEstimator,
        piDiagnostics: options.runtime.piDiagnostics,
        uploadStore: options.runtime.uploadStore,
        imageNormalization: options.runtime.imageNormalization,
        logger: options.runtime.logger,
        promptConfig: () => options.runtime.promptConfig,
      } satisfies AgentPiTurnRuntimePort,
    });
  }

  get modelProvider() {
    return createModelProviderMetadata(this.options.runtime.modelProviderConfig);
  }

  async run(request: AgentRunRequest): Promise<AgentCompletedRunResult> {
    let completed: AgentCompletedRunResult | undefined;
    try {
      await this.options.runtime.initialize();
      await this.options.runtime.ensureExplicitActivationCapabilities(request.explicitActivations, request.signal);
      completed = await withAgentModelDiagnosticScope(
        {
          sink: this.options.runtime.piDiagnostics,
          context: {
            sessionId: request.sessionId,
            requestId: request.requestId,
            step: request.step,
            toolCallId: undefined,
            modelMessageIndex: undefined,
          },
        },
        () => withAgentModelUsageLedger(new AgentModelUsageLedger(), () => this.runTurn(request)),
      );
      return completed;
    } finally {
      if (!completed?.routingObservation) {
        try {
          this.options.runtime.services.retrieval.finishRequest(request.requestId);
        } catch (error) {
          this.options.runtime.logger?.warn("routing.request_cleanup_failed", {
            requestId: request.requestId,
            message: errorMessage(error),
          });
        }
      }
    }
  }

  finalizeCompletedTurn(result: AgentCompletedRunResult): void {
    const observation = result.routingObservation;
    if (!observation) return;
    try {
      this.options.runtime.services.retrieval.recordCompletedTurnScenario(observation);
    } catch (error) {
      // Routing evidence is a post-commit learning side effect. The model
      // response is already durable, so this must not reopen it as run.failed.
      this.options.runtime.logger?.warn("routing.scenario.finalize_failed", {
        requestId: observation.requestId,
        message: errorMessage(error),
      });
    } finally {
      try {
        this.options.runtime.services.retrieval.finishRequest(observation.requestId);
      } catch (error) {
        this.options.runtime.logger?.warn("routing.request_cleanup_failed", {
          requestId: observation.requestId,
          message: errorMessage(error),
        });
      }
    }
  }

  discardCompletedTurn(result?: AgentCompletedRunResult): void {
    const requestId = result?.routingObservation?.requestId;
    if (!requestId) return;
    try {
      this.options.runtime.services.retrieval.finishRequest(requestId);
    } catch (error) {
      this.options.runtime.logger?.warn("routing.request_cleanup_failed", {
        requestId,
        message: errorMessage(error),
      });
    }
  }

  private async runTurn(request: AgentRunRequest): Promise<AgentCompletedRunResult> {
    const step = request.step ?? 1;
    if (request.emitRunStarted !== false) {
      await this.emit(request.onEvent, this.events.runStarted(request.requestId, request.input, request.approvalMode));
    }

    const logicalCacheScope =
      request.logicalCacheScope ??
      (request.sessionId
        ? createAgentPiLogicalCacheScope({ sessionId: request.sessionId, family: "conversation" })
        : undefined);
    const prepared = await this.prepareTurn(request, logicalCacheScope);
    const prompt = await this.promptRenderer.render({
      userInput: request.input,
      stateCard: prepared.stateCard,
      sessionId: request.sessionId,
      requestId: request.requestId,
      logicalCacheScope,
      effectiveModel: request.effectiveModel,
      turnNumber: request.turnNumber,
      interaction: request.interaction,
      signal: request.signal,
      loadedToolNames: prepared.loadedToolNames,
      reusableCapabilities: prepared.reusableCapabilities,
      authorizedToolNames: prepared.toolAccessGrant.authorizedToolNames,
      rootCommand: prepared.rootCommand,
      toolPlanningMode: resolveAgentModelToolPlanningMode(this.options.runtime.modelProviderConfig),
      systemPromptLayer: request.systemPromptLayer,
    });
    await this.emitAll(request.onEvent, [
      ...this.events.promptRendered(request.requestId, step, prompt.text, prompt.tokenCount, prompt.continuityMemory),
      this.events.promptHarnessComposed(
        request.requestId,
        step,
        prompt.harness,
        resolveAgentModelToolPlanningMode(this.options.runtime.modelProviderConfig),
        prepared.activeSkills,
      ),
    ]);

    const assistantMessageId = createAssistantMessageId();
    let finalAnswerPublished = false;
    let finalAssistantMessageIndex: number | undefined;
    let finalAssistantContentIndex: number | undefined;
    const result = await this.piTurn.run(
      {
        sessionId: request.sessionId,
        logicalCacheScope,
        effectiveModel: request.effectiveModel,
        requestId: request.requestId,
        step,
        input: request.input,
        hostInput: request.hostInput,
        continueFromTranscript: request.continueFromTranscript,
        continuationSourceRequestId: request.continuationSourceRequestId,
        attachments: request.attachments,
        interaction: normalizeAgentInteractionContext(
          request.interaction ?? { surface: AgentInteractionSurfaces.Console },
        ),
        prompt: prompt.systemPrompt,
        turnContext: prompt.turnContext,
        refreshMemoryBoundary: prompt.refreshMemoryBoundary,
        onModelMemoryDelivered: prompt.onModelMemoryDelivered,
        rootCommand: prepared.rootCommand,
        approvalMode: request.approvalMode,
        toolAccessGrant: prepared.toolAccessGrant,
        loadedToolNames: prepared.loadedToolNames,
        nativeToolNames: prepared.nativeToolNames,
        activeSkills: prepared.activeSkills,
        stateCard: prepared.stateCard,
        reusableCapabilities: prepared.reusableCapabilities,
        personaActive: prompt.persona.enabled,
        onPiBranchBoundary: request.onPiBranchBoundary,
        inputBoundary: request.inputBoundary,
        onFinalResponseAvailable: async (content, modelMessageIndex, modelContentIndex) => {
          if (finalAnswerPublished) return;
          finalAnswerPublished = true;
          finalAssistantMessageIndex = modelMessageIndex;
          finalAssistantContentIndex = modelContentIndex;
          await this.emit(
            request.onEvent,
            this.events.finalAnswer(
              request.requestId,
              assistantMessageId,
              content,
              false,
              step,
              modelMessageIndex,
              modelContentIndex,
            ),
          );
        },
        thinkingLevel: request.thinkingLevel,
        inheritProjectContext: request.inheritProjectContext,
        resourceOwner: request.resourceOwner,
      },
      request.onEvent,
      request.signal,
    );

    const completed: AgentCompletedRunResult = {
      terminal: { kind: "FinalAnswer", content: result.responseText },
      decisionXml: result.responseText,
      modelProvider: result.modelProvider,
      usage: result.usage,
      executedTools: result.executedTools,
      ...(result.routingObservation && !request.hostInput ? { routingObservation: result.routingObservation } : {}),
      loadedToolNames: [...result.loadedToolNames],
      stepTraces: result.stepTraces,
      physicalPiSessionId: result.physicalPiSessionId,
      stateCard: prepared.stateCard,
    };
    const terminalEvents = this.events.terminal(
      {
        event: this.events.finalAnswer(
          request.requestId,
          assistantMessageId,
          result.responseText,
          true,
          step,
          finalAssistantMessageIndex,
          finalAssistantContentIndex,
        ),
        result: completed.terminal,
      },
      request.requestId,
      result.usage,
    );
    this.identifyAll(terminalEvents);
    if (request.commitTerminalEvents) {
      await request.commitTerminalEvents(terminalEvents);
    } else {
      await this.emitAll(request.onEvent, terminalEvents);
    }
    return completed;
  }

  private async prepareTurn(request: AgentRunRequest, logicalCacheScope?: string): Promise<AgentPreparedTurn> {
    if (request.explicitActivations !== undefined || request.activationCatalogRevision !== undefined) {
      if (!request.activationCatalogRevision) {
        throw new Error("Explicit activations require a catalog revision.");
      }
      this.options.runtime.validateExplicitActivations({
        catalogRevision: request.activationCatalogRevision,
        explicit: [...(request.explicitActivations ?? [])],
      });
    }
    const cached = isAgentTurnPreparationReusable(request.preparation, {
      runtimeFingerprint: this.options.preparationFingerprint,
      userInput: request.input,
      allowedToolNames: request.allowedToolNames,
      interactionSurface: request.interaction?.surface,
      explicitActivations: request.explicitActivations,
      activationCatalogRevision: request.activationCatalogRevision,
    })
      ? request.preparation
      : undefined;
    const initialLoadedToolNames =
      cached?.loadedToolNames ??
      (request.interaction
        ? await this.options.runtime.services.retrieval.resolveInitialLoadedTools(
            request.input,
            request.loadedToolNames,
            request.interaction,
          )
        : await this.options.runtime.services.retrieval.resolveInitialLoadedTools(
            request.input,
            request.loadedToolNames,
          ));
    const prepared: AgentPreparedTurn = cached
      ? await this.prepareCachedTurn(request, cached, logicalCacheScope)
      : await this.preparation.prepare({
          requestId: request.requestId,
          conversationRequestId: request.conversationRequestId,
          userInput: request.input,
          sessionId: request.sessionId,
          logicalCacheScope,
          loadedToolNames: initialLoadedToolNames,
          turnIndex: request.turnNumber,
          allowedToolNames: request.allowedToolNames,
          interaction: request.interaction,
          pinnedSkills: request.pinnedSkills,
          explicitActivations: request.explicitActivations,
          signal: request.signal,
        });

    if (request.onPreparation && this.options.preparationFingerprint) {
      const snapshot = cached
        ? structuredClone(cached)
        : createAgentTurnPreparationSnapshot({
            runtimeFingerprint: this.options.preparationFingerprint,
            userInput: request.input,
            allowedToolNames: request.allowedToolNames,
            interactionSurface: request.interaction?.surface,
            explicitActivations: request.explicitActivations,
            activationCatalogRevision: request.activationCatalogRevision,
            loadedToolNames: prepared.loadedToolNames,
            nativeToolNames: prepared.nativeToolNames,
            toolAccessGrant: prepared.toolAccessGrant,
            rootCommand: prepared.rootCommand,
            activeSkills: prepared.activeSkills,
          });
      await request.onPreparation(snapshot);
    }
    return prepared;
  }

  private async prepareCachedTurn(
    request: AgentRunRequest,
    cached: AgentTurnPreparationSnapshot,
    logicalCacheScope?: string,
  ): Promise<AgentPreparedTurn> {
    const stateCard = await this.options.runtime.services.retrieval.resolveStateCard({
      requestId: request.requestId,
      conversationRequestId: request.conversationRequestId,
      currentRequest: request.input,
      turnIndex: request.turnNumber,
      sessionId: request.sessionId,
      logicalCacheScope,
      activeSkills: cached.activeSkills,
      interaction: request.interaction,
      ...(request.signal ? { signal: request.signal } : {}),
    });
    const reusableCapabilities = request.sessionId
      ? (this.options.runtime.services.retrieval.reusableCapabilities?.({
          sessionId: request.sessionId,
          logicalCacheScope,
          query: stateCard.standaloneRequest,
          authorizedToolNames: request.allowedToolNames,
          ...(request.interaction ? { interaction: request.interaction } : {}),
        }) ?? [])
      : [];
    return {
      loadedToolNames: [...cached.loadedToolNames],
      nativeToolNames: [...cached.nativeToolNames],
      toolAccessGrant: cached.toolAccessGrant,
      rootCommand: cached.rootCommand,
      activeSkills: cached.activeSkills.map((skill) => structuredClone(skill)),
      explicitActivations: [...cached.explicitActivations],
      ...(cached.activationCatalogRevision ? { activationCatalogRevision: cached.activationCatalogRevision } : {}),
      stateCard,
      reusableCapabilities,
    };
  }

  private async emit(onEvent: AgentEventSink | undefined, event: AgentDomainEvent): Promise<void> {
    await emitAgentEvent(onEvent, event.eventId ? event : { ...event, eventId: createOpaqueId("event") });
  }

  private async emitAll(onEvent: AgentEventSink | undefined, events: AgentDomainEvent[]): Promise<void> {
    this.identifyAll(events);
    for (const event of events) await emitAgentEvent(onEvent, event);
  }

  private identifyAll(events: AgentDomainEvent[]): void {
    for (const [index, event] of events.entries()) {
      events[index] = event.eventId ? event : { ...event, eventId: createOpaqueId("event") };
    }
  }
}
