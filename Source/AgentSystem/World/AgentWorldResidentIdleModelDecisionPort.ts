import { ResidentIdleDecisionKind as BamlResidentIdleDecisionKind } from "../BamlClient/baml_client/types.js";
import type { AgentActionPlannerModelClient } from "../ActionPlanner/AgentActionPlannerModelClient.js";
import {
  AgentWorldResidentIdleDecisionKinds,
  type AgentWorldResidentIdleDecision,
  type AgentWorldResidentIdleDecisionInput,
  type AgentWorldResidentIdleDecisionPort,
} from "./AgentWorldResidentIdleRuntime.js";

const DecisionKindMap: Readonly<Record<BamlResidentIdleDecisionKind, AgentWorldResidentIdleDecision["kind"]>> = {
  [BamlResidentIdleDecisionKind.Wait]: AgentWorldResidentIdleDecisionKinds.Wait,
  [BamlResidentIdleDecisionKind.Reflect]: AgentWorldResidentIdleDecisionKinds.Reflect,
  [BamlResidentIdleDecisionKind.CreateGoal]: AgentWorldResidentIdleDecisionKinds.CreateGoal,
  [BamlResidentIdleDecisionKind.Notify]: AgentWorldResidentIdleDecisionKinds.Notify,
};

/** Adapts the structured Action Planner transport to the Resident idle port. */
export class AgentWorldResidentIdleModelDecisionPort implements AgentWorldResidentIdleDecisionPort {
  constructor(
    private readonly options: {
      readonly client: AgentActionPlannerModelClient;
      readonly invocation?: import("../ModelEndpoints/AgentLanguageModel.js").AgentLanguageModelInvocationOptions;
    },
  ) {}

  async decide(input: AgentWorldResidentIdleDecisionInput): Promise<AgentWorldResidentIdleDecision> {
    const decision = await this.options.client.decideResidentIdle(input, this.options.invocation);
    const kind = DecisionKindMap[decision.kind];
    if (!kind) throw new Error(`Unsupported Resident idle model decision: ${String(decision.kind)}.`);
    return {
      kind,
      reason: decision.reason,
      ...(decision.goal
        ? {
            goal: {
              summary: decision.goal.summary,
              ...(decision.goal.detail !== undefined && decision.goal.detail !== null
                ? { detail: decision.goal.detail }
                : {}),
              ...(decision.goal.priority !== undefined && decision.goal.priority !== null
                ? { priority: decision.goal.priority }
                : {}),
              ...(decision.goal.successCriteria !== undefined && decision.goal.successCriteria !== null
                ? { successCriteria: decision.goal.successCriteria }
                : {}),
            },
          }
        : {}),
      ...(decision.message !== undefined && decision.message !== null ? { message: decision.message } : {}),
    };
  }
}
