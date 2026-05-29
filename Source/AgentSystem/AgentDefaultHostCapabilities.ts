import { applyPatchHostTool } from "./AgentPatchApplyRuntime.js";
import { runShellCommandHostTool } from "./AgentShellCommandRuntime.js";
import { AgentToolHostCapabilityRegistry } from "./AgentToolHostCapabilityRegistry.js";

export const AgentHostCapabilityNames = {
  PatchApply: "patch.apply",
  ShellRun: "shell.run",
} as const;

export function createDefaultHostCapabilityRegistry(): AgentToolHostCapabilityRegistry {
  return new AgentToolHostCapabilityRegistry()
    .register(AgentHostCapabilityNames.PatchApply, applyPatchHostTool)
    .register(AgentHostCapabilityNames.ShellRun, runShellCommandHostTool);
}
