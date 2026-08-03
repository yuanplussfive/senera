import { resolveActionPlannerConfig } from "../AgentDefaults.js";
import { AgentActionPlannerModelClient } from "../ActionPlanner/AgentActionPlannerModelClient.js";
import { AgentPiAssistantCompiler } from "../PiProxy/AgentPiAssistantCompiler.js";
import type { AgentPiProxyModelFactory } from "../PiProxy/AgentPiProxyModelFactory.js";

export function createAgentPiProxyModelAdapter(): AgentPiProxyModelFactory {
  return {
    createCompiler: (config, modelProvider, usageSink, timingSink) => {
      const plannerConfig = resolveActionPlannerConfig(config, modelProvider.Id);
      return new AgentPiAssistantCompiler({
        modelProvider,
        client: new AgentActionPlannerModelClient(modelProvider, plannerConfig.PlanningClient, {
          maxRepairAttempts: plannerConfig.MaxRepairAttempts,
          usageSink,
          timingSink,
        }),
      });
    },
  };
}
