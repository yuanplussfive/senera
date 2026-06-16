import { applyPatchHostTool } from "./AgentPatchApplyRuntime.js";
import { readArtifactMemoryHostTool } from "./AgentArtifactMemoryRuntime.js";
import { documentHostTool } from "./AgentDocumentRuntime.js";
import { imageVisionHostTool } from "./AgentImageVisionRuntime.js";
import { runShellCommandHostTool } from "./AgentShellCommandRuntime.js";
import { AgentToolHostCapabilityRegistry } from "./AgentToolHostCapabilityRegistry.js";
import type { AgentToolSearchRuntime } from "./AgentToolSearchRuntime.js";

export const AgentHostCapabilityNames = {
  PatchApply: "patch.apply",
  ShellRun: "shell.run",
  ToolSearch: "tool.search",
  ArtifactMemoryRead: "artifact.memory.read",
  Document: "document",
  ImageVision: "image.vision",
} as const;

export function createDefaultHostCapabilityRegistry(options: {
  toolSearch?: AgentToolSearchRuntime;
} = {}): AgentToolHostCapabilityRegistry {
  const registry = new AgentToolHostCapabilityRegistry()
    .register(AgentHostCapabilityNames.PatchApply, applyPatchHostTool)
    .register(AgentHostCapabilityNames.ShellRun, runShellCommandHostTool)
    .register(AgentHostCapabilityNames.ArtifactMemoryRead, readArtifactMemoryHostTool)
    .register(AgentHostCapabilityNames.Document, documentHostTool)
    .register(AgentHostCapabilityNames.ImageVision, imageVisionHostTool);

  return options.toolSearch
    ? registry.register(AgentHostCapabilityNames.ToolSearch, options.toolSearch.createHostHandler())
    : registry;
}
