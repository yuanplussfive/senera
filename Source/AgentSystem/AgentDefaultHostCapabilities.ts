import { readArtifactMemoryHostTool } from "./Memory/AgentArtifactMemoryRuntime.js";
import { recallContinuityHostTool, writeContinuityHostTool } from "./Continuity/AgentContinuityToolRuntime.js";
import { createShellCommandHostTool } from "./ToolRuntime/AgentShellCommandRuntime.js";
import { applyWorkspacePatchHostTool } from "./ToolRuntime/AgentWorkspaceApplyPatchRuntime.js";
import { AgentToolHostCapabilityRegistry } from "./ToolRuntime/AgentToolHostCapabilityRegistry.js";
import type { AgentToolSearchRuntime } from "./ToolSearch/AgentToolSearchRuntime.js";
import type { AgentExecutionResourceBroker } from "./ExecutionResources/AgentExecutionResourceBroker.js";
import { createAgentExecutionResourceHostHandlers } from "./ToolRuntime/AgentExecutionResourceRuntime.js";
import { askUserHostTool } from "./Conversation/AgentAskUserRuntime.js";
import {
  createAgentOrchestrationHostHandlers,
  type AgentOrchestrationHostRuntime,
} from "./Orchestration/AgentOrchestrationHostTools.js";
import { AgentSpawnHostContractProjection } from "./Orchestration/AgentSpawnHostContractProjection.js";

export const AgentHostCapabilityNames = {
  ShellRun: "shell.run",
  TerminalStart: "terminal.start",
  ExecutionResourceInspect: "execution.resource.inspect",
  ExecutionResourceWait: "execution.resource.wait",
  ExecutionResourceWrite: "execution.resource.write",
  ExecutionResourceSignal: "execution.resource.signal",
  ExecutionResourceList: "execution.resource.list",
  ExecutionResourceResize: "execution.resource.resize",
  ExecutionResourceStopAll: "execution.resource.stop_all",
  ToolSearch: "tool.search",
  ToolDescribe: "tool.describe",
  ToolLoad: "tool.load",
  ToolUnload: "tool.unload",
  ArtifactMemoryRead: "artifact.memory.read",
  MemoryRecall: "memory.recall",
  MemoryWrite: "memory.write",
  WorkspaceApplyPatch: "workspace.apply_patch",
  AskUser: "conversation.ask_user",
  SkillManage: "extensions.skill.manage",
  AgentSpawn: "orchestration.agent.spawn",
  AgentList: "orchestration.agent.list",
  AgentWait: "orchestration.agent.wait",
  AgentInput: "orchestration.agent.input",
  AgentStop: "orchestration.agent.stop",
  AgentResume: "orchestration.agent.resume",
  AgentContactSupervisor: "orchestration.agent.contact_supervisor",
  ScheduleManage: "orchestration.schedule.manage",
} as const;

export function listDefaultAgentHostCapabilityNames(): ReadonlySet<string> {
  return new Set(Object.values(AgentHostCapabilityNames));
}

export function createDefaultHostCapabilityRegistry(
  options: {
    toolSearch?: AgentToolSearchRuntime;
    executionResources?: AgentExecutionResourceBroker;
    orchestration?: AgentOrchestrationHostRuntime;
  } = {},
): AgentToolHostCapabilityRegistry {
  const registry = new AgentToolHostCapabilityRegistry()
    .register(AgentHostCapabilityNames.ShellRun, createShellCommandHostTool(options.executionResources))
    .register(AgentHostCapabilityNames.ArtifactMemoryRead, readArtifactMemoryHostTool)
    .register(AgentHostCapabilityNames.MemoryRecall, recallContinuityHostTool)
    .register(AgentHostCapabilityNames.MemoryWrite, writeContinuityHostTool)
    .register(AgentHostCapabilityNames.WorkspaceApplyPatch, applyWorkspacePatchHostTool);
  registry.register(AgentHostCapabilityNames.AskUser, askUserHostTool);

  if (options.executionResources) {
    const resources = createAgentExecutionResourceHostHandlers(options.executionResources);
    registry
      .register(AgentHostCapabilityNames.TerminalStart, resources.startTerminal)
      .register(AgentHostCapabilityNames.ExecutionResourceInspect, resources.inspect)
      .register(AgentHostCapabilityNames.ExecutionResourceWait, resources.wait)
      .register(AgentHostCapabilityNames.ExecutionResourceWrite, resources.write)
      .register(AgentHostCapabilityNames.ExecutionResourceSignal, resources.signal)
      .register(AgentHostCapabilityNames.ExecutionResourceList, resources.list)
      .register(AgentHostCapabilityNames.ExecutionResourceResize, resources.resize)
      .register(AgentHostCapabilityNames.ExecutionResourceStopAll, resources.stopAll);
  }

  if (options.orchestration) {
    const handlers = createAgentOrchestrationHostHandlers(options.orchestration);
    const delegation = options.orchestration.delegation;
    const spawnContract = new AgentSpawnHostContractProjection(() =>
      delegation.roleCatalogSnapshot(),
    ).createProjection();
    registry
      .register(AgentHostCapabilityNames.AgentSpawn, handlers.spawn, spawnContract)
      .register(AgentHostCapabilityNames.AgentList, handlers.list)
      .register(AgentHostCapabilityNames.AgentWait, handlers.wait)
      .register(AgentHostCapabilityNames.AgentInput, handlers.input)
      .register(AgentHostCapabilityNames.AgentStop, handlers.stop)
      .register(AgentHostCapabilityNames.AgentResume, handlers.resume)
      .register(AgentHostCapabilityNames.AgentContactSupervisor, handlers.contactSupervisor)
      .register(AgentHostCapabilityNames.ScheduleManage, handlers.scheduleManage);
  }

  if (options.toolSearch) {
    registry
      .register(
        AgentHostCapabilityNames.ToolSearch,
        options.toolSearch.createSearchHostHandler(),
        options.toolSearch.createHostContractProjection(),
      )
      .register(AgentHostCapabilityNames.ToolDescribe, options.toolSearch.createDescribeHostHandler())
      .register(AgentHostCapabilityNames.ToolLoad, options.toolSearch.createLoadHostHandler())
      .register(AgentHostCapabilityNames.ToolUnload, options.toolSearch.createUnloadHostHandler());
  }

  return registry;
}
