import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";

export interface AgentModelCompatibility {
  supportsDeveloperRole: boolean;
  supportsStreamingUsage: boolean;
}

export function resolveAgentModelCompatibility(
  provider: Pick<ResolvedAgentModelProviderConfig, "Capabilities">,
): AgentModelCompatibility {
  return {
    supportsDeveloperRole: provider.Capabilities?.DeveloperRole === true,
    supportsStreamingUsage: provider.Capabilities?.StreamingUsage !== false,
  };
}
