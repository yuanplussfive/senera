import type { AgentSystemConfig, ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";
import type { AgentModelTimingSink } from "../ModelEndpoints/AgentModelTiming.js";
import type { AgentModelUsageSink } from "../ModelEndpoints/AgentModelUsage.js";
import type { AgentPiAssistantCompilerPort } from "./AgentPiAssistantCompiler.js";

export interface AgentPiProxyModelFactory {
  createCompiler(
    config: AgentSystemConfig,
    modelProvider: ResolvedAgentModelProviderConfig,
    usageSink?: AgentModelUsageSink,
    timingSink?: AgentModelTimingSink,
  ): AgentPiAssistantCompilerPort;
}
