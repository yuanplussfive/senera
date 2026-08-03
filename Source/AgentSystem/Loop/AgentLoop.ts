import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { AgentDomainEvent, AgentEventSink } from "../Events/AgentEvent.js";
import { AgentEventKinds, emitAgentEvent } from "../Events/AgentEvent.js";
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
import { AgentPiTurnExecutor } from "../Pi/AgentPiTurnExecutor.js";
import { AgentLoopEventFactory } from "./AgentLoopEventFactory.js";

export interface AgentLoopOptions {
  runtime: AgentSystemRuntime;
  preparationFingerprint?: string;
}

export interface AgentRunRequest {
  sessionId?: string;
  requestId: string;
  input: string;
  conversationEntries?: AgentConversationEntry[];
  loadedToolNames?: string[];
  systemPromptPreamble?: string;
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
    this.piTurn = new AgentPiTurnExecutor({ runtime: options.runtime });
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
    if (request.emitRunStarted !== false) {
      await this.emit(request.onEvent, this.events.runStarted(request.requestId, request.input));
    }

    const prepared = await this.prepareTurn(request);
    const prompt = await this.promptRenderer.render({
      loadedToolNames: prepared.loadedToolNames,
      rootCommand: prepared.rootCommand,
      systemPromptPreamble: request.systemPromptPreamble,
    });
    await this.emitAll(
      request.onEvent,
      this.events.promptRendered(request.requestId, 1, prompt.text, prompt.tokenCount),
    );

    const result = await this.piTurn.run(
      {
        sessionId: request.sessionId,
        requestId: request.requestId,
        step: 1,
        input: request.input,
        prompt: prompt.text,
        conversationEntries: [...(request.conversationEntries ?? [])],
        rootCommand: prepared.rootCommand,
        toolAccessGrant: prepared.toolAccessGrant,
        loadedToolNames: prepared.loadedToolNames,
        activeSkills: prepared.activeSkills,
        onPiBranchBoundary: request.onPiBranchBoundary,
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
      loadedToolNames: [...prepared.loadedToolNames],
      stepTraces: result.stepTraces,
    };
    const terminalEvents = this.events.terminal(
      {
        event: {
          kind: AgentEventKinds.AssistantMessageCreated,
          context: { requestId: request.requestId },
          data: {
            messageId: createAssistantMessageId(),
            kind: "final_answer",
            content: result.responseText,
            terminal: true,
          },
        },
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
          signal: request.signal,
        });

    if (request.onPreparation && this.options.preparationFingerprint) {
      const snapshot = cached
        ? structuredClone(cached)
        : createAgentTurnPreparationSnapshot({
            runtimeFingerprint: this.options.preparationFingerprint,
            userInput: request.input,
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
