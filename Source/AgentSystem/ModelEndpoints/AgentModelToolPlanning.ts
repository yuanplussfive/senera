import type { AgentModelProviderConfig } from "../Types/AgentModelConfigTypes.js";
import { AgentNativeToolApiByEndpoint, type AgentModelToolPlanningMode } from "./AgentModelEndpointContract.js";
import { AgentModelInvocationDefaults } from "../Core/AgentModelCapabilityContract.js";

export const DefaultAgentModelToolPlanningMode: AgentModelToolPlanningMode =
  AgentModelInvocationDefaults.ToolPlanningMode;

export function resolveAgentModelToolPlanningMode(
  provider: Pick<AgentModelProviderConfig, "ToolPlanningMode">,
): AgentModelToolPlanningMode {
  return provider.ToolPlanningMode ?? DefaultAgentModelToolPlanningMode;
}

export function nativeToolApiForEndpoint(
  endpoint: keyof typeof AgentNativeToolApiByEndpoint,
): (typeof AgentNativeToolApiByEndpoint)[typeof endpoint] {
  return AgentNativeToolApiByEndpoint[endpoint];
}
