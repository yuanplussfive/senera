import { matchByKind } from "../Core/AgentMatch.js";
import { AgentLoopEventFactory } from "./AgentLoopEventFactory.js";
import { AgentLoopSuccessTransitionHandler } from "./AgentLoopSuccessTransitionHandler.js";
import type {
  AgentLoopCommandResult,
  AgentLoopCommandSucceeded,
  AgentLoopTransition,
  RunningAgentLoopMachineState,
} from "./AgentLoopStateTypes.js";

export class AgentLoopTransitionReducer {
  private readonly successHandler: AgentLoopSuccessTransitionHandler;

  constructor(
    eventFactory = new AgentLoopEventFactory(),
  ) {
    this.successHandler = new AgentLoopSuccessTransitionHandler(eventFactory);
  }

  consume(
    state: RunningAgentLoopMachineState,
    result: AgentLoopCommandResult,
  ): AgentLoopTransition {
    return matchByKind(result, {
      succeeded: ({ output }) => this.afterSuccess(state, output),
    });
  }

  private afterSuccess(
    state: RunningAgentLoopMachineState,
    output: AgentLoopCommandSucceeded,
  ): AgentLoopTransition {
    return this.successHandler.handle(state, output);
  }
}
