import type { AgentModelToolPlanningMode } from "../ModelEndpoints/AgentModelEndpointContract.js";

export interface AgentTurnPromptProfile {
  readonly mode: AgentModelToolPlanningMode;
  readonly frozenTemplateName: string;
  readonly stableTemplateName: string;
  readonly volatileTemplateName: string;
}

const PromptProfiles = {
  native: {
    mode: "native",
    frozenTemplateName: "SeneraFrozenSystemPrompt",
    stableTemplateName: "PiNativeStableSystemPrompt",
    volatileTemplateName: "PiTurnVolatileContext",
  },
  baml: {
    mode: "baml",
    frozenTemplateName: "SeneraFrozenSystemPrompt",
    stableTemplateName: "PiBamlStableSystemPrompt",
    volatileTemplateName: "PiTurnVolatileContext",
  },
} as const satisfies Record<AgentModelToolPlanningMode, AgentTurnPromptProfile>;

export function resolveAgentTurnPromptProfile(mode: AgentModelToolPlanningMode): AgentTurnPromptProfile {
  return PromptProfiles[mode];
}
