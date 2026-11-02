import type { AgentSessionHistoryPresentationResolver } from "../Session/AgentSessionHistoryReplay.js";
import type { AgentSystemSettingsSnapshot } from "../McpPackages/AgentMcpManagementCatalog.js";
import type { AgentToolPresentation } from "../Types/AgentToolPresentationTypes.js";

/**
 * Builds a single, immutable presentation lookup for one history replay. The
 * persisted capability and Tool name together identify the registered system
 * Tool; ambiguous or unavailable registrations intentionally do not alter a
 * historical trace.
 */
export function createAgentSystemToolHistoryPresentationResolver(
  snapshot: AgentSystemSettingsSnapshot,
): AgentSessionHistoryPresentationResolver {
  const presentations = new Map<string, Map<string, readonly AgentToolPresentation[]>>();
  for (const extension of snapshot.extensions) {
    if (!extension.enabled) continue;
    for (const tool of extension.tools) {
      const byCapability = presentations.get(tool.name) ?? new Map<string, readonly AgentToolPresentation[]>();
      const matches = byCapability.get(tool.capability) ?? [];
      byCapability.set(tool.capability, [...matches, tool.presentation]);
      presentations.set(tool.name, byCapability);
    }
  }

  return (trace) => {
    const origin = trace.toolOrigin;
    if (origin?.kind !== "system" || !trace.toolName || !origin.capability) return undefined;
    const matches = presentations.get(trace.toolName)?.get(origin.capability);
    return matches?.length === 1 ? matches[0] : undefined;
  };
}
