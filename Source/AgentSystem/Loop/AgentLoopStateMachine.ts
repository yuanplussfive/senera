import { AgentLoopEventFactory } from "./AgentLoopEventFactory.js";
import {
  createInitialAgentLoopState,
  type AgentLoopStartRequest,
} from "./AgentLoopInitialState.js";
import { routeInteractionCommand } from "./AgentLoopCommandBuilder.js";
import { AgentLoopTransitionReducer } from "./AgentLoopTransitionReducer.js";
import type {
  AgentLoopCommandResult,
  AgentLoopMachineConfig,
  AgentLoopTransition,
  RunningAgentLoopMachineState,
} from "./AgentLoopStateTypes.js";

export type { AgentLoopStartRequest } from "./AgentLoopInitialState.js";

export class AgentLoopStateMachine {
  private readonly reducer: AgentLoopTransitionReducer;

  constructor(
    config: AgentLoopMachineConfig,
    private readonly eventFactory = new AgentLoopEventFactory(),
  ) {
    this.reducer = new AgentLoopTransitionReducer(config, eventFactory);
  }

  start(request: AgentLoopStartRequest): AgentLoopTransition {
    const state = createInitialAgentLoopState(request);

    return {
      state,
      command: routeInteractionCommand(state),
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
    return this.reducer.consume(state, result);
  }
}

