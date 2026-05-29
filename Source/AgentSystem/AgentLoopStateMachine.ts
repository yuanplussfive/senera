import type { AgentExecutionResult } from "./AgentDecisionExecutor.js";
import type { AgentDomainEvent } from "./AgentEvent.js";
import type {
  AgentCompletedRunResult,
  AgentProjectedTerminalResult,
} from "./AgentExecutionProjector.js";
import type { AgentLanguageModelMessage } from "./AgentLanguageModel.js";
import { matchByKind } from "./AgentMatch.js";
import type { AgentRetryInstruction, AgentRetryableError } from "./AgentRetryableError.js";
import type { SanitizedDecisionXml } from "./AgentDecisionXmlSanitizer.js";
import type { AgentDecision } from "./Types.js";
import { AgentLoopEventFactory } from "./AgentLoopEventFactory.js";
import type { AgentConversationEntry } from "./AgentConversation.js";
import type { AgentModelProviderMetadata, AgentModelUsage } from "./AgentModelMetadata.js";
import { AgentEventKinds } from "./AgentEvent.js";

export interface AgentLoopMachineConfig {
  maxSteps: number;
  maxRepairAttempts: number;
}

export interface RunningAgentLoopMachineState {
  kind: "running";
  requestId: string;
  input: string;
  step: number;
  repairAttempts: number;
  messages: AgentLanguageModelMessage[];
  lastDecisionXml?: string;
  lastModelProvider?: AgentModelProviderMetadata;
  lastUsage?: AgentModelUsage;
}

export interface CompletedAgentLoopMachineState {
  kind: "completed";
  requestId: string;
  result: AgentCompletedRunResult;
}

export interface FailedAgentLoopMachineState {
  kind: "failed";
  requestId: string;
  step: number;
  error: Error;
}

export type AgentLoopMachineState =
  | RunningAgentLoopMachineState
  | CompletedAgentLoopMachineState
  | FailedAgentLoopMachineState;

export type AgentLoopCommand =
  | {
      kind: "render_prompt";
      requestId: string;
      step: number;
    }
  | {
      kind: "collect_decision_xml";
      requestId: string;
      step: number;
      prompt: string;
      messages: AgentLanguageModelMessage[];
    }
  | {
      kind: "parse_decision";
      requestId: string;
      step: number;
      responseText: string;
    }
  | {
      kind: "execute_decision";
      requestId: string;
      step: number;
      responseText: string;
      decision: AgentDecision;
      messages: AgentLanguageModelMessage[];
    }
  | {
      kind: "plan_retry";
      requestId: string;
      step: number;
      attempt: number;
      error: AgentRetryableError;
      responseText: string;
      messages: AgentLanguageModelMessage[];
    };

export type AgentLoopCommandSucceeded =
  | {
      kind: "prompt_rendered";
      requestId: string;
      step: number;
      prompt: string;
      promptTokenCount: number;
    }
  | {
      kind: "tool_calls_collected";
      requestId: string;
      step: number;
      responseText: string;
      toolCallsXml: string;
      modelProvider: AgentModelProviderMetadata;
      usage: AgentModelUsage;
    }
  | {
      kind: "final_text_collected";
      requestId: string;
      step: number;
      responseText: string;
      modelProvider: AgentModelProviderMetadata;
      usage: AgentModelUsage;
    }
  | {
      kind: "decision_parsed";
      requestId: string;
      step: number;
      responseText: string;
      decision: AgentDecision;
      sanitized: SanitizedDecisionXml;
    }
  | {
      kind: "tool_results_generated";
      requestId: string;
      step: number;
      responseText: string;
      execution: Extract<AgentExecutionResult, { kind: "ToolResults" }>;
      resultXml: string;
      messages: AgentLanguageModelMessage[];
      conversationEntries: AgentConversationEntry[];
    }
  | {
      kind: "terminal_projected";
      requestId: string;
      step: number;
      projected: AgentProjectedTerminalResult;
    }
  | {
      kind: "retry_planned";
      requestId: string;
      step: number;
      attempt: number;
      instruction: AgentRetryInstruction;
      responseText: string;
      repairedMessages: AgentLanguageModelMessage[];
    };

export type AgentLoopCommandResult =
  | {
      kind: "succeeded";
      output: AgentLoopCommandSucceeded;
    }
  | {
      kind: "retryable_failed";
      requestId: string;
      step: number;
      error: AgentRetryableError;
      responseText: string;
    };

export interface AgentLoopTransition {
  state: AgentLoopMachineState;
  command?: AgentLoopCommand;
  events: AgentDomainEvent[];
}

export class AgentLoopStateMachine {
  constructor(
    private readonly config: AgentLoopMachineConfig,
    private readonly eventFactory = new AgentLoopEventFactory(),
  ) {}

  start(request: {
    requestId: string;
    input: string;
    messages?: AgentLanguageModelMessage[];
  }): AgentLoopTransition {
    const fallbackMessages: AgentLanguageModelMessage[] = [
      {
        role: "user",
        content: request.input,
      },
    ];
    const state: RunningAgentLoopMachineState = {
      kind: "running",
      requestId: request.requestId,
      input: request.input,
      step: 1,
      repairAttempts: 0,
      messages: request.messages && request.messages.length > 0
        ? request.messages
        : fallbackMessages,
    };

    return {
      state,
      command: this.renderPromptCommand(state),
      events: [
        this.eventFactory.runStarted(request.requestId, request.input),
      ],
    };
  }

  consume(
    state: RunningAgentLoopMachineState,
    result: AgentLoopCommandResult,
  ): AgentLoopTransition {
    return matchByKind(result, {
      succeeded: ({ output }) => this.afterSuccess(state, output),
      retryable_failed: (failure) => this.afterRetryableFailure(state, failure),
    });
  }

  private afterSuccess(
    state: RunningAgentLoopMachineState,
    output: AgentLoopCommandSucceeded,
  ): AgentLoopTransition {
    return matchByKind(output, {
      prompt_rendered: (entry) => ({
        state,
        command: {
          kind: "collect_decision_xml",
          requestId: entry.requestId,
          step: entry.step,
          prompt: entry.prompt,
          messages: state.messages,
        },
        events: this.eventFactory.promptRendered(
          entry.requestId,
          entry.step,
          entry.prompt,
          entry.promptTokenCount,
        ),
      }),
      tool_calls_collected: (entry) => ({
        state: {
          ...state,
          lastDecisionXml: entry.toolCallsXml,
          lastModelProvider: entry.modelProvider,
          lastUsage: entry.usage,
        },
        command: {
          kind: "parse_decision",
          requestId: entry.requestId,
          step: entry.step,
          responseText: entry.toolCallsXml,
        },
        events: [],
      }),
      final_text_collected: (entry) => ({
        state: {
          kind: "completed",
          requestId: entry.requestId,
          result: {
            terminal: {
              kind: "FinalAnswer",
              content: entry.responseText,
            },
            decisionXml: entry.responseText,
            modelProvider: entry.modelProvider,
            usage: entry.usage,
            conversationEntries: [],
          },
        },
        events: this.eventFactory.terminal({
          event: {
            kind: AgentEventKinds.FinalAnswer,
            context: {
              requestId: entry.requestId,
            },
            data: {
              content: entry.responseText,
            },
          },
          result: {
            kind: "FinalAnswer",
            content: entry.responseText,
          },
        }, entry.requestId),
      }),
      decision_parsed: (entry) => ({
        state: {
          ...state,
          lastDecisionXml: entry.sanitized.raw,
        },
        command: {
          kind: "execute_decision",
          requestId: entry.requestId,
          step: entry.step,
          responseText: entry.sanitized.raw,
          decision: entry.decision,
          messages: state.messages,
        },
        events: [
          ...this.eventFactory.sanitizedDecisionXml(entry.requestId, entry.step, entry.sanitized),
          ...this.eventFactory.parsedDecision(entry.requestId, entry.step, entry.decision),
        ],
      }),
      tool_results_generated: (entry) =>
        this.advanceAfterToolResults(
          state,
          entry.messages,
          entry.responseText,
          this.eventFactory.toolResults(
            entry.requestId,
            entry.step,
            entry.execution,
            entry.resultXml,
          ),
        ),
      terminal_projected: (entry) => ({
        state: {
          kind: "completed",
          requestId: entry.requestId,
          result: {
            terminal: entry.projected.result,
            decisionXml: state.lastDecisionXml ?? "",
            modelProvider: state.lastModelProvider,
            usage: state.lastUsage,
            conversationEntries: [],
          },
        },
        events: this.eventFactory.terminal(entry.projected, entry.requestId),
      }),
      retry_planned: (entry) => {
        const nextState: RunningAgentLoopMachineState = {
          ...state,
          repairAttempts: entry.attempt,
          messages: entry.repairedMessages,
          lastDecisionXml: entry.responseText || state.lastDecisionXml,
        };

        return {
          state: nextState,
          command: this.renderPromptCommand(nextState),
          events: this.eventFactory.retryPlanned(
            entry.requestId,
            entry.step,
            entry.attempt,
            entry.instruction,
          ),
        };
      },
    });
  }

  private afterRetryableFailure(
    state: RunningAgentLoopMachineState,
    failure: Extract<AgentLoopCommandResult, { kind: "retryable_failed" }>,
  ): AgentLoopTransition {
    const attempt = state.repairAttempts + 1;

    return attempt > this.config.maxRepairAttempts
      ? this.failed(failure.requestId, failure.step, failure.error)
      : {
          state: {
            ...state,
            lastDecisionXml: failure.responseText || state.lastDecisionXml,
          },
          command: {
            kind: "plan_retry",
            requestId: failure.requestId,
            step: failure.step,
            attempt,
            error: failure.error,
            responseText: failure.responseText,
            messages: state.messages,
          },
          events: [],
        };
  }

  private advanceAfterToolResults(
    state: RunningAgentLoopMachineState,
    messages: AgentLanguageModelMessage[],
    responseText: string,
    events: AgentDomainEvent[],
  ): AgentLoopTransition {
    const nextState: RunningAgentLoopMachineState = {
      ...state,
      step: state.step + 1,
      repairAttempts: 0,
      messages,
      lastDecisionXml: responseText,
    };

    return this.config.maxSteps !== -1 && nextState.step > this.config.maxSteps
      ? this.failed(
          nextState.requestId,
          nextState.step,
          new Error(`AgentLoop 超过最大步数：${this.config.maxSteps}`),
          events,
        )
      : {
          state: nextState,
          command: this.renderPromptCommand(nextState),
          events,
        };
  }

  private renderPromptCommand(state: RunningAgentLoopMachineState): AgentLoopCommand {
    return {
      kind: "render_prompt",
      requestId: state.requestId,
      step: state.step,
    };
  }

  private failed(
    requestId: string,
    step: number,
    error: Error,
    events: AgentDomainEvent[] = [],
  ): AgentLoopTransition {
    return {
      state: {
        kind: "failed",
        requestId,
        step,
        error,
      },
      events,
    };
  }
}
