import type { AgentExtensionOwner } from "./AgentExtensionRuntimeTypes.js";
import type { RegisteredTool } from "./AgentToolRuntimeTypes.js";

export function resolveAgentToolOwner(tool: RegisteredTool): AgentExtensionOwner {
  return tool.owner;
}
