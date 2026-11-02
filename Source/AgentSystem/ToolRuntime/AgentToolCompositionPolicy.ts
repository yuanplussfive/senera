import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import { resolveAgentToolRuntimeCapabilities } from "./AgentToolRuntimeCapabilities.js";

export function isAgentToolComposable(tool: RegisteredTool): boolean {
  if (tool.runtime.Composition !== undefined) return tool.runtime.Composition === "callable";
  const runtime = resolveAgentToolRuntimeCapabilities(tool);
  return !runtime.interactiveInput;
}
