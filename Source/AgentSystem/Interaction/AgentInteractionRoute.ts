import type { InteractionRoute } from "../BamlClient/baml_client/types.js";

export const AgentInteractionRunModes = {
  DirectResponse: "direct_response",
  ToolAgentLoop: "tool_agent_loop",
} as const;

export type AgentInteractionRunMode = (typeof AgentInteractionRunModes)[keyof typeof AgentInteractionRunModes];

export interface AgentInteractionRouteResult {
  mode: AgentInteractionRunMode;
  objective: string;
  preferredTools: string[];
  discoveryQueries: string[];
  raw: InteractionRoute;
}
