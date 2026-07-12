import { AgentEventKinds } from "../Events/AgentEvent.js";
import { createAssistantMessageId } from "../Core/AgentIds.js";
import { matchByKind } from "../Core/AgentMatch.js";
import { routeInteractionCommand, renderPromptCommand, runPiTurnCommand } from "./AgentLoopCommandBuilder.js";
import type { AgentLoopEventFactory } from "./AgentLoopEventFactory.js";
import type {
  AgentLoopCommandSucceeded,
  AgentLoopTransition,
  RunningAgentLoopMachineState,
} from "./AgentLoopStateTypes.js";

export class AgentLoopSuccessTransitionHandler {
  constructor(private readonly eventFactory: AgentLoopEventFactory) {}

  handle(state: RunningAgentLoopMachineState, output: AgentLoopCommandSucceeded): AgentLoopTransition {
    return matchByKind(output, {
      turn_understood: (entry) => {
        const nextState: RunningAgentLoopMachineState = {
          ...state,
          turnUnderstanding: entry.turnUnderstanding,
        };

        return {
          state: nextState,
          command: routeInteractionCommand(nextState),
          events: [],
        };
      },
      interaction_routed: (entry) => {
        const nextState: RunningAgentLoopMachineState = {
          ...state,
          loadedToolNames: entry.loadedToolNames,
          rootCommand: entry.rootCommand,
          turnUnderstanding: entry.turnUnderstanding,
          activeSkills: [...entry.activeSkills],
        };

        return {
          state: nextState,
          command: renderPromptCommand(nextState),
          events: this.eventFactory.interactionRouted(
            entry.requestId,
            entry.step,
            entry.route,
            entry.loadedToolNames,
            entry.rootCommand,
          ),
        };
      },
      prompt_rendered: (entry) => ({
        state,
        command: runPiTurnCommand(state, entry.prompt),
        events: this.eventFactory.promptRendered(entry.requestId, entry.step, entry.prompt, entry.promptTokenCount),
      }),
      pi_turn_completed: (entry) => this.completePiTurn(state, entry),
    });
  }

  private completePiTurn(
    state: RunningAgentLoopMachineState,
    entry: Extract<AgentLoopCommandSucceeded, { kind: "pi_turn_completed" }>,
  ): AgentLoopTransition {
    return {
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
          conversationEntries: [...state.conversationEntries, ...entry.conversationEntries],
          turnUnderstanding: state.turnUnderstanding,
          stepTraces: [...state.stepTraces, ...entry.stepTraces],
        },
      },
      events: this.eventFactory.terminal(
        {
          event: {
            kind: AgentEventKinds.AssistantMessageCreated,
            context: {
              requestId: entry.requestId,
            },
            data: {
              messageId: createAssistantMessageId(),
              kind: "final_answer",
              content: entry.responseText,
              terminal: true,
            },
          },
          result: {
            kind: "FinalAnswer",
            content: entry.responseText,
          },
        },
        entry.requestId,
      ),
    };
  }
}
