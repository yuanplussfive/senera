import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import { readAgentModelRequirementIssues, type AgentModelRequirements } from "../Core/AgentModelCapabilityContract.js";
import type { ResolvedAgentModelProviderConfig } from "../Types/AgentConfigTypes.js";

/** Match the effective declaration supplied by the runtime; never infer missing capabilities. */
export function readAgentModelInvocationCapabilities(
  provider: Pick<ResolvedAgentModelProviderConfig, "Capabilities" | "Stream">,
) {
  return {
    ...provider.Capabilities,
    Stream: provider.Stream,
  };
}

export function assertAgentModelRequirements(
  provider: Pick<ResolvedAgentModelProviderConfig, "Id" | "Capabilities" | "Stream">,
  requirements: AgentModelRequirements,
): void {
  const missing = readAgentModelRequirementIssues(readAgentModelInvocationCapabilities(provider), requirements);
  if (missing.length) {
    throw new AgentLocalizedError("model.requirementsNotMet", { modelId: provider.Id, missing: missing.join(", ") });
  }
}
