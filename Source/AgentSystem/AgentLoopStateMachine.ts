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
import type { AgentDecision } from "./Types/ToolRuntimeTypes.js";
import { AgentLoopEventFactory } from "./AgentLoopEventFactory.js";
import type { AgentConversationEntry } from "./AgentConversation.js";
import type { AgentModelProviderMetadata, AgentModelUsage } from "./AgentModelMetadata.js";
import { AgentEventKinds } from "./AgentEvent.js";
import {
  type AgentActionPlanResult,
} from "./AgentActionPlanner.js";
import {
  buildInitialActionPlannerLedger,
  type AgentActionPlannerLedger,
} from "./AgentActionPlannerContext.js";
import {
  buildAnswerTrace,
  buildDecisionTrace,
  buildRetryTrace,
  buildToolTraces,
  type StepTrace,
} from "./AgentStepTrace.js";
import type { AgentRootCommand } from "./AgentRootCommand.js";
import type { AgentActivatedSkill } from "./AgentSkillActivation.js";
import {
  AgentInteractionRunModes,
  type AgentInteractionRouteResult,
} from "./AgentInteractionRouter.js";
import type { TurnUnderstanding } from "./BamlClient/baml_client/types.js";

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
  conversationEntries: AgentConversationEntry[];
  lastDecisionXml?: string;
  lastModelProvider?: AgentModelProviderMetadata;
  lastUsage?: AgentModelUsage;
  loadedToolNames: "all" | string[];
  plannerLedger: AgentActionPlannerLedger;
  rootCommand?: AgentRootCommand;
  turnUnderstanding?: TurnUnderstanding;
  toolPlanDiscoveryEscalated: boolean;
  systemPromptPreamble?: string;
  activeSkills: AgentActivatedSkill[];
  /** 精简档执行轨迹累积；spread 转移天然透传，终态输出供 manager 落盘 */
  stepTraces: StepTrace[];
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
      kind: "route_interaction";
      requestId: string;
      step: number;
      input: string;
      messages: AgentLanguageModelMessage[];
      conversationEntries: AgentConversationEntry[];
      loadedToolNames: "all" | string[];
      plannerLedger: AgentActionPlannerLedger;
      turnUnderstanding?: TurnUnderstanding;
    }
  | {
      kind: "plan_action";
      requestId: string;
      step: number;
      input: string;
      messages: AgentLanguageModelMessage[];
      conversationEntries: AgentConversationEntry[];
      loadedToolNames: "all" | string[];
      plannerLedger: AgentActionPlannerLedger;
      turnUnderstanding?: TurnUnderstanding;
    }
  | {
      kind: "render_prompt";
      requestId: string;
      step: number;
      input: string;
      loadedToolNames: "all" | string[];
      rootCommand?: AgentRootCommand;
      systemPromptPreamble?: string;
      activeSkills?: readonly AgentActivatedSkill[];
    }
  | {
      kind: "collect_decision_xml";
      requestId: string;
      step: number;
      prompt: string;
      messages: AgentLanguageModelMessage[];
      rootCommand?: AgentRootCommand;
      loadedToolNames: "all" | string[];
    }
  | {
      kind: "collect_tool_call_plan";
      requestId: string;
      step: number;
      input: string;
      messages: AgentLanguageModelMessage[];
      conversationEntries: AgentConversationEntry[];
      rootCommand: AgentRootCommand;
      loadedToolNames: "all" | string[];
      plannerLedger: AgentActionPlannerLedger;
      turnUnderstanding?: TurnUnderstanding;
      activeSkills: AgentActivatedSkill[];
      toolPlanDiscoveryEscalated?: boolean;
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
      conversationEntries: AgentConversationEntry[];
      loadedToolNames: "all" | string[];
      plannerLedger: AgentActionPlannerLedger;
      turnUnderstanding?: TurnUnderstanding;
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
      kind: "interaction_routed";
      requestId: string;
      step: number;
      route: AgentInteractionRouteResult;
      loadedToolNames: "all" | string[];
      rootCommand?: AgentRootCommand;
      turnUnderstanding?: TurnUnderstanding;
      activeSkills: AgentActivatedSkill[];
    }
  | {
      kind: "action_planned";
      requestId: string;
      step: number;
      plan: AgentActionPlanResult;
      loadedToolNames: "all" | string[];
      plannerLedger: AgentActionPlannerLedger;
      conversationEntries: AgentConversationEntry[];
      rootCommand?: AgentRootCommand;
      turnUnderstanding?: TurnUnderstanding;
      activeSkills: AgentActivatedSkill[];
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
      modelProvider?: AgentModelProviderMetadata;
      usage?: AgentModelUsage;
    }
  | {
      kind: "tool_call_discovery_planned";
      requestId: string;
      step: number;
      reason: string;
      issues: string[];
      loadedToolNames: "all" | string[];
      rootCommand: AgentRootCommand;
      activeSkills: AgentActivatedSkill[];
    }
  | {
      kind: "tool_call_planning_blocked";
      requestId: string;
      step: number;
      reason: string;
      issues: string[];
      rootCommand: AgentRootCommand;
      systemPromptPreamble?: string;
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
    conversationEntries?: AgentConversationEntry[];
    loadedToolNames: "all" | string[];
    rootCommand?: AgentRootCommand;
    systemPromptPreamble?: string;
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
      conversationEntries: [...(request.conversationEntries ?? [])],
      loadedToolNames: request.loadedToolNames,
      plannerLedger: buildInitialActionPlannerLedger(request.messages),
      rootCommand: request.rootCommand,
      toolPlanDiscoveryEscalated: false,
      systemPromptPreamble: request.systemPromptPreamble,
      activeSkills: [],
      stepTraces: [],
    };

    return {
      state,
      command: this.routeInteractionCommand(state),
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
      interaction_routed: (entry) => {
        const nextState: RunningAgentLoopMachineState = {
          ...state,
          loadedToolNames: entry.loadedToolNames,
          rootCommand: entry.rootCommand,
          turnUnderstanding: entry.turnUnderstanding,
          activeSkills: [...entry.activeSkills],
        };
        const routeEvents = this.eventFactory.interactionRouted(
          entry.requestId,
          entry.step,
          entry.route,
          entry.loadedToolNames,
          entry.rootCommand,
        );

        if (entry.route.mode === AgentInteractionRunModes.DeliberateTaskLoop) {
          return {
            state: nextState,
            command: this.planActionCommand(nextState),
            events: routeEvents,
          };
        }

        return {
          state: nextState,
          command: this.nextDecisionCommand(nextState),
          events: routeEvents,
        };
      },
      action_planned: (entry) => {
        const nextState: RunningAgentLoopMachineState = {
          ...state,
          loadedToolNames: entry.loadedToolNames,
          plannerLedger: entry.plannerLedger,
          conversationEntries: entry.conversationEntries,
          rootCommand: entry.rootCommand,
          turnUnderstanding: entry.turnUnderstanding,
          activeSkills: [...entry.activeSkills],
        };
        const actionEvents = this.eventFactory.actionPlanned(
          entry.requestId,
          entry.step,
          entry.plan,
          entry.loadedToolNames,
          entry.rootCommand,
          entry.activeSkills,
        );

        return {
          state: nextState,
          command: this.nextDecisionCommand(nextState),
          events: actionEvents,
        };
      },
      prompt_rendered: (entry) => ({
        state,
        command: state.rootCommand?.outputMode === "tool_call_xml"
          ? {
              kind: "collect_tool_call_plan",
              requestId: entry.requestId,
              step: entry.step,
              input: state.input,
              messages: state.messages,
              conversationEntries: state.conversationEntries,
              rootCommand: state.rootCommand,
              loadedToolNames: state.loadedToolNames,
              plannerLedger: state.plannerLedger,
              turnUnderstanding: state.turnUnderstanding,
              activeSkills: state.activeSkills,
            }
          : {
              kind: "collect_decision_xml",
              requestId: entry.requestId,
              step: entry.step,
              prompt: entry.prompt,
              messages: state.messages,
              rootCommand: state.rootCommand,
              loadedToolNames: state.loadedToolNames,
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
      tool_call_discovery_planned: (entry) => {
        const nextState: RunningAgentLoopMachineState = {
          ...state,
          loadedToolNames: entry.loadedToolNames,
          rootCommand: entry.rootCommand,
          activeSkills: [...entry.activeSkills],
          toolPlanDiscoveryEscalated: true,
          repairAttempts: 0,
        };

        return {
          state: nextState,
          command: this.collectToolCallPlanCommand(nextState),
          events: [
            this.eventFactory.toolCallsPlanned(
              entry.requestId,
              entry.step,
              entry.rootCommand.allowedTools,
              {
                status: "discovery_escalated",
                reason: entry.reason,
                issues: entry.issues,
              },
            ),
          ],
        };
      },
      tool_call_planning_blocked: (entry) => {
        const nextState: RunningAgentLoopMachineState = {
          ...state,
          rootCommand: entry.rootCommand,
          systemPromptPreamble: appendSystemPromptPreamble(
            state.systemPromptPreamble,
            entry.systemPromptPreamble,
          ),
          repairAttempts: 0,
        };

        return {
          state: nextState,
          command: this.renderPromptCommand(nextState),
          events: [
            this.eventFactory.toolCallsPlanned(
              entry.requestId,
              entry.step,
              [],
              {
                status: "blocked",
                reason: entry.reason,
                issues: entry.issues,
              },
            ),
          ],
        };
      },
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
            conversationEntries: state.conversationEntries,
            turnUnderstanding: state.turnUnderstanding,
            stepTraces: [
              ...state.stepTraces,
              buildAnswerTrace(entry.step, state.stepTraces.length, "final_answer"),
            ],
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
          stepTraces: [
            ...state.stepTraces,
            buildDecisionTrace(entry.step, state.stepTraces.length, entry.decision),
          ],
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
          conversationEntries: state.conversationEntries,
          loadedToolNames: state.loadedToolNames,
          plannerLedger: state.plannerLedger,
          turnUnderstanding: state.turnUnderstanding,
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
          entry.conversationEntries,
          entry.responseText,
          entry.loadedToolNames,
          entry.plannerLedger,
          buildToolTraces(entry.step, state.stepTraces.length, entry.execution),
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
            conversationEntries: state.conversationEntries,
            turnUnderstanding: state.turnUnderstanding,
            stepTraces: [
              ...state.stepTraces,
              buildAnswerTrace(
                entry.step,
                state.stepTraces.length,
                entry.projected.result.kind === "AskUser" ? "ask_user" : "final_answer",
              ),
            ],
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
          stepTraces: [
            ...state.stepTraces,
            buildRetryTrace(
              entry.step,
              state.stepTraces.length,
              entry.instruction.code,
              entry.instruction.message,
            ),
          ],
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
    conversationEntries: AgentConversationEntry[],
    responseText: string,
    loadedToolNames: "all" | string[],
    plannerLedger: AgentActionPlannerLedger,
    toolTraces: StepTrace[],
    events: AgentDomainEvent[],
  ): AgentLoopTransition {
    const nextState: RunningAgentLoopMachineState = {
      ...state,
      step: state.step + 1,
      repairAttempts: 0,
      messages,
      conversationEntries: [
        ...state.conversationEntries,
        ...conversationEntries,
      ],
      loadedToolNames: this.config.dynamicTools ? loadedToolNames : state.loadedToolNames,
      plannerLedger,
      lastDecisionXml: responseText,
      rootCommand: undefined,
      turnUnderstanding: state.turnUnderstanding,
      activeSkills: [],
      stepTraces: [...state.stepTraces, ...toolTraces],
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
          command: this.routeInteractionCommand(nextState),
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
      input: state.input,
      loadedToolNames: state.loadedToolNames,
      rootCommand: state.rootCommand,
      systemPromptPreamble: state.systemPromptPreamble,
      activeSkills: state.activeSkills,
    };
  }

  private nextDecisionCommand(state: RunningAgentLoopMachineState): AgentLoopCommand {
    return state.rootCommand?.outputMode === "tool_call_xml"
      ? this.collectToolCallPlanCommand(state)
      : this.renderPromptCommand(state);
  }

  private collectToolCallPlanCommand(state: RunningAgentLoopMachineState): AgentLoopCommand {
    if (!state.rootCommand) {
      throw new Error("ToolCall Planner 需要 RootCommand。");
    }

    return {
      kind: "collect_tool_call_plan",
      requestId: state.requestId,
      step: state.step,
      input: state.input,
      messages: state.messages,
      conversationEntries: state.conversationEntries,
      rootCommand: state.rootCommand,
      loadedToolNames: state.loadedToolNames,
      plannerLedger: state.plannerLedger,
      activeSkills: state.activeSkills,
      toolPlanDiscoveryEscalated: state.toolPlanDiscoveryEscalated,
      turnUnderstanding: state.turnUnderstanding,
    };
  }

  private planActionCommand(state: RunningAgentLoopMachineState): AgentLoopCommand {
    return {
      kind: "plan_action",
      requestId: state.requestId,
      step: state.step,
      input: state.input,
      messages: state.messages,
      conversationEntries: state.conversationEntries,
      loadedToolNames: state.loadedToolNames,
      plannerLedger: state.plannerLedger,
      turnUnderstanding: state.turnUnderstanding,
    };
  }

  private routeInteractionCommand(state: RunningAgentLoopMachineState): AgentLoopCommand {
    return {
      kind: "route_interaction",
      requestId: state.requestId,
      step: state.step,
      input: state.input,
      messages: state.messages,
      conversationEntries: state.conversationEntries,
      loadedToolNames: state.loadedToolNames,
      plannerLedger: state.plannerLedger,
      turnUnderstanding: state.turnUnderstanding,
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

function appendSystemPromptPreamble(
  current: string | undefined,
  addition: string | undefined,
): string | undefined {
  if (!current?.trim()) {
    return addition;
  }
  if (!addition?.trim()) {
    return current;
  }

  return `${current}\n\n${addition}`;
}
