import { createModelProviderMetadata } from "../ModelEndpoints/AgentModelMetadata.js";
import type { AgentLoopCommand, AgentLoopCommandResult } from "../Loop/AgentLoopStateTypes.js";
import type { AgentEventSink } from "../Events/AgentEvent.js";
import { AgentRunActivities } from "../Events/AgentRunEventTypes.js";
import { AgentRunActivityReporter } from "../Events/AgentRunActivityReporter.js";
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
import { AgentPiPreparedActionLease } from "../PiProxy/AgentPiPreparedActionLease.js";
import {
  AgentModelUsageLedger,
  AgentModelUsageSources,
  activeAgentModelUsageLedger,
  type AgentModelUsage,
} from "../ModelEndpoints/AgentModelUsage.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type { ResolvedAgentLoopConfig } from "../Types/AgentConfigTypes.js";
import { AgentPiDiagnosticSources, emitAgentPiDiagnostic, type AgentPiDiagnosticSink } from "./AgentPiDiagnostics.js";
import { runAgentPiGuardedPhase } from "./AgentPiTurnGuard.js";

export interface AgentPiTurnRuntimePort {
  services: {
    pi: AgentPiRuntimeService;
    piSessions: AgentPiActiveSessionRegistry;
  };
  modelProviderConfig: ResolvedAgentModelProviderConfig;
  agentLoopConfig: Pick<ResolvedAgentLoopConfig, "PiTurnLeaseTimeoutMs">;
  tokenEstimator: {
    estimate(text: string): { tokenCount: number };
  };
  conversationProjector: Pick<AgentConversationProjector, "projectOpenAiTranscript">;
  piDiagnostics?: AgentPiDiagnosticSink;
}

export interface AgentPiTurnExecutorOptions {
  runtime: AgentPiTurnRuntimePort;
}

const PiTurnTraceEvents = {
  TurnStarted: "turn.started",
  TurnCompleted: "turn.completed",
  TurnFailed: "turn.failed",
  SessionLeaseStarted: "session.lease.started",
  SessionLeaseCompleted: "session.lease.completed",
  PromptStarted: "session.prompt.started",
  PromptCompleted: "session.prompt.completed",
  CollectorDrainStarted: "collector.drain.started",
  CollectorDrainCompleted: "collector.drain.completed",
} as const;

const PiTurnPhases = {
  LeaseSession: "session.lease",
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
    const activities = new AgentRunActivityReporter({
      sessionId: command.sessionId,
      requestId: command.requestId,
      step: command.step,
      onEvent,
    });
    const projected = await activities.track(AgentRunActivities.PreparingContext, () =>
      this.conversation.project({
        requestId: command.requestId,
        userInput: command.input,
        conversationEntries: command.conversationEntries,
        model,
      }),
    );
    const usageLedger = activeAgentModelUsageLedger() ?? new AgentModelUsageLedger();
    return withPiProxyRuntimeContext(
      {
        sessionId: command.sessionId,
        requestId: command.requestId,
        step: command.step,
        onEvent,
        diagnostics: this.options.runtime.piDiagnostics,
        rootCommand: command.rootCommand,
        interactionRoute: command.interactionRoute,
        turnUnderstanding: command.turnUnderstanding,
        activeSkills: [...command.activeSkills],
        usageLedger,
        preparedAction: new AgentPiPreparedActionLease(command.initialAction),
      },
      (piProxyRuntimeContextId) => {
        const collector = new AgentPiRunCollector({
          sessionId: command.sessionId,
          requestId: command.requestId,
          step: command.step,
          onEvent,
          diagnostics: this.options.runtime.piDiagnostics,
          streamModelDeltas: true,
          piProxyRuntimeContextId,
          activityReporter: activities,
        });
        return this.runWithContext(
          command,
          collector,
          projected,
          piProxyRuntimeContextId,
          usageLedger,
          activities,
          signal,
          onEvent,
        );
      },
    );
  }

  private async runWithContext(
    command: Extract<AgentLoopCommand, { kind: "run_pi_turn" }>,
    collector: AgentPiRunCollector,
    projected: ReturnType<AgentPiOpenAiTranscriptProjector["project"]>,
    piProxyRuntimeContextId: string,
    usageLedger: AgentModelUsageLedger,
    activities: AgentRunActivityReporter,
    signal?: AbortSignal,
    onEvent?: AgentEventSink,
  ): Promise<AgentLoopCommandResult> {
    let session: AgentPiSessionResult["session"] | undefined;
    let unsubscribe: (() => void) | undefined;
    let unregisterActiveSession: (() => void) | undefined;
    const modelTimeoutMs = this.options.runtime.modelProviderConfig.TimeoutMs;
    const turnTimeoutMs = this.options.runtime.modelProviderConfig.MaxRequestMs;
    const sessionLeaseTimeoutMs = this.options.runtime.agentLoopConfig.PiTurnLeaseTimeoutMs;

    try {
      await this.emitDiagnostic(command, PiTurnTraceEvents.TurnStarted, {
        model: this.options.runtime.services.pi.model().id,
        inputChars: projected.input.length,
        historyMessages: projected.history.length,
        visibleTools: summarizeVisibleTools(command.loadedToolNames),
        sessionLeaseTimeoutMs,
        modelTimeoutMs,
        turnTimeoutMs,
      });

      await this.emitDiagnostic(command, PiTurnTraceEvents.SessionLeaseStarted, {
        visibleTools: summarizeVisibleTools(command.loadedToolNames),
      });
      const sessionResult = await activities.track(AgentRunActivities.InitializingRuntime, () =>
        this.leaseSessionWithGuard(
          () =>
            this.options.runtime.services.pi.leaseTurn({
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
          sessionLeaseTimeoutMs,
          signal,
        ),
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
      await this.emitDiagnostic(command, PiTurnTraceEvents.SessionLeaseCompleted, {
        piSessionId: sessionResult.piSessionId,
        historyMigrationRequired: sessionResult.historyMigrationRequired,
        activeTools: readSessionActiveToolNames(session),
      });

      unsubscribe = session.subscribe((event) => collector.collect(event));
      throwIfAborted(signal);
      if (sessionResult.historyMigrationRequired) {
        await activities.track(AgentRunActivities.SynchronizingContext, () => session!.setHistory(projected.history));
      }

      const piBranchBoundaryId = await session.markTurnBoundary(command.requestId);
      await command.onPiBranchBoundary?.(piBranchBoundaryId);

      const compactIfNeeded = session.compactIfNeeded?.bind(session);
      if (compactIfNeeded) {
        await activities.track(AgentRunActivities.EvaluatingContext, () => compactIfNeeded(signal));
      }

      await this.emitDiagnostic(command, PiTurnTraceEvents.PromptStarted, {
        inputChars: projected.input.length,
      });
      await activities.track(AgentRunActivities.RunningAgentTurn, () =>
        runAgentPiGuardedPhase({
          phase: PiTurnPhases.Prompt,
          timeoutMs: turnTimeoutMs,
          signal,
          abort: () => session?.abort().catch(() => undefined),
          run: () =>
            session!.prompt(projected.input, {
              expandPromptTemplates: false,
              source: "extension",
            }),
        }),
      );
      await this.emitDiagnostic(command, PiTurnTraceEvents.PromptCompleted);

      await this.emitDiagnostic(command, PiTurnTraceEvents.CollectorDrainStarted);
      await activities.track(AgentRunActivities.FinalizingResponse, () =>
        runAgentPiGuardedPhase({
          phase: PiTurnPhases.CollectorDrain,
          timeoutMs: modelTimeoutMs,
          signal,
          abort: () => session?.abort().catch(() => undefined),
          run: () => collector.drain(),
        }),
      );
      await this.emitDiagnostic(command, PiTurnTraceEvents.CollectorDrainCompleted);
      throwIfAborted(signal);

      const responseText = session.getLastAssistantText() ?? "";
      const runtimeProjection = collector.snapshot();
      const modelProvider = createModelProviderMetadata(this.options.runtime.modelProviderConfig);
      const usage =
        usageLedger.aggregate() ??
        createLocalTurnUsage(this.options.runtime.tokenEstimator, command.prompt, responseText);
      const conversationEntries = this.buildConversationEntries(
        command,
        responseText,
        runtimeProjection.executedTools,
        runtimeProjection.openAiMessages,
      );
      await this.emitDiagnostic(command, PiTurnTraceEvents.TurnCompleted, {
        responseChars: responseText.length,
        toolCalls: runtimeProjection.executedTools.length,
      });

      return {
        kind: "succeeded",
        output: {
          kind: "pi_turn_completed",
          requestId: command.requestId,
          step: command.step,
          responseText,
          modelProvider,
          usage,
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
      await this.emitDiagnostic(command, PiTurnTraceEvents.TurnFailed, errorPayload(error));
      throw error;
    } finally {
      unregisterActiveSession?.();
      unsubscribe?.();
      session?.dispose();
    }
  }

  private async leaseSessionWithGuard(
    leaseSession: () => Promise<AgentPiSessionResult>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<AgentPiSessionResult> {
    let leaseSessionPromise: Promise<AgentPiSessionResult> | undefined;
    try {
      return await runAgentPiGuardedPhase({
        phase: PiTurnPhases.LeaseSession,
        timeoutMs,
        signal,
        run: () => {
          leaseSessionPromise = leaseSession();
          return leaseSessionPromise;
        },
      });
    } catch (error) {
      const disposeLateSession = leaseSessionPromise?.then(
        (lateSession) => lateSession.session.dispose(),
        () => undefined,
      );
      if (signal?.aborted) await disposeLateSession;
      else void disposeLateSession;
      throw error;
    }
  }

  private async emitDiagnostic(
    command: Extract<AgentLoopCommand, { kind: "run_pi_turn" }>,
    name: string,
    details?: unknown,
  ): Promise<void> {
    await emitAgentPiDiagnostic(this.options.runtime.piDiagnostics, {
      context: {
        sessionId: command.sessionId,
        requestId: command.requestId,
        step: command.step,
      },
      source: AgentPiDiagnosticSources.Substrate,
      name,
      details,
    });
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

function createLocalTurnUsage(
  estimator: AgentPiTurnRuntimePort["tokenEstimator"],
  input: string,
  output: string,
): AgentModelUsage {
  const inputTokens = estimator.estimate(input).tokenCount;
  const outputTokens = estimator.estimate(output).tokenCount;
  return {
    source: AgentModelUsageSources.LocalEstimate,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedFields: ["inputTokens", "outputTokens", "totalTokens"],
  };
}

function summarizeVisibleTools(loadedToolNames: string[]): unknown {
  return {
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
