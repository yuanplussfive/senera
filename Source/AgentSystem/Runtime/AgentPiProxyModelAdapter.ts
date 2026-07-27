import { resolveActionPlannerConfig } from "../AgentDefaults.js";
import { AgentActionPlannerBamlPromptFactory } from "../ActionPlanner/AgentActionPlannerBamlPromptFactory.js";
import { AgentActionPlannerModelClient } from "../ActionPlanner/AgentActionPlannerModelClient.js";
import { AgentActionPlannerModelTransport } from "../ActionPlanner/AgentActionPlannerModelTransport.js";
import { resolvePlannerProvider } from "../ActionPlanner/AgentActionPlannerProviderResolver.js";
import { AgentPiAssistantCompiler } from "../PiProxy/AgentPiAssistantCompiler.js";
import { AgentPiFinalAnswerGenerator } from "../PiProxy/AgentPiFinalAnswerGenerator.js";
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
    createFinalAnswerGenerator: (config, modelProvider, usageSink, timingSink) => {
      const plannerConfig = resolveActionPlannerConfig(config, modelProvider.Id);
      const prompts = new AgentActionPlannerBamlPromptFactory();
      return new AgentPiFinalAnswerGenerator({
        promptBuilder: {
          build: (input) =>
            prompts.buildPrompt({
              functionName: "GeneratePiFinalAnswer",
              input,
            }),
        },
        transport: new AgentActionPlannerModelTransport(
          resolvePlannerProvider(modelProvider, plannerConfig.FinalAnswerClient),
          usageSink,
          timingSink,
        ),
      });
    },
  };
}
