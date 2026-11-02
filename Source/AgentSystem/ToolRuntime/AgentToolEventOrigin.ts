import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import type { AgentToolPresentation } from "../Types/AgentToolPresentationTypes.js";

/** Safe runtime provenance for user-facing tool lifecycle events. */
export interface AgentToolEventOrigin {
  readonly kind: "system" | "mcp";
  readonly name: string;
  readonly capability?: string;
  readonly presentation?: AgentToolPresentation;
  readonly server?: string;
  readonly tool?: string;
}

export function projectAgentToolEventOrigin(tool: RegisteredTool): AgentToolEventOrigin {
  const name = tool.owner.title?.trim() || tool.owner.name;
  if (tool.handler.kind === "McpTool") {
    return {
      kind: "mcp",
      name,
      server: tool.owner.name,
      tool: tool.handler.tool,
    };
  }
  return {
    kind: "system",
    name,
    capability:
      (tool.search?.Capabilities ?? []).map((capability) => capability.Id).find(Boolean) ?? tool.handler.capability,
    presentation: tool.presentation,
  };
}
