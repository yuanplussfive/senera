import { createModelProviderMetadata } from "../ModelEndpoints/AgentModelMetadata.js";
import type { AgentLoopCommand, AgentLoopCommandResult } from "../Loop/AgentLoopStateTypes.js";
import { emitAgentEvent, type AgentEventSink } from "../Events/AgentEvent.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { createToolEvidenceMemoryEntries } from "../Memory/AgentPlannerMemory.js";
import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { AgentConversationProjector } from "../Conversation/AgentConversationProjector.js";
import type { AgentOpenAiTranscriptMessage } from "../Conversation/AgentOpenAiTranscript.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import { buildAnswerTrace } from "../Runtime/AgentStepTrace.js";
import { AgentPiRunCollector } from "./AgentPiRunCollector.js";
import { AgentPiOpenAiTranscriptProjector } from "./AgentPiOpenAiTranscriptProjector.js";
import type { AgentPiRuntimeService, AgentPiSessionResult } from "./AgentPiSubstrate.js";
import type { AgentPiActiveSessionRegistry } from "./AgentPiActiveSessionRegistry.js";
import { withPiProxyRuntimeContext } from "../PiProxy/AgentPiProxyRuntimeContext.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type { ResolvedAgentLoopConfig } from "../Types/AgentConfigTypes.js";
import { createPiTraceEvent } from "./AgentPiTraceProjector.js";
import { runAgentPiGuardedPhase } from "./AgentPiTurnGuard.js";

export interface AgentPiTurnRuntimePort {
  services: {
    pi: AgentPiRuntimeService;
    piSessions: AgentPiActiveSessionRegistry;
  };
  modelProviderConfig: ResolvedAgentModelProviderConfig;
  agentLoopConfig: Pick<ResolvedAgentLoopConfig, "PiSessionCreateTimeoutMs">;
  tokenEstimator: {
    estimate(text: string): { tokenCount: number };
  };
  conversationProjector: Pick<AgentConversationProjector, "projectOpenAiTranscript">;
}

export interface AgentPiTurnExecutorOptions {
  runtime: AgentPiTurnRuntimePort;
}

const PiTurnTraceEvents = {
  TurnStarted: "turn.started",
  TurnCompleted: "turn.completed",
  TurnFailed: "turn.failed",
  SessionCreateStarted: "session.create.started",
  SessionCreateCompleted: "session.create.completed",
  PromptStarted: "session.prompt.started",
  PromptCompleted: "session.prompt.completed",
  CollectorDrainStarted: "collector.drain.started",
  CollectorDrainCompleted: "collector.drain.completed",
} as const;

const PiTurnPhases = {
  CreateSession: "session.create",
  Prompt: "session.prompt",
  CollectorDrain: "collector.drain",
} as const;

export class AgentPiTurnExecutor {
  private readonly conversation = new AgentPiOpenAiTranscriptProjector();

  constructor(private readonly options: AgentPiTurnExecutorOptions) {}

  async run(
    command: Extract<AgentLoopCommand, { kind: "run_pi_turn" }>,
    onEvent?: AgentEventSink,
    signal?: AbortSignal,
  ): Promise<AgentLoopCommandResult> {
    const model = this.options.runtime.services.pi.model();
    const projected = this.conversation.project({
      requestId: command.requestId,
      userInput: command.input,
      conversationEntries: command.conversationEntries,
      model,
    });
    return withPiProxyRuntimeContext(
      {
        sessionId: command.sessionId,
        requestId: command.requestId,
        step: command.step,
        onEvent,
        rootCommand: command.rootCommand,
        activeSkills: [...command.activeSkills],
      },
      (piProxyRuntimeContextId) => {
        const collector = new AgentPiRunCollector({
          requestId: command.requestId,
          step: command.step,
          onEvent,
          streamModelDeltas: true,
          piProxyRuntimeContextId,
        });
        return this.runWithContext(command, collector, projected, piProxyRuntimeContextId, signal, onEvent);
      },
    );
  }

  private async runWithContext(
    command: Extract<AgentLoopCommand, { kind: "run_pi_turn" }>,
    collector: AgentPiRunCollector,
    projected: ReturnType<AgentPiOpenAiTranscriptProjector["project"]>,
    piProxyRuntimeContextId: string,
    signal?: AbortSignal,
    onEvent?: AgentEventSink,
  ): Promise<AgentLoopCommandResult> {
    let session: AgentPiSessionResult["session"] | undefined;
    let unsubscribe: (() => void) | undefined;
    let unregisterActiveSession: (() => void) | undefined;
    const modelTimeoutMs = this.options.runtime.modelProviderConfig.TimeoutMs;
    const sessionCreateTimeoutMs = this.options.runtime.agentLoopConfig.PiSessionCreateTimeoutMs;

    try {
      await this.emitTrace(
        command,
        PiTurnTraceEvents.TurnStarted,
        {
          model: this.options.runtime.services.pi.model().id,
          inputChars: projected.input.length,
          historyMessages: projected.history.length,
          visibleTools: summarizeVisibleTools(command.loadedToolNames),
          sessionCreateTimeoutMs,
          modelTimeoutMs,
        },
        onEvent,
      );

      await this.emitTrace(
        command,
        PiTurnTraceEvents.SessionCreateStarted,
        {
          visibleTools: summarizeVisibleTools(command.loadedToolNames),
        },
        onEvent,
      );
      const sessionResult = await this.createSessionWithGuard(
        () =>
          this.options.runtime.services.pi.createSession({
            requestId: command.requestId,
            sessionId: command.sessionId,
            step: command.step,
            input: command.input,
            systemPrompt: command.prompt,
            conversationEntries: command.conversationEntries,
            visibleToolNames: command.loadedToolNames,
            onEvent,
            signal,
            piProxyRuntimeContextId,
            activeSkills: command.activeSkills,
            rootCommand: command.rootCommand,
            turnUnderstanding: command.turnUnderstanding,
          }),
        sessionCreateTimeoutMs,
        signal,
      );
      session = sessionResult.session;
      unregisterActiveSession = command.sessionId
        ? this.options.runtime.services.piSessions.register({
            sessionId: command.sessionId,
            requestId: command.requestId,
            step: command.step,
            session,
          })
        : undefined;
      await this.emitTrace(
        command,
        PiTurnTraceEvents.SessionCreateCompleted,
        {
          piSessionId: sessionResult.piSessionId,
          historyMigrationRequired: sessionResult.historyMigrationRequired,
          activeTools: readSessionActiveToolNames(session),
        },
        onEvent,
      );

      unsubscribe = session.subscribe((event) => {
        void collector.collect(event);
      });
      throwIfAborted(signal);
      if (sessionResult.historyMigrationRequired) {
        await session.setHistory(projected.history);
      }

      await this.emitTrace(
        command,
        PiTurnTraceEvents.PromptStarted,
        {
          inputChars: projected.input.length,
        },
        onEvent,
      );
      await runAgentPiGuardedPhase({
        phase: PiTurnPhases.Prompt,
        timeoutMs: modelTimeoutMs,
        signal,
        abort: () => session?.abort().catch(() => undefined),
        run: () =>
          session!.prompt(projected.input, {
            expandPromptTemplates: false,
            source: "extension",
          }),
      });
      await this.emitTrace(command, PiTurnTraceEvents.PromptCompleted, undefined, onEvent);

      await this.emitTrace(command, PiTurnTraceEvents.CollectorDrainStarted, undefined, onEvent);
      await runAgentPiGuardedPhase({
        phase: PiTurnPhases.CollectorDrain,
        timeoutMs: modelTimeoutMs,
        signal,
        abort: () => session?.abort().catch(() => undefined),
        run: () => collector.drain(),
      });
      await this.emitTrace(command, PiTurnTraceEvents.CollectorDrainCompleted, undefined, onEvent);
      throwIfAborted(signal);

      const responseText = session.getLastAssistantText() ?? "";
      const runtimeProjection = collector.snapshot();
      const modelProvider = createModelProviderMetadata(this.options.runtime.modelProviderConfig);
      const conversationEntries = this.buildConversationEntries(
        command,
        responseText,
        runtimeProjection.executedTools,
        runtimeProjection.openAiMessages,
      );
      await this.emitTrace(
        command,
        PiTurnTraceEvents.TurnCompleted,
        {
          responseChars: responseText.length,
          toolCalls: runtimeProjection.executedTools.length,
        },
        onEvent,
      );

      return {
        kind: "succeeded",
        output: {
          kind: "pi_turn_completed",
          requestId: command.requestId,
          step: command.step,
          responseText,
          modelProvider,
          usage: {
            source: "local_estimate",
            inputTokens: this.options.runtime.tokenEstimator.estimate(command.prompt).tokenCount,
            outputTokens: this.options.runtime.tokenEstimator.estimate(responseText).tokenCount,
          },
          conversationEntries,
          messages: [
            ...command.messages,
            {
              role: "assistant",
              content: responseText,
            },
          ],
          stepTraces: [
            ...runtimeProjection.traces,
            buildAnswerTrace(command.step, runtimeProjection.traces.length, "final_answer"),
          ],
          executedTools: runtimeProjection.executedTools,
        },
      };
    } catch (error) {
      await this.emitTrace(command, PiTurnTraceEvents.TurnFailed, errorPayload(error), onEvent);
      throw error;
    } finally {
      unregisterActiveSession?.();
      unsubscribe?.();
      session?.dispose();
    }
  }

  private async createSessionWithGuard(
    createSession: () => Promise<AgentPiSessionResult>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<AgentPiSessionResult> {
    let createSessionPromise: Promise<AgentPiSessionResult> | undefined;
    try {
      return await runAgentPiGuardedPhase({
        phase: PiTurnPhases.CreateSession,
        timeoutMs,
        signal,
        run: () => {
          createSessionPromise = createSession();
          return createSessionPromise;
        },
      });
    } catch (error) {
      void createSessionPromise?.then(
        (lateSession) => lateSession.session.dispose(),
        () => undefined,
      );
      throw error;
    }
  }

  private async emitTrace(
    command: Extract<AgentLoopCommand, { kind: "run_pi_turn" }>,
    eventType: string,
    payload: unknown,
    onEvent?: AgentEventSink,
  ): Promise<void> {
    await emitAgentEvent(
      onEvent,
      createPiTraceEvent({
        sessionId: command.sessionId,
        requestId: command.requestId,
        step: command.step,
        source: "substrate",
        eventType,
        payload,
      }),
    );
  }

  private buildConversationEntries(
    command: Extract<AgentLoopCommand, { kind: "run_pi_turn" }>,
    _responseText: string,
    results: readonly ExecutedToolCallResult[],
    openAiMessages: readonly AgentOpenAiTranscriptMessage[],
  ): AgentConversationEntry[] {
    const timestamp = new Date().toISOString();
    return [
      ...this.buildOpenAiTranscriptEntries(command, openAiMessages, timestamp),
      ...createToolEvidenceMemoryEntries({
        requestId: command.requestId,
        step: command.step,
        results,
        timestamp,
      }),
    ];
  }

  private buildOpenAiTranscriptEntries(
    command: Extract<AgentLoopCommand, { kind: "run_pi_turn" }>,
    openAiMessages: readonly AgentOpenAiTranscriptMessage[],
    timestamp = new Date().toISOString(),
  ): AgentConversationEntry[] {
    if (openAiMessages.length === 0) {
      return [];
    }

    return [
      this.options.runtime.conversationProjector.projectOpenAiTranscript(
        command.requestId,
        [
          {
            role: "user",
            content: command.input,
          },
          ...openAiMessages,
        ],
        timestamp,
      ),
    ];
  }
}

function summarizeVisibleTools(loadedToolNames: "all" | string[]): unknown {
  return loadedToolNames === "all"
    ? { mode: "all" }
    : {
        mode: "selected",
        count: loadedToolNames.length,
        names: loadedToolNames,
      };
}

function errorPayload(error: unknown): Record<string, unknown> {
  return error instanceof Error
    ? {
        name: error.name,
        message: error.message,
      }
    : {
        message: String(error),
      };
}

function readSessionActiveToolNames(session: AgentPiSessionResult["session"]): string[] | undefined {
  const candidate = session as { getActiveToolNames?: () => string[] };
  return candidate.getActiveToolNames?.();
}
