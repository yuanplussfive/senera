import type { AgentModelToolPlanningMode } from "../ModelEndpoints/AgentModelEndpointContract.js";

export interface AgentTurnPromptProfile {
  readonly mode: AgentModelToolPlanningMode;
  readonly templateName: string;
}

const PromptProfiles = {
  native: {
    mode: "native",
    templateName: "PiNativeSystemPrompt",
  },
  baml: {
    mode: "baml",
    templateName: "PiBamlSystemPrompt",
  },
} as const satisfies Record<AgentModelToolPlanningMode, AgentTurnPromptProfile>;

export function resolveAgentTurnPromptProfile(mode: AgentModelToolPlanningMode): AgentTurnPromptProfile {
  return PromptProfiles[mode];
}
