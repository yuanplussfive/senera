import { applyPatchHostTool } from "./AgentPatchApplyRuntime.js";
import { runShellCommandHostTool } from "./AgentShellCommandRuntime.js";
import { AgentToolHostCapabilityRegistry } from "./AgentToolHostCapabilityRegistry.js";
import type { AgentToolSearchRuntime } from "./AgentToolSearchRuntime.js";

export const AgentHostCapabilityNames = {
  PatchApply: "patch.apply",
  ShellRun: "shell.run",
  ToolSearch: "tool.search",
} as const;

export function createDefaultHostCapabilityRegistry(options: {
  toolSearch?: AgentToolSearchRuntime;
} = {}): AgentToolHostCapabilityRegistry {
  const registry = new AgentToolHostCapabilityRegistry()
    .register(AgentHostCapabilityNames.PatchApply, applyPatchHostTool)
    .register(AgentHostCapabilityNames.ShellRun, runShellCommandHostTool);

  return options.toolSearch
    ? registry.register(AgentHostCapabilityNames.ToolSearch, options.toolSearch.createHostHandler())
    : registry;
}
