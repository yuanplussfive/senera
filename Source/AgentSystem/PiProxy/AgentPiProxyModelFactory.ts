import type { AgentSystemConfig, ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type { AgentModelTimingSink } from "../ModelEndpoints/AgentModelTiming.js";
import type { AgentModelUsageSink } from "../ModelEndpoints/AgentModelUsage.js";
import type { AgentPiAssistantCompilerPort } from "./AgentPiAssistantCompiler.js";
import type { AgentPiFinalAnswerGeneratorPort } from "./AgentPiFinalAnswerGenerator.js";

export interface AgentPiProxyModelFactory {
  createCompiler(
    config: AgentSystemConfig,
    modelProvider: ResolvedAgentModelProviderConfig,
    usageSink?: AgentModelUsageSink,
    timingSink?: AgentModelTimingSink,
  ): AgentPiAssistantCompilerPort;
  createFinalAnswerGenerator(
    config: AgentSystemConfig,
    modelProvider: ResolvedAgentModelProviderConfig,
    usageSink?: AgentModelUsageSink,
    timingSink?: AgentModelTimingSink,
  ): AgentPiFinalAnswerGeneratorPort;
}
