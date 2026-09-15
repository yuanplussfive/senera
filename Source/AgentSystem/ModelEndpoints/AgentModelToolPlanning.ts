import type { AgentModelProviderConfig } from "../Types/AgentModelConfigTypes.js";
import { AgentNativeToolApiByEndpoint, type AgentModelToolPlanningMode } from "./AgentModelEndpointContract.js";

export const DefaultAgentModelToolPlanningMode: AgentModelToolPlanningMode = "native";

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
