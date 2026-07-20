import { AgentLoopEventFactory } from "./AgentLoopEventFactory.js";
import { createInitialAgentLoopState, type AgentLoopStartRequest } from "./AgentLoopInitialState.js";
import { prepareInteractionCommand } from "./AgentLoopCommandBuilder.js";
import { renderPromptCommand } from "./AgentLoopCommandBuilder.js";
import { AgentLoopTransitionReducer } from "./AgentLoopTransitionReducer.js";
import type {
  AgentLoopCommandResult,
  AgentLoopTransition,
  RunningAgentLoopMachineState,
} from "./AgentLoopStateTypes.js";

export type { AgentLoopStartRequest } from "./AgentLoopInitialState.js";

export class AgentLoopStateMachine {
  private readonly reducer: AgentLoopTransitionReducer;

  constructor(private readonly eventFactory = new AgentLoopEventFactory()) {
    this.reducer = new AgentLoopTransitionReducer(eventFactory);
  }

  start(request: AgentLoopStartRequest): AgentLoopTransition {
    const state = createInitialAgentLoopState(request);
    const runStarted =
      request.emitRunStarted === false ? [] : [this.eventFactory.runStarted(request.requestId, request.input)];

    if (request.preparation) {
      return {
        state,
        command: renderPromptCommand(state),
        events: [
          ...runStarted,
          ...this.eventFactory.interactionRouted(
            request.requestId,
            state.step,
            request.preparation.route,
            request.preparation.loadedToolNames,
            request.preparation.rootCommand,
          ),
        ],
      };
    }

    return {
      state,
      command: prepareInteractionCommand(state),
      events: runStarted,
    };
  }

  consume(state: RunningAgentLoopMachineState, result: AgentLoopCommandResult): AgentLoopTransition {
    return this.reducer.consume(state, result);
  }
}
