import { listAgentSelfCommandSpecs } from "./AgentSelfCommandRegistry.js";

export interface AgentSelfHarnessDisclosure {
  readonly protocol: "senera.harness/v1";
  readonly tool: "SeneraCommand";
  readonly domains: readonly string[];
  readonly discovery: "capabilities";
  readonly workflow: "read -> smallest command -> verify";
}

/**
 * Small, runtime-derived disclosure for prompt context. The command registry
 * remains the source of truth; this projection only tells the model where to
 * look next and never duplicates argument contracts.
 */
export function projectAgentSelfHarnessDisclosure(): AgentSelfHarnessDisclosure {
  const domains = new Set(listAgentSelfCommandSpecs().map((spec) => spec.command));
  return {
    protocol: "senera.harness/v1",
    tool: "SeneraCommand",
    domains: [...domains].sort(),
    discovery: "capabilities",
    workflow: "read -> smallest command -> verify",
  };
}
