import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { AgentDomainEvent, AgentEventSink } from "../Events/AgentEvent.js";
import { emitAgentEvent } from "../Events/AgentEvent.js";
import type { AgentSystemRuntime } from "../Runtime/AgentSystemRuntime.js";
import type { AgentCompletedRunResult } from "../Runtime/AgentExecutionProjector.js";
import { createAssistantMessageId, createOpaqueId } from "../Core/AgentIds.js";
import { AgentModelUsageLedger, withAgentModelUsageLedger } from "../ModelEndpoints/AgentModelUsage.js";
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
import type { AgentSystemPromptLayer } from "../Orchestration/AgentRunDispatchPort.js";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { AgentUploadAttachment } from "../Uploads/AgentUploadTypes.js";
import {
  normalizeAgentInteractionContext,
  type AgentInteractionContext,
} from "../Interaction/AgentInteractionContext.js";

export interface AgentLoopOptions {
  runtime: AgentSystemRuntime;
  preparationFingerprint?: string;
}

export interface AgentRunRequest {
  sessionId?: string;
  requestId: string;
  step?: number;
  input: string;
  attachments?: AgentUploadAttachment[];
  interaction?: AgentInteractionContext;
  approvalMode: AgentExecutionApprovalMode;
  conversationEntries?: AgentConversationEntry[];
  loadedToolNames?: string[];
  systemPromptLayer?: AgentSystemPromptLayer;
  allowedToolNames?: readonly string[];
  pinnedSkills?: readonly AgentPinnedSkillReference[];
  thinkingLevel?: ModelThinkingLevel;
  inheritProjectContext?: boolean;
  onEvent?: AgentEventSink;
  signal?: AbortSignal;
  emitRunStarted?: boolean;
  preparation?: AgentTurnPreparationSnapshot;
  onPreparation?: (snapshot: AgentTurnPreparationSnapshot) => void | Promise<void>;
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
        promptConfig: () => options.runtime.promptConfig,
      } satisfies AgentPiTurnRuntimePort,
    });
  }

  async run(request: AgentRunRequest): Promise<AgentCompletedRunResult> {
    try {
      await this.options.runtime.initialize();
      return await withAgentModelUsageLedger(new AgentModelUsageLedger(), () => this.runTurn(request));
    } finally {
      this.options.runtime.services.retrieval.finishRequest(request.requestId);
    }
  }

  private async runTurn(request: AgentRunRequest): Promise<AgentCompletedRunResult> {
    const step = request.step ?? 1;
    if (request.emitRunStarted !== false) {
      await this.emit(request.onEvent, this.events.runStarted(request.requestId, request.input, request.approvalMode));
    }

    const prepared = await this.prepareTurn(request);
    const prompt = await this.promptRenderer.render({
      userInput: request.input,
      sessionId: request.sessionId,
      requestId: request.requestId,
      loadedToolNames: prepared.loadedToolNames,
      rootCommand: prepared.rootCommand,
      toolPlanningMode: resolveAgentModelToolPlanningMode(this.options.runtime.modelProviderConfig),
      systemPromptLayer: request.systemPromptLayer,
    });
    await this.emitAll(request.onEvent, [
      ...this.events.promptRendered(
        request.requestId,
        step,
        prompt.text,
        prompt.tokenCount,
        prompt.roleplayPreset,
        prompt.continuityMemory,
      ),
      this.events.promptHarnessComposed(
        request.requestId,
        step,
        prompt.harness,
        resolveAgentModelToolPlanningMode(this.options.runtime.modelProviderConfig),
      ),
    ]);

    const assistantMessageId = createAssistantMessageId();
    let finalAnswerPublished = false;
    const result = await this.piTurn.run(
      {
        sessionId: request.sessionId,
        requestId: request.requestId,
        step,
        input: request.input,
        attachments: request.attachments,
        interaction: normalizeAgentInteractionContext(request.interaction ?? { surface: "console" }),
        prompt: prompt.systemPrompt,
        turnContext: prompt.turnContext,
        conversationEntries: [...(request.conversationEntries ?? [])],
        rootCommand: prepared.rootCommand,
        approvalMode: request.approvalMode,
        toolAccessGrant: prepared.toolAccessGrant,
        loadedToolNames: prepared.loadedToolNames,
        activeSkills: prepared.activeSkills,
        roleplayPresetActive: prompt.roleplayPreset.card !== undefined,
        prefaceRewriteEnabled: this.options.runtime.promptConfig.PrefaceRewrite === true,
        onPiBranchBoundary: request.onPiBranchBoundary,
        onFinalResponseAvailable: async (content) => {
          if (finalAnswerPublished) return;
          finalAnswerPublished = true;
          await this.emit(
            request.onEvent,
            this.events.finalAnswer(request.requestId, assistantMessageId, content, false),
          );
        },
        thinkingLevel: request.thinkingLevel,
        inheritProjectContext: request.inheritProjectContext,
      },
      request.onEvent,
      request.signal,
    );

    const completed: AgentCompletedRunResult = {
      terminal: { kind: "FinalAnswer", content: result.responseText },
      decisionXml: result.responseText,
      modelProvider: result.modelProvider,
      usage: result.usage,
      conversationEntries: result.conversationEntries,
      executedTools: result.executedTools,
      loadedToolNames: [...result.loadedToolNames],
      stepTraces: result.stepTraces,
      continuityRuleDeliveryUris: [...prompt.continuityMemory.pendingRuleDeliveryUris],
    };
    const terminalEvents = this.events.terminal(
      {
        event: this.events.finalAnswer(request.requestId, assistantMessageId, result.responseText, true),
        result: completed.terminal,
      },
      request.requestId,
    );
    this.identifyAll(terminalEvents);
    if (request.commitTerminalEvents) {
      await request.commitTerminalEvents(terminalEvents);
    } else {
      await this.emitAll(request.onEvent, terminalEvents);
    }
    return completed;
  }

  private async prepareTurn(request: AgentRunRequest): Promise<AgentPreparedTurn> {
    const cached = isAgentTurnPreparationReusable(request.preparation, {
      runtimeFingerprint: this.options.preparationFingerprint,
      userInput: request.input,
      allowedToolNames: request.allowedToolNames,
    })
      ? request.preparation
      : undefined;
    const initialLoadedToolNames =
      cached?.loadedToolNames ??
      (await this.options.runtime.services.retrieval.resolveInitialLoadedTools(request.input, request.loadedToolNames));
    const prepared: AgentPreparedTurn = cached
      ? {
          loadedToolNames: [...cached.loadedToolNames],
          toolAccessGrant: cached.toolAccessGrant,
          rootCommand: cached.rootCommand,
          activeSkills: cached.activeSkills.map((skill) => structuredClone(skill)),
        }
      : await this.preparation.prepare({
          requestId: request.requestId,
          userInput: request.input,
          loadedToolNames: initialLoadedToolNames,
          allowedToolNames: request.allowedToolNames,
          pinnedSkills: request.pinnedSkills,
          signal: request.signal,
        });

    if (request.onPreparation && this.options.preparationFingerprint) {
      const snapshot = cached
        ? structuredClone(cached)
        : createAgentTurnPreparationSnapshot({
            runtimeFingerprint: this.options.preparationFingerprint,
            userInput: request.input,
            allowedToolNames: request.allowedToolNames,
            loadedToolNames: prepared.loadedToolNames,
            toolAccessGrant: prepared.toolAccessGrant,
            rootCommand: prepared.rootCommand,
            activeSkills: prepared.activeSkills,
          });
      await request.onPreparation(snapshot);
    }
    return prepared;
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
