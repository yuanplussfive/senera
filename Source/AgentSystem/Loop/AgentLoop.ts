import type { AgentLanguageModelMessage } from "../ModelEndpoints/AgentLanguageModel.js";
import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { AgentEventSink } from "../Events/AgentEvent.js";
import { AgentEventKinds, emitAgentEvent } from "../Events/AgentEvent.js";
import type { AgentLanguageModel } from "../ModelEndpoints/AgentLanguageModel.js";
import { AgentLoopCommandExecutor, type AgentLoopCommandExecutorOptions } from "./AgentLoopCommandExecutor.js";
import { AgentLoopStateMachine } from "./AgentLoopStateMachine.js";
import type { AgentLoopMachineState, RunningAgentLoopMachineState } from "./AgentLoopStateTypes.js";
import type { AgentSystemRuntime } from "../Runtime/AgentSystemRuntime.js";
import type { AgentCompletedRunResult } from "../Runtime/AgentExecutionProjector.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import type { ResolvedAgentLoopConfig } from "../Types/AgentConfigTypes.js";

export interface AgentLoopOptions extends AgentLoopCommandExecutorOptions {
  runtime: AgentSystemRuntime;
  model: AgentLanguageModel;
  agentLoopConfig?: ResolvedAgentLoopConfig;
}

export interface AgentRunRequest {
  sessionId?: string;
  requestId: string;
  input: string;
  messages?: AgentLanguageModelMessage[];
  conversationEntries?: AgentConversationEntry[];
  loadedToolNames?: "all" | string[];
  systemPromptPreamble?: string;
  onEvent?: AgentEventSink;
  signal?: AbortSignal;
}

export class AgentLoop {
  private readonly agentLoopConfig: ResolvedAgentLoopConfig;
  private readonly stateMachine: AgentLoopStateMachine;
  private readonly commandExecutor: AgentLoopCommandExecutor;

  constructor(private readonly options: AgentLoopOptions) {
    this.agentLoopConfig = options.agentLoopConfig ?? options.runtime.agentLoopConfig;
    this.stateMachine = new AgentLoopStateMachine();
    this.commandExecutor = new AgentLoopCommandExecutor({
      ...options,
      agentLoopConfig: this.agentLoopConfig,
    });
  }

  async run(request: AgentRunRequest): Promise<AgentCompletedRunResult> {
    await emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.RunStarted,
      context: {
        requestId: request.requestId,
      },
      data: {
        input: request.input,
      },
    });

    const loadedToolNames =
      request.loadedToolNames ??
      this.options.runtime.services.retrieval.resolveInitialLoadedTools(
        request.input,
        this.agentLoopConfig.LoadedTools,
      );
    let transition = this.stateMachine.start({
      sessionId: request.sessionId,
      requestId: request.requestId,
      input: request.input,
      messages: request.messages,
      conversationEntries: request.conversationEntries,
      loadedToolNames,
      systemPromptPreamble: request.systemPromptPreamble,
      emitRunStarted: false,
    });

    await this.emitAll(request.onEvent, transition.events);

    while (transition.command) {
      // 命令间检查取消信号
      throwIfAborted(request.signal);
      const runningState = this.expectRunningState(transition.state);
      const result = await this.commandExecutor.execute(transition.command, request.onEvent, request.signal);
      transition = this.stateMachine.consume(runningState, result);
      await this.emitAll(request.onEvent, transition.events);
    }

    return this.unwrapTerminalResult(transition.state);
  }

  private async emitAll(
    onEvent: AgentEventSink | undefined,
    events: import("../Events/AgentEvent.js").AgentDomainEvent[],
  ): Promise<void> {
    for (const event of events) {
      await emitAgentEvent(onEvent, event);
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
