import { resolveActionPlannerConfig } from "../AgentDefaults.js";
import { AgentActionPlannerModelClient } from "../ActionPlanner/AgentActionPlannerModelClient.js";
import { AgentPiPlanningCompiler, type AgentPiPlanningCompilerFactory } from "../Pi/AgentPiPlanningCompiler.js";
import type { AgentSystemConfig, ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";

export function createAgentPiPlanningModelAdapter(
  config: AgentSystemConfig,
  modelProvider: ResolvedAgentModelProviderConfig,
): AgentPiPlanningCompilerFactory {
  return {
    create: (sinks = {}) => {
      const plannerConfig = resolveActionPlannerConfig(config, modelProvider.Id);
      return new AgentPiPlanningCompiler({
        modelProvider,
        client: new AgentActionPlannerModelClient(modelProvider, plannerConfig.PlanningClient, {
          maxRepairAttempts: plannerConfig.MaxRepairAttempts,
          usageSink: sinks.usageSink,
          timingSink: sinks.timingSink,
        }),
      });
    },
  };
}
