import { createModelProviderMetadata } from "../ModelEndpoints/AgentModelMetadata.js";
import type { AgentEventSink } from "../Events/AgentEvent.js";
import { AgentRunActivities } from "../Events/AgentRunEventTypes.js";
import { AgentRunActivityReporter } from "../Events/AgentRunActivityReporter.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { buildAnswerTrace } from "../Core/AgentStepTrace.js";
import { AgentPiRunCollector } from "./AgentPiRunCollector.js";
import { AgentPiConversationProjector } from "./AgentPiConversationProjector.js";
import type { AgentPiRuntimeService, AgentPiSessionResult } from "./AgentPiRuntimeTypes.js";
import type { AgentPiActiveSessionRegistry } from "./AgentPiActiveSessionRegistry.js";
import type { AgentToolSearchRuntime } from "../ToolSearch/AgentToolSearchRuntime.js";
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
import { AgentPiToolPlanCoordinator } from "../PiShared/AgentPiToolPlanCoordinator.js";
import type { AgentPiToolPlanState } from "../PiShared/AgentPiPlanningTypes.js";
import type {
  AgentExecutionObservedToolInput,
  AgentExecutionLedgerService,
} from "../Goals/AgentExecutionLedgerService.js";
import { projectAgentPiPlanningSkills } from "../PiShared/AgentPiPlanningTypes.js";
import { AgentTurnTokenBudget } from "../Text/AgentTurnTokenBudget.js";
import { composeAgentTurnRequest } from "../Prompt/AgentTurnRequestComposer.js";
import { AgentToolExposureState } from "../ToolRuntime/AgentToolExposureState.js";
import type { AgentPiTurnRequest, AgentPiTurnResult } from "./AgentPiTurnTypes.js";
import { AgentPiTurnState } from "./AgentPiTurnState.js";
import type { AgentUploadStore } from "../Uploads/AgentUploadStore.js";

type AgentPiTurnRuntimeService = Pick<AgentPiRuntimeService, "model" | "leaseTurn">;

export interface AgentPiTurnRuntimePort {
  services: {
    pi: AgentPiTurnRuntimeService;
    piSessions: AgentPiActiveSessionRegistry;
    retrieval: Pick<AgentToolSearchRuntime, "afterToolResults">;
    executionLedger?: AgentExecutionLedgerService;
  };
  modelProviderConfig: ResolvedAgentModelProviderConfig;
  agentLoopConfig: Pick<ResolvedAgentLoopConfig, "PiTurnLeaseTimeoutMs">;
  tokenEstimator: {
    estimate(text: string): { tokenCount: number };
  };
  piDiagnostics?: AgentPiDiagnosticSink;
  uploadStore?: Pick<AgentUploadStore, "resolve">;
  promptConfig: () => import("../Types/AgentConfigTypes.js").ResolvedAgentPromptConfig;
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
  private readonly conversation = new AgentPiConversationProjector();

  constructor(private readonly options: AgentPiTurnExecutorOptions) {}

  async run(command: AgentPiTurnRequest, onEvent?: AgentEventSink, signal?: AbortSignal): Promise<AgentPiTurnResult> {
    const model = this.options.runtime.services.pi.model();
    const activities = new AgentRunActivityReporter({
      sessionId: command.sessionId,
      requestId: command.requestId,
      step: command.step,
      onEvent,
    });
    const projected = await activities.track(AgentRunActivities.PreparingContext, () =>
      this.conversation.projectWithImages({
        requestId: command.requestId,
        userInput: command.input,
        conversationEntries: command.conversationEntries,
        model,
        currentAttachments: command.attachments,
        uploadStore: this.options.runtime.uploadStore,
        signal,
      }),
    );
    const usageLedger = activeAgentModelUsageLedger() ?? new AgentModelUsageLedger();
    const toolExposure = new AgentToolExposureState(command.toolAccessGrant);
    const tokenBudget = new AgentTurnTokenBudget({
      model: model.id,
      contextWindowTokens: model.contextWindow,
      outputReserveTokens: model.maxTokens,
    });
    const executionSync = { promise: Promise.resolve() };
    const enqueueExecutionSync = (operation: () => Promise<void> | void): Promise<void> => {
      executionSync.promise = executionSync.promise.then(operation).then(() => undefined);
      return executionSync.promise;
    };
    const onToolPlanChanged = (planState: AgentPiToolPlanState): void => {
      const executionLedger = this.options.runtime.services.executionLedger;
      if (!executionLedger || !command.sessionId) return;
      const sessionId = command.sessionId;
      void enqueueExecutionSync(async () => {
        const input = {
          sessionId,
          requestId: command.requestId,
          objective: command.input,
          planState,
        } as const;
        if (onEvent) return executionLedger.emitPlanSync(input, onEvent).then(() => undefined);
        executionLedger.syncPlan(input);
      });
    };
    const turnState = new AgentPiTurnState({
      sessionId: command.sessionId,
      requestId: command.requestId,
      step: command.step,
      onEvent,
      diagnostics: this.options.runtime.piDiagnostics,
      rootCommand: command.rootCommand,
      approvalMode: command.approvalMode,
      toolAccessGrant: command.toolAccessGrant,
      toolExposure,
      activeSkills: projectAgentPiPlanningSkills(command.activeSkills),
      usageLedger,
      toolPlan: new AgentPiToolPlanCoordinator({ onChanged: onToolPlanChanged }),
      tokenBudget,
      thinkingLevel: command.thinkingLevel,
      activityReporter: activities,
    });
    const collector = new AgentPiRunCollector({
      sessionId: command.sessionId,
      requestId: command.requestId,
      step: command.step,
      onEvent,
      diagnostics: this.options.runtime.piDiagnostics,
      streamModelDeltas: true,
      turnState,
      activityReporter: activities,
      onFinalResponseAvailable: command.onFinalResponseAvailable,
      onToolExecutionObserved: (observation) => {
        const executionLedger = this.options.runtime.services.executionLedger;
        if (!executionLedger || !command.sessionId) return;
        const sessionId = command.sessionId;
        return enqueueExecutionSync(async () => {
          const input: AgentExecutionObservedToolInput = {
            sessionId,
            requestId: command.requestId,
            objective: command.input,
            ...observation,
          };
          return executionLedger.emitObservedTool(input, onEvent).then(() => undefined);
        });
      },
    });
    return this.runWithContext(
      command,
      collector,
      projected,
      turnState,
      usageLedger,
      toolExposure,
      tokenBudget,
      activities,
      executionSync,
      enqueueExecutionSync,
      signal,
      onEvent,
    );
  }

  private async runWithContext(
    command: AgentPiTurnRequest,
    collector: AgentPiRunCollector,
    projected: Awaited<ReturnType<AgentPiConversationProjector["projectWithImages"]>>,
    turnState: AgentPiTurnState,
    usageLedger: AgentModelUsageLedger,
    toolExposure: AgentToolExposureState,
    tokenBudget: AgentTurnTokenBudget,
    activities: AgentRunActivityReporter,
    executionSync: { promise: Promise<void> },
    enqueueExecutionSync: (operation: () => Promise<void> | void) => Promise<void>,
    signal?: AbortSignal,
    onEvent?: AgentEventSink,
  ): Promise<AgentPiTurnResult> {
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
              turnContext: command.turnContext,
              interaction: command.interaction,
              visibleToolNames: command.loadedToolNames,
              toolAccessGrant: command.toolAccessGrant,
              toolExposure,
              onEvent,
              signal,
              turnState,
              activeSkills: command.activeSkills,
              roleplayPresetActive: command.roleplayPresetActive,
              prefaceRewriteEnabled: command.prefaceRewriteEnabled,
              rootCommand: command.rootCommand,
              approvalMode: command.approvalMode,
              tokenBudget,
              thinkingLevel: command.thinkingLevel,
              inheritProjectContext: command.inheritProjectContext,
            }),
          sessionLeaseTimeoutMs,
          signal,
        ),
      );
      const activeSession = sessionResult.session;
      session = activeSession;
      unregisterActiveSession = command.sessionId
        ? this.options.runtime.services.piSessions.register({
            sessionId: command.sessionId,
            requestId: command.requestId,
            step: command.step,
            session: activeSession,
          })
        : undefined;
      await this.emitDiagnostic(command, PiTurnTraceEvents.SessionLeaseCompleted, {
        piSessionId: sessionResult.piSessionId,
        historyMigrationRequired: sessionResult.historyMigrationRequired,
        activeTools: readSessionActiveToolNames(activeSession),
      });

      unsubscribe = activeSession.subscribe((event) => collector.collect(event));
      throwIfAborted(signal);
      if (sessionResult.historyMigrationRequired) {
        await activities.track(AgentRunActivities.SynchronizingContext, () =>
          activeSession.setHistory(projected.history),
        );
      }

      const piBranchBoundaryId = await activeSession.markTurnBoundary(command.requestId);
      await command.onPiBranchBoundary?.(piBranchBoundaryId);
      const promptConfig = this.options.runtime.promptConfig();
      const wireInput = composeAgentTurnRequest({
        userInput: projected.input,
        attachments: command.attachments,
        interaction: command.interaction,
        options: {
          enabled: promptConfig.UserMessageEnvelope,
          timeZone: promptConfig.TimeZone,
        },
      });

      await this.emitDiagnostic(command, PiTurnTraceEvents.PromptStarted, {
        inputChars: wireInput.length,
      });
      await activities.track(AgentRunActivities.RunningAgentTurn, () =>
        runAgentPiGuardedPhase({
          phase: PiTurnPhases.Prompt,
          timeoutMs: turnTimeoutMs,
          signal,
          abort: () => activeSession.abort().catch(() => undefined),
          run: () =>
            activeSession.prompt(wireInput, {
              expandPromptTemplates: false,
              source: "extension",
              ...(projected.images.length > 0 ? { images: projected.images } : {}),
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
      await executionSync.promise;
      const executionLedger = this.options.runtime.services.executionLedger;
      if (executionLedger && command.sessionId) {
        const sessionId = command.sessionId;
        await enqueueExecutionSync(async () => {
          await executionLedger.finalizeExecution(sessionId, command.requestId, onEvent);
        });
      }
      throwIfAborted(signal);

      const responseText = activeSession.getLastAssistantText() ?? "";
      const runtimeProjection = collector.snapshot();
      const loadedToolNames = toolExposure.snapshot().exposedToolNames.slice();
      this.options.runtime.services.retrieval.afterToolResults({
        requestId: command.requestId,
        userInput: command.input,
        sessionId: command.sessionId,
        loadedTools: loadedToolNames,
        execution: { value: [...runtimeProjection.executedTools] },
        activeSkills: command.activeSkills,
      });
      const modelProvider = createModelProviderMetadata(this.options.runtime.modelProviderConfig);
      const usage =
        usageLedger.aggregate() ??
        createLocalTurnUsage(
          this.options.runtime.tokenEstimator,
          [command.prompt, command.turnContext].filter((value): value is string => Boolean(value)).join("\n\n"),
          responseText,
        );
      await this.emitDiagnostic(command, PiTurnTraceEvents.TurnCompleted, {
        responseChars: responseText.length,
        toolCalls: runtimeProjection.executedTools.length,
      });

      return {
        requestId: command.requestId,
        step: command.step,
        responseText,
        modelProvider,
        usage,
        conversationEntries: [],
        stepTraces: [
          ...runtimeProjection.traces,
          buildAnswerTrace(command.step, runtimeProjection.traces.length, "final_answer"),
        ],
        executedTools: runtimeProjection.executedTools,
        loadedToolNames,
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

  private async emitDiagnostic(command: AgentPiTurnRequest, name: string, details?: unknown): Promise<void> {
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
