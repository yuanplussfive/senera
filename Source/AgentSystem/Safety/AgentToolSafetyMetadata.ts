import type { RegisteredTool } from "../Types/PluginRuntimeTypes.js";
import type { AgentToolSafetyMetadata } from "./AgentSafetyTypes.js";

export function projectAgentToolSafetyMetadata(tool: RegisteredTool): AgentToolSafetyMetadata {
  return {
    pluginName: tool.plugin.manifest.Plugin.Name,
    pluginTitle: tool.plugin.manifest.Plugin.Title,
    rootKind: tool.plugin.rootKind,
    approval: tool.approval,
    permissions: [...tool.permissions],
    capabilityRisks: (tool.search?.Capabilities ?? []).flatMap((capability) =>
      capability.Risk ? [capability.Risk] : [],
    ),
    capabilityEffects: (tool.search?.Capabilities ?? []).flatMap((capability) => capability.Facets?.Effects ?? []),
    security: tool.plugin.manifest.Security,
    executionTargets: [...tool.execution.Targets],
  };
}
