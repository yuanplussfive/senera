import type { AgentLanguageModelMessage } from "../ModelEndpoints/AgentLanguageModel.js";
import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { AgentEventSink } from "../Events/AgentEvent.js";
import { AgentEventKinds, emitAgentEvent } from "../Events/AgentEvent.js";
import type { AgentLanguageModel } from "../ModelEndpoints/AgentLanguageModel.js";
import { AgentLoopCommandExecutor, type AgentLoopCommandExecutorOptions } from "./AgentLoopCommandExecutor.js";
import { AgentLoopStateMachine } from "./AgentLoopStateMachine.js";
import type {
  AgentLoopCommandResult,
  AgentLoopMachineState,
  RunningAgentLoopMachineState,
} from "./AgentLoopStateTypes.js";
import type { AgentSystemRuntime } from "../Runtime/AgentSystemRuntime.js";
import type { AgentCompletedRunResult } from "../Runtime/AgentExecutionProjector.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { createOpaqueId } from "../Core/AgentIds.js";
import { AgentModelUsageLedger, withAgentModelUsageLedger } from "../ModelEndpoints/AgentModelUsage.js";
import {
  createAgentTurnPreparationSnapshot,
  isAgentTurnPreparationReusable,
  type AgentTurnPreparationSnapshot,
} from "./AgentTurnPreparationSnapshot.js";

export interface AgentLoopOptions extends AgentLoopCommandExecutorOptions {
  runtime: AgentSystemRuntime;
  model: AgentLanguageModel;
  preparationFingerprint?: string;
}

export interface AgentRunRequest {
  sessionId?: string;
  requestId: string;
  input: string;
  messages?: AgentLanguageModelMessage[];
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
  commitTerminalEvents?: (events: import("../Events/AgentEvent.js").AgentDomainEvent[]) => void | Promise<void>;
}

export class AgentLoop {
  private readonly stateMachine: AgentLoopStateMachine;
  private readonly commandExecutor: AgentLoopCommandExecutor;

  constructor(private readonly options: AgentLoopOptions) {
    this.stateMachine = new AgentLoopStateMachine();
    this.commandExecutor = new AgentLoopCommandExecutor(options);
  }

  async run(request: AgentRunRequest): Promise<AgentCompletedRunResult> {
    try {
      return await withAgentModelUsageLedger(new AgentModelUsageLedger(), () => this.runWithUsageContext(request));
    } finally {
      this.options.runtime.services.retrieval.finishRequest(request.requestId);
    }
  }

  private async runWithUsageContext(request: AgentRunRequest): Promise<AgentCompletedRunResult> {
    if (request.emitRunStarted !== false) {
      await emitAgentEvent(request.onEvent, {
        kind: AgentEventKinds.RunStarted,
        context: {
          requestId: request.requestId,
        },
        data: {
          input: request.input,
        },
      });
    }

    const loadedToolNames =
      request.loadedToolNames ?? this.options.runtime.services.retrieval.resolveInitialLoadedTools(request.input);
    const preparation = isAgentTurnPreparationReusable(request.preparation, {
      runtimeFingerprint: this.options.preparationFingerprint,
      userInput: request.input,
    })
      ? request.preparation
      : undefined;
    if (preparation) {
      await request.onPreparation?.(structuredClone(preparation));
    }
    let transition = this.stateMachine.start({
      sessionId: request.sessionId,
      requestId: request.requestId,
      input: request.input,
      messages: request.messages,
      conversationEntries: request.conversationEntries,
      loadedToolNames,
      systemPromptPreamble: request.systemPromptPreamble,
      emitRunStarted: false,
      preparation,
      onPiBranchBoundary: request.onPiBranchBoundary,
    });

    await this.emitAll(request.onEvent, transition.events);

    while (transition.command) {
      // 命令间检查取消信号
      throwIfAborted(request.signal);
      const runningState = this.expectRunningState(transition.state);
      const result = await this.commandExecutor.execute(transition.command, request.onEvent, request.signal);
      await this.persistPreparationIfReady(request, result);
      transition = this.stateMachine.consume(runningState, result);
      if (!transition.command && request.commitTerminalEvents) {
        this.identifyAll(transition.events);
        await request.commitTerminalEvents(transition.events);
      } else {
        await this.emitAll(request.onEvent, transition.events);
      }
    }

    return this.unwrapTerminalResult(transition.state);
  }

  private async persistPreparationIfReady(request: AgentRunRequest, result: AgentLoopCommandResult): Promise<void> {
    if (
      result.output.kind !== "interaction_prepared" ||
      !request.onPreparation ||
      !this.options.preparationFingerprint
    ) {
      return;
    }

    await request.onPreparation(
      createAgentTurnPreparationSnapshot({
        runtimeFingerprint: this.options.preparationFingerprint,
        userInput: request.input,
        turnUnderstanding: result.output.turnUnderstanding,
        route: result.output.route,
        loadedToolNames: result.output.loadedToolNames,
        rootCommand: result.output.rootCommand,
        initialAction: result.output.initialAction,
        activeSkills: result.output.activeSkills,
      }),
    );
  }

  private async emitAll(
    onEvent: AgentEventSink | undefined,
    events: import("../Events/AgentEvent.js").AgentDomainEvent[],
  ): Promise<void> {
    this.identifyAll(events);
    for (const event of events) await emitAgentEvent(onEvent, event);
  }

  private identifyAll(events: import("../Events/AgentEvent.js").AgentDomainEvent[]): void {
    for (const [index, event] of events.entries()) {
      events[index] = event.eventId ? event : { ...event, eventId: createOpaqueId("event") };
    }
  }

  private expectRunningState(state: AgentLoopMachineState): RunningAgentLoopMachineState {
    if (state.kind !== "running") {
      throw new Error("AgentLoop 状态机在非 running 状态下仍尝试执行命令。");
    }

    return state;
  }

  private unwrapTerminalResult(state: AgentLoopMachineState): AgentCompletedRunResult {
    if (state.kind === "completed") {
      return state.result;
    }

    throw new Error("AgentLoop 在命令结束后没有得到终态结果。");
  }
}
