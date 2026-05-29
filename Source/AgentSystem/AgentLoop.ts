import type { AgentLanguageModelMessage } from "./AgentLanguageModel.js";
import type { AgentEventSink } from "./AgentEvent.js";
import { emitAgentEvent } from "./AgentEvent.js";
import type { AgentLanguageModel } from "./AgentLanguageModel.js";
import {
  AgentLoopCommandExecutor,
  type AgentLoopCommandExecutorOptions,
} from "./AgentLoopCommandExecutor.js";
import {
  AgentLoopStateMachine,
  type AgentLoopMachineState,
  type RunningAgentLoopMachineState,
} from "./AgentLoopStateMachine.js";
import type { AgentSystemRuntime } from "./AgentSystemRuntime.js";
import type { AgentCompletedRunResult } from "./AgentExecutionProjector.js";

export interface AgentLoopOptions extends AgentLoopCommandExecutorOptions {
  runtime: AgentSystemRuntime;
  model: AgentLanguageModel;
}

export interface AgentRunRequest {
  requestId: string;
  input: string;
  messages?: AgentLanguageModelMessage[];
  onEvent?: AgentEventSink;
  signal?: AbortSignal;
}

export class AgentLoop {
  private readonly stateMachine: AgentLoopStateMachine;
  private readonly commandExecutor: AgentLoopCommandExecutor;

  constructor(private readonly options: AgentLoopOptions) {
    this.stateMachine = new AgentLoopStateMachine({
      maxSteps: options.runtime.agentLoopConfig.MaxSteps,
      maxRepairAttempts: options.runtime.agentLoopConfig.MaxRepairAttempts,
    });
    this.commandExecutor = new AgentLoopCommandExecutor(options);
  }

  async run(request: AgentRunRequest): Promise<AgentCompletedRunResult> {
    let transition = this.stateMachine.start({
      requestId: request.requestId,
      input: request.input,
      messages: request.messages,
    });

    await this.emitAll(request.onEvent, transition.events);

    while (transition.command) {
      // 命令间检查取消信号
      if (request.signal?.aborted) {
        throw new AgentCancellationError();
      }
      const runningState = this.expectRunningState(transition.state);
      const result = await this.commandExecutor.execute(
        transition.command,
        request.onEvent,
        request.signal,
      );
      transition = this.stateMachine.consume(runningState, result);
      await this.emitAll(request.onEvent, transition.events);
    }

    return this.unwrapTerminalResult(transition.state);
  }

  private async emitAll(
    onEvent: AgentEventSink | undefined,
    events: import("./AgentEvent.js").AgentDomainEvent[],
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

    if (state.kind === "failed") {
      throw state.error;
    }

    throw new Error("AgentLoop 在命令结束后没有得到终态结果。");
  }
}

/** 用户主动取消运行时抛出。用 instanceof 判定，不依赖错误消息字符串。 */
export class AgentCancellationError extends Error {
  readonly kind = "AgentCancellationError" as const;
  constructor(message = "Run cancelled by user.") {
    super(message);
    this.name = "AgentCancellationError";
  }
}
