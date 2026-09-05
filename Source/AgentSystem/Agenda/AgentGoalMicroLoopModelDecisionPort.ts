import { GoalMicroLoopDecisionKind as BamlGoalMicroLoopDecisionKind } from "../BamlClient/baml_client/types.js";
import type { AgentActionPlannerModelClient } from "../ActionPlanner/AgentActionPlannerModelClient.js";
import type { AgentLanguageModelInvocationOptions } from "../ModelEndpoints/AgentLanguageModel.js";
import {
  AgentGoalMicroLoopDecisionKinds,
  type AgentGoalMicroLoopDecision,
  type AgentGoalMicroLoopDecisionInput,
  type AgentGoalMicroLoopDecisionPort,
} from "./AgentGoalMicroLoopRuntime.js";

const DecisionKindMap: Readonly<Record<BamlGoalMicroLoopDecisionKind, AgentGoalMicroLoopDecision["kind"]>> = {
  [BamlGoalMicroLoopDecisionKind.Wait]: AgentGoalMicroLoopDecisionKinds.Wait,
  [BamlGoalMicroLoopDecisionKind.Propose]: AgentGoalMicroLoopDecisionKinds.Propose,
  [BamlGoalMicroLoopDecisionKind.AskUser]: AgentGoalMicroLoopDecisionKinds.AskUser,
  [BamlGoalMicroLoopDecisionKind.Execute]: AgentGoalMicroLoopDecisionKinds.Execute,
  [BamlGoalMicroLoopDecisionKind.Replan]: AgentGoalMicroLoopDecisionKinds.Replan,
  [BamlGoalMicroLoopDecisionKind.Complete]: AgentGoalMicroLoopDecisionKinds.Complete,
  [BamlGoalMicroLoopDecisionKind.Block]: AgentGoalMicroLoopDecisionKinds.Block,
};

/** Adapts the structured Action Planner transport to the Goal micro-loop port. */
export class AgentGoalMicroLoopModelDecisionPort implements AgentGoalMicroLoopDecisionPort {
  constructor(
    private readonly options: {
      readonly client: AgentActionPlannerModelClient;
      readonly invocation?: AgentLanguageModelInvocationOptions;
    },
  ) {}

  async decide(input: AgentGoalMicroLoopDecisionInput): Promise<readonly AgentGoalMicroLoopDecision[]> {
    const decisions = await this.options.client.decideGoalMicroLoop(input, this.options.invocation);
    return decisions.map((decision) => {
      const kind = DecisionKindMap[decision.kind];
      if (!kind) throw new Error(`Unsupported Goal micro-loop model decision: ${String(decision.kind)}.`);
      return {
        goalId: decision.goalId,
        triggerKey: decision.triggerKey,
        kind,
        reason: decision.reason,
        ...(decision.nextReviewAt !== undefined && decision.nextReviewAt !== null
          ? { nextReviewAt: decision.nextReviewAt }
          : {}),
        ...(decision.progress !== undefined && decision.progress !== null ? { progress: decision.progress } : {}),
        ...(decision.blockedReason !== undefined && decision.blockedReason !== null
          ? { blockedReason: decision.blockedReason }
          : {}),
      };
    });
  }
}
