import { readArtifactMemoryHostTool } from "./Memory/AgentArtifactMemoryRuntime.js";
import { documentHostTool } from "./Documents/AgentDocumentRuntime.js";
import { imageVisionHostTool } from "./Vision/AgentImageVisionRuntime.js";
import { recallMemoryHostTool } from "./Memory/AgentMemoryRecallRuntime.js";
import { writeMemoryHostTool } from "./Memory/AgentMemoryWriteRuntime.js";
import { runShellCommandHostTool } from "./ToolRuntime/AgentShellCommandRuntime.js";
import { applyWorkspacePatchHostTool } from "./ToolRuntime/AgentWorkspaceApplyPatchRuntime.js";
import { AgentToolHostCapabilityRegistry } from "./ToolRuntime/AgentToolHostCapabilityRegistry.js";
import type { AgentToolSearchRuntime } from "./ToolSearch/AgentToolSearchRuntime.js";

export const AgentHostCapabilityNames = {
  ShellRun: "shell.run",
  ToolSearch: "tool.search",
  ArtifactMemoryRead: "artifact.memory.read",
  Document: "document",
  ImageVision: "image.vision",
  MemoryRecall: "memory.recall",
  MemoryWrite: "memory.write",
  WorkspaceApplyPatch: "workspace.apply_patch",
} as const;

export function createDefaultHostCapabilityRegistry(
  options: {
    toolSearch?: AgentToolSearchRuntime;
  } = {},
): AgentToolHostCapabilityRegistry {
  const registry = new AgentToolHostCapabilityRegistry()
    .register(AgentHostCapabilityNames.ShellRun, runShellCommandHostTool)
    .register(AgentHostCapabilityNames.ArtifactMemoryRead, readArtifactMemoryHostTool)
    .register(AgentHostCapabilityNames.Document, documentHostTool)
    .register(AgentHostCapabilityNames.ImageVision, imageVisionHostTool)
    .register(AgentHostCapabilityNames.MemoryRecall, recallMemoryHostTool)
    .register(AgentHostCapabilityNames.MemoryWrite, writeMemoryHostTool)
    .register(AgentHostCapabilityNames.WorkspaceApplyPatch, applyWorkspacePatchHostTool);

  return options.toolSearch
    ? registry.register(AgentHostCapabilityNames.ToolSearch, options.toolSearch.createHostHandler())
    : registry;
}
