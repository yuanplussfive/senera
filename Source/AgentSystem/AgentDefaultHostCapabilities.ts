import { readArtifactMemoryHostTool } from "./Memory/AgentArtifactMemoryRuntime.js";
import { recallMemoryHostTool } from "./Memory/AgentMemoryRecallRuntime.js";
import { writeMemoryHostTool } from "./Memory/AgentMemoryWriteRuntime.js";
import { runShellCommandHostTool } from "./ToolRuntime/AgentShellCommandRuntime.js";
import { applyWorkspacePatchHostTool } from "./ToolRuntime/AgentWorkspaceApplyPatchRuntime.js";
import { AgentToolHostCapabilityRegistry } from "./ToolRuntime/AgentToolHostCapabilityRegistry.js";
import type { AgentToolSearchRuntime } from "./ToolSearch/AgentToolSearchRuntime.js";
import type { AgentExecutionResourceBroker } from "./ExecutionResources/AgentExecutionResourceBroker.js";
import { createAgentExecutionResourceHostHandlers } from "./ToolRuntime/AgentExecutionResourceRuntime.js";
import { askUserHostTool } from "./Conversation/AgentAskUserRuntime.js";

export const AgentHostCapabilityNames = {
  ShellRun: "shell.run",
  ShellStart: "shell.start",
  ExecutionResourceInspect: "execution.resource.inspect",
  ExecutionResourceWait: "execution.resource.wait",
  ExecutionResourceWrite: "execution.resource.write",
  ExecutionResourceSignal: "execution.resource.signal",
  ExecutionResourceList: "execution.resource.list",
  ExecutionResourceResize: "execution.resource.resize",
  ExecutionResourceStopAll: "execution.resource.stop_all",
  ToolSearch: "tool.search",
  ArtifactMemoryRead: "artifact.memory.read",
  MemoryRecall: "memory.recall",
  MemoryWrite: "memory.write",
  WorkspaceApplyPatch: "workspace.apply_patch",
  AskUser: "conversation.ask_user",
} as const;

export function createDefaultHostCapabilityRegistry(
  options: {
    toolSearch?: AgentToolSearchRuntime;
    executionResources?: AgentExecutionResourceBroker;
  } = {},
): AgentToolHostCapabilityRegistry {
  const registry = new AgentToolHostCapabilityRegistry()
    .register(AgentHostCapabilityNames.ShellRun, runShellCommandHostTool)
    .register(AgentHostCapabilityNames.ArtifactMemoryRead, readArtifactMemoryHostTool)
    .register(AgentHostCapabilityNames.MemoryRecall, recallMemoryHostTool)
    .register(AgentHostCapabilityNames.MemoryWrite, writeMemoryHostTool)
    .register(AgentHostCapabilityNames.WorkspaceApplyPatch, applyWorkspacePatchHostTool);
  registry.register(AgentHostCapabilityNames.AskUser, askUserHostTool);

  if (options.executionResources) {
    const resources = createAgentExecutionResourceHostHandlers(options.executionResources);
    registry
      .register(AgentHostCapabilityNames.ShellStart, resources.startShell)
      .register(AgentHostCapabilityNames.ExecutionResourceInspect, resources.inspect)
      .register(AgentHostCapabilityNames.ExecutionResourceWait, resources.wait)
      .register(AgentHostCapabilityNames.ExecutionResourceWrite, resources.write)
      .register(AgentHostCapabilityNames.ExecutionResourceSignal, resources.signal)
      .register(AgentHostCapabilityNames.ExecutionResourceList, resources.list)
      .register(AgentHostCapabilityNames.ExecutionResourceResize, resources.resize)
      .register(AgentHostCapabilityNames.ExecutionResourceStopAll, resources.stopAll);
  }

  return options.toolSearch
    ? registry.register(
        AgentHostCapabilityNames.ToolSearch,
        options.toolSearch.createHostHandler(),
        options.toolSearch.createHostContractProjection(),
      )
    : registry;
}
