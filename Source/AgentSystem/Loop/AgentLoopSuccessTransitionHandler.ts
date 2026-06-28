import { AgentEventKinds, type AgentDomainEvent } from "../Events/AgentEvent.js";
import { matchByKind } from "../Core/AgentMatch.js";
import {
  buildAnswerTrace,
  buildDecisionTrace,
  buildRetryTrace,
  buildToolTraces,
  type StepTrace,
} from "../Runtime/AgentStepTrace.js";
import { AgentInteractionRunModes } from "../ActionPlanner/AgentInteractionRouter.js";
import {
  appendSystemPromptPreamble,
  collectToolCallPlanCommand,
  nextDecisionCommand,
  planActionCommand,
  renderPromptCommand,
  stripRepairConversation,
} from "./AgentLoopCommandBuilder.js";
import type { AgentLoopEventFactory } from "./AgentLoopEventFactory.js";
import type {
  AgentLoopCommandSucceeded,
  AgentLoopTransition,
  RunningAgentLoopMachineState,
} from "./AgentLoopStateTypes.js";

export class AgentLoopSuccessTransitionHandler {
  constructor(
    private readonly eventFactory: AgentLoopEventFactory,
    private readonly advanceAfterToolResults: (
      state: RunningAgentLoopMachineState,
      entry: Extract<AgentLoopCommandSucceeded, { kind: "tool_results_generated" }>,
      toolTraces: StepTrace[],
      events: AgentDomainEvent[],
    ) => AgentLoopTransition,
  ) {}

  handle(
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

        return entry.route.mode === AgentInteractionRunModes.DeliberateTaskLoop
          ? {
              state: nextState,
              command: planActionCommand(nextState),
              events: routeEvents,
            }
          : {
              state: nextState,
              command: nextDecisionCommand(nextState),
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

        return {
          state: nextState,
          command: nextDecisionCommand(nextState),
          events: this.eventFactory.actionPlanned(
            entry.requestId,
            entry.step,
            entry.plan,
            entry.loadedToolNames,
            entry.rootCommand,
            entry.activeSkills,
          ),
        };
      },
      prompt_rendered: (entry) => ({
        state,
        command: state.rootCommand?.outputMode === "tool_call_xml"
          ? collectToolCallPlanCommand(state)
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
          command: collectToolCallPlanCommand(nextState),
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
          command: renderPromptCommand(nextState),
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
            ? stripRepairConversation(state.messages)
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
      tool_results_generated: (entry) => this.advanceAfterToolResults(
        state,
        entry,
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
          command: renderPromptCommand(nextState),
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

}
