import type { AgentDomainEvent } from "../Events/AgentEvent.js";
import { matchByKind } from "../Core/AgentMatch.js";
import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { AgentLanguageModelMessage } from "../ModelEndpoints/AgentLanguageModel.js";
import type { AgentRetryableError } from "../Retry/AgentRetryableError.js";
import type { StepTrace } from "../Runtime/AgentStepTrace.js";
import type { AgentActionPlannerLedger } from "../ActionPlanner/AgentActionPlannerContext.js";
import {
  routeInteractionCommand,
} from "./AgentLoopCommandBuilder.js";
import { AgentLoopEventFactory } from "./AgentLoopEventFactory.js";
import { AgentLoopSuccessTransitionHandler } from "./AgentLoopSuccessTransitionHandler.js";
import type {
  AgentLoopCommandResult,
  AgentLoopCommandSucceeded,
  AgentLoopMachineConfig,
  AgentLoopTransition,
  RunningAgentLoopMachineState,
} from "./AgentLoopStateTypes.js";

export class AgentLoopTransitionReducer {
  private readonly successHandler: AgentLoopSuccessTransitionHandler;

  constructor(
    private readonly config: AgentLoopMachineConfig,
    private readonly eventFactory = new AgentLoopEventFactory(),
  ) {
    this.successHandler = new AgentLoopSuccessTransitionHandler(
      this.eventFactory,
      (currentState, entry, toolTraces, events) => this.advanceAfterToolResults(
        currentState,
        entry.messages,
        entry.conversationEntries,
        entry.responseText,
        entry.loadedToolNames,
        entry.plannerLedger,
        toolTraces,
        events,
      ),
    );
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
    return this.successHandler.handle(state, output);
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
          command: routeInteractionCommand(nextState),
          events,
        };
  }

  private failed(
    requestId: string,
    step: number,
    error: AgentRetryableError | Error,
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
