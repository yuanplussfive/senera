import { AgentLoopEventFactory } from "./AgentLoopEventFactory.js";
import { createInitialAgentLoopState, type AgentLoopStartRequest } from "./AgentLoopInitialState.js";
import { understandTurnCommand } from "./AgentLoopCommandBuilder.js";
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

    return {
      state,
      command: understandTurnCommand(state),
      events: request.emitRunStarted === false ? [] : [this.eventFactory.runStarted(request.requestId, request.input)],
    };
  }

  consume(state: RunningAgentLoopMachineState, result: AgentLoopCommandResult): AgentLoopTransition {
    return this.reducer.consume(state, result);
  }
}
