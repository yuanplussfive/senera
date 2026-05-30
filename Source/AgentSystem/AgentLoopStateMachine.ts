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
import type { AgentActionDecision, AgentActionPlanResult } from "./AgentActionPlanner.js";
import {
  buildInitialActionPlannerLedger,
  type AgentActionPlannerLedger,
} from "./AgentActionPlannerContext.js";

export interface AgentLoopMachineConfig {
  maxSteps: number;
  maxRepairAttempts: number;
  dynamicTools: boolean;
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
  loadedToolNames: "all" | string[];
  plannerLedger: AgentActionPlannerLedger;
  actionDirective?: AgentActionDecision;
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
      kind: "plan_action";
      requestId: string;
      step: number;
      input: string;
      messages: AgentLanguageModelMessage[];
      loadedToolNames: "all" | string[];
      plannerLedger: AgentActionPlannerLedger;
    }
  | {
      kind: "render_prompt";
      requestId: string;
      step: number;
      loadedToolNames: "all" | string[];
      actionDirective?: AgentActionDecision;
    }
  | {
      kind: "collect_decision_xml";
      requestId: string;
      step: number;
      prompt: string;
      messages: AgentLanguageModelMessage[];
      actionDirective?: AgentActionDecision;
      loadedToolNames: "all" | string[];
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
      loadedToolNames: "all" | string[];
      plannerLedger: AgentActionPlannerLedger;
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
      kind: "action_planned";
      requestId: string;
      step: number;
      plan: AgentActionPlanResult;
      loadedToolNames: "all" | string[];
      plannerLedger: AgentActionPlannerLedger;
      actionDirective?: AgentActionDecision;
    }
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
      loadedToolNames: "all" | string[];
      plannerLedger: AgentActionPlannerLedger;
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
    loadedToolNames: "all" | string[];
    actionDirective?: AgentActionDecision;
    emitRunStarted?: boolean;
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
      loadedToolNames: request.loadedToolNames,
      plannerLedger: buildInitialActionPlannerLedger(request.messages),
      actionDirective: request.actionDirective,
    };

    return {
      state,
      command: this.planActionCommand(state),
      events: request.emitRunStarted === false
        ? []
        : [
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
      action_planned: (entry) => {
        const nextState: RunningAgentLoopMachineState = {
          ...state,
          loadedToolNames: entry.loadedToolNames,
          plannerLedger: entry.plannerLedger,
          actionDirective: entry.actionDirective,
        };

        return {
          state: nextState,
          command: this.renderPromptCommand(nextState),
          events: this.eventFactory.actionPlanned(
            entry.requestId,
            entry.step,
            entry.plan,
            entry.loadedToolNames,
          ),
        };
      },
      prompt_rendered: (entry) => ({
        state,
        command: {
          kind: "collect_decision_xml",
          requestId: entry.requestId,
          step: entry.step,
          prompt: entry.prompt,
          messages: state.messages,
          actionDirective: state.actionDirective,
          loadedToolNames: state.loadedToolNames,
          plannerLedger: state.plannerLedger,
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
          repairAttempts: 0,
        },
        command: {
          kind: "execute_decision",
          requestId: entry.requestId,
          step: entry.step,
          responseText: entry.sanitized.raw,
          decision: entry.decision,
          messages: state.repairAttempts > 0
            ? this.stripRepairConversation(state.messages)
            : state.messages,
          loadedToolNames: state.loadedToolNames,
          plannerLedger: state.plannerLedger,
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
          entry.loadedToolNames,
          entry.plannerLedger,
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
    loadedToolNames: "all" | string[],
    plannerLedger: AgentActionPlannerLedger,
    events: AgentDomainEvent[],
  ): AgentLoopTransition {
    const nextState: RunningAgentLoopMachineState = {
      ...state,
      step: state.step + 1,
      repairAttempts: 0,
      messages,
      loadedToolNames: this.config.dynamicTools ? loadedToolNames : state.loadedToolNames,
      plannerLedger,
      lastDecisionXml: responseText,
      actionDirective: undefined,
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
          command: this.planActionCommand(nextState),
          events,
        };
  }

  private stripRepairConversation(
    messages: AgentLanguageModelMessage[],
  ): AgentLanguageModelMessage[] {
    const last = messages.at(-1);
    const previous = messages.at(-2);
    return last?.role === "user" && previous?.role === "assistant"
      ? messages.slice(0, -2)
      : messages;
  }

  private renderPromptCommand(state: RunningAgentLoopMachineState): AgentLoopCommand {
    return {
      kind: "render_prompt",
      requestId: state.requestId,
      step: state.step,
      loadedToolNames: state.loadedToolNames,
      actionDirective: state.actionDirective,
    };
  }

  private planActionCommand(state: RunningAgentLoopMachineState): AgentLoopCommand {
    return {
      kind: "plan_action",
      requestId: state.requestId,
      step: state.step,
      input: state.input,
      messages: state.messages,
      loadedToolNames: state.loadedToolNames,
      plannerLedger: state.plannerLedger,
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
