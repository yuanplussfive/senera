import { applyPatchHostTool } from "./Patch/AgentPatchApplyRuntime.js";
import { readArtifactMemoryHostTool } from "./Memory/AgentArtifactMemoryRuntime.js";
import { delegateAgentHostTool } from "./AgentDelegateRuntime.js";
import { documentHostTool } from "./AgentDocumentRuntime.js";
import { imageVisionHostTool } from "./AgentImageVisionRuntime.js";
import { recallMemoryHostTool } from "./Memory/AgentMemoryRecallRuntime.js";
import { writeMemoryHostTool } from "./Memory/AgentMemoryWriteRuntime.js";
import { runShellCommandHostTool } from "./AgentShellCommandRuntime.js";
import { fastContextScoutHostTool } from "./AgentFastContextScoutRuntime.js";
import { AgentToolHostCapabilityRegistry } from "./ToolRuntime/AgentToolHostCapabilityRegistry.js";
import type { AgentToolSearchRuntime } from "./ToolSearch/AgentToolSearchRuntime.js";

export const AgentHostCapabilityNames = {
  PatchApply: "patch.apply",
  ShellRun: "shell.run",
  ToolSearch: "tool.search",
  ArtifactMemoryRead: "artifact.memory.read",
  Document: "document",
  ImageVision: "image.vision",
  MemoryRecall: "memory.recall",
  MemoryWrite: "memory.write",
  AgentDelegate: "agent.delegate",
  FastContextScout: "workspace.context.scout",
} as const;

export function createDefaultHostCapabilityRegistry(options: {
  toolSearch?: AgentToolSearchRuntime;
} = {}): AgentToolHostCapabilityRegistry {
  const registry = new AgentToolHostCapabilityRegistry()
    .register(AgentHostCapabilityNames.PatchApply, applyPatchHostTool)
    .register(AgentHostCapabilityNames.ShellRun, runShellCommandHostTool)
    .register(AgentHostCapabilityNames.ArtifactMemoryRead, readArtifactMemoryHostTool)
    .register(AgentHostCapabilityNames.Document, documentHostTool)
    .register(AgentHostCapabilityNames.ImageVision, imageVisionHostTool)
    .register(AgentHostCapabilityNames.MemoryRecall, recallMemoryHostTool)
    .register(AgentHostCapabilityNames.MemoryWrite, writeMemoryHostTool)
    .register(AgentHostCapabilityNames.AgentDelegate, delegateAgentHostTool)
    .register(AgentHostCapabilityNames.FastContextScout, fastContextScoutHostTool);

  return options.toolSearch
    ? registry.register(AgentHostCapabilityNames.ToolSearch, options.toolSearch.createHostHandler())
    : registry;
}
