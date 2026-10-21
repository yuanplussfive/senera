import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import { resolveAgentToolOwner } from "../Types/AgentToolOwner.js";
import type { AgentToolSafetyMetadata } from "./AgentSafetyTypes.js";

export function projectAgentToolSafetyMetadata(tool: RegisteredTool): AgentToolSafetyMetadata {
  const owner = resolveAgentToolOwner(tool);
  return {
    extensionName: owner.name,
    extensionTitle: owner.title,
    ownerKind: owner.kind,
    approval: tool.approval,
    permissions: [...tool.permissions],
    capabilityRisks: (tool.search?.Capabilities ?? []).flatMap((capability) =>
      capability.Risk ? [capability.Risk] : [],
    ),
    capabilityEffects: (tool.search?.Capabilities ?? []).flatMap((capability) => capability.Facets?.Effects ?? []),
    security: {
      TrustLevel: owner.trusted ? "System" : "External",
      RequiresApproval: owner.requiresApproval,
    },
    executionTargets: [...tool.execution.Targets],
  };
}
