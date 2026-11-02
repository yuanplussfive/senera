import { ArtifactReadReplayContract, readArtifactMemoryHostTool } from "./Memory/AgentArtifactMemoryRuntime.js";
import {
  createRecallContinuityHostTool,
  writeContinuityHostTool,
  type AgentContinuityRecallService,
} from "./Continuity/AgentContinuityToolRuntime.js";
import { createShellCommandHostTool } from "./ToolRuntime/AgentShellCommandRuntime.js";
import { applyWorkspacePatchHostTool } from "./ToolRuntime/AgentWorkspaceApplyPatchRuntime.js";
import { restoreWorkspaceCheckpointHostTool } from "./ToolRuntime/AgentWorkspaceCheckpointRuntime.js";
import { AgentToolHostCapabilityRegistry } from "./ToolRuntime/AgentToolHostCapabilityRegistry.js";
import type { AgentToolSearchRuntime } from "./ToolSearch/AgentToolSearchRuntime.js";
import type { AgentExecutionResourceBroker } from "./ExecutionResources/AgentExecutionResourceBroker.js";
import { createAgentExecutionResourceHostHandlers } from "./ToolRuntime/AgentExecutionResourceRuntime.js";
import {
  createAgentOrchestrationHostHandlers,
  type AgentOrchestrationHostRuntime,
} from "./Orchestration/AgentOrchestrationHostTools.js";
import { AgentSpawnHostContractProjection } from "./Orchestration/AgentSpawnHostContractProjection.js";
import type { AgentArtifactManifestIndexCache } from "./Memory/AgentArtifactManifestIndexCache.js";
import type { AgentSelfServicePort } from "./SelfService/AgentSelfServiceTypes.js";
import type { AgentApprovalRuntime } from "./Approvals/AgentApprovalRuntime.js";

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
  WorkspaceRestoreCheckpoint: "workspace.restore_checkpoint",
  Subagent: "orchestration.subagent",
  AgentSendMessage: "orchestration.send_message",
  ListAgents: "orchestration.list_agents",
  ListSubagentModels: "orchestration.list_subagent_models",
  InterruptAgent: "orchestration.interrupt_agent",
  ScheduleCreate: "orchestration.schedule.create",
  ScheduleList: "orchestration.schedule.list",
  ScheduleView: "orchestration.schedule.view",
  ScheduleEdit: "orchestration.schedule.edit",
  JobList: "orchestration.job.list",
  JobOutput: "orchestration.job.output",
  JobKill: "orchestration.job.kill",
} as const;

interface AgentDefaultHostCapabilityRuntimeOptions {
  readonly selfService?: AgentSelfServicePort;
  readonly approvalRuntime?: AgentApprovalRuntime;
  readonly artifactManifestIndex?: AgentArtifactManifestIndexCache;
  readonly toolSearch?: AgentToolSearchRuntime;
  readonly executionResources?: AgentExecutionResourceBroker;
  readonly orchestration?: AgentOrchestrationHostRuntime;
  readonly continuityRecall?: AgentContinuityRecallService;
  /** A durable continuity learner is available for explicit memory intents. */
  readonly continuityWrite?: boolean;
}

type AgentDefaultHostRuntimeService = keyof AgentDefaultHostCapabilityRuntimeOptions;

interface AgentDefaultHostCapabilityBinding {
  readonly capabilities: readonly string[];
  readonly requires?: readonly AgentDefaultHostRuntimeService[];
  register(registry: AgentToolHostCapabilityRegistry, options: AgentDefaultHostCapabilityRuntimeOptions): void;
}

/**
 * Runtime bindings are intentionally separate from the extension contracts.
 * Each package declares the public tools; this table only says which concrete
 * host service can execute a declared capability when its dependency exists.
 */
const DefaultHostCapabilityBindings: readonly AgentDefaultHostCapabilityBinding[] = [
  {
    capabilities: [AgentHostCapabilityNames.ArtifactMemoryRead],
    register(registry, options) {
      registry.register(
        AgentHostCapabilityNames.ArtifactMemoryRead,
        (args, context) =>
          readArtifactMemoryHostTool(args, { ...context, artifactManifestIndex: options.artifactManifestIndex }),
        ArtifactReadReplayContract,
      );
    },
  },
  {
    capabilities: [
      AgentHostCapabilityNames.ShellRun,
      AgentHostCapabilityNames.TerminalStart,
      AgentHostCapabilityNames.ExecutionResourceInspect,
      AgentHostCapabilityNames.ExecutionResourceWait,
      AgentHostCapabilityNames.ExecutionResourceWrite,
      AgentHostCapabilityNames.ExecutionResourceSignal,
      AgentHostCapabilityNames.ExecutionResourceList,
      AgentHostCapabilityNames.ExecutionResourceResize,
      AgentHostCapabilityNames.ExecutionResourceStopAll,
    ],
    requires: ["executionResources"],
    register(registry, options) {
      const resources = createAgentExecutionResourceHostHandlers(options.executionResources!);
      registry
        .register(
          AgentHostCapabilityNames.ShellRun,
          createShellCommandHostTool(options.executionResources!, undefined, options),
        )
        .register(AgentHostCapabilityNames.TerminalStart, resources.startTerminal)
        .register(AgentHostCapabilityNames.ExecutionResourceInspect, resources.inspect)
        .register(AgentHostCapabilityNames.ExecutionResourceWait, resources.wait)
        .register(AgentHostCapabilityNames.ExecutionResourceWrite, resources.write)
        .register(AgentHostCapabilityNames.ExecutionResourceSignal, resources.signal)
        .register(AgentHostCapabilityNames.ExecutionResourceList, resources.list)
        .register(AgentHostCapabilityNames.ExecutionResourceResize, resources.resize)
        .register(AgentHostCapabilityNames.ExecutionResourceStopAll, resources.stopAll);
    },
  },
  {
    capabilities: [AgentHostCapabilityNames.MemoryRecall],
    requires: ["continuityRecall"],
    register(registry, options) {
      registry.register(
        AgentHostCapabilityNames.MemoryRecall,
        createRecallContinuityHostTool(options.continuityRecall!),
      );
    },
  },
  {
    capabilities: [AgentHostCapabilityNames.MemoryWrite],
    requires: ["continuityWrite"],
    register(registry) {
      registry.register(AgentHostCapabilityNames.MemoryWrite, writeContinuityHostTool);
    },
  },
  {
    capabilities: [AgentHostCapabilityNames.WorkspaceApplyPatch, AgentHostCapabilityNames.WorkspaceRestoreCheckpoint],
    register(registry) {
      registry
        .register(AgentHostCapabilityNames.WorkspaceApplyPatch, applyWorkspacePatchHostTool)
        .register(AgentHostCapabilityNames.WorkspaceRestoreCheckpoint, restoreWorkspaceCheckpointHostTool);
    },
  },
  {
    capabilities: [
      AgentHostCapabilityNames.Subagent,
      AgentHostCapabilityNames.AgentSendMessage,
      AgentHostCapabilityNames.ListAgents,
      AgentHostCapabilityNames.ListSubagentModels,
      AgentHostCapabilityNames.InterruptAgent,
      AgentHostCapabilityNames.ScheduleCreate,
      AgentHostCapabilityNames.ScheduleList,
      AgentHostCapabilityNames.ScheduleView,
      AgentHostCapabilityNames.ScheduleEdit,
      AgentHostCapabilityNames.JobList,
      AgentHostCapabilityNames.JobOutput,
      AgentHostCapabilityNames.JobKill,
    ],
    requires: ["orchestration"],
    register(registry, options) {
      const orchestration = options.orchestration!;
      const handlers = createAgentOrchestrationHostHandlers(orchestration);
      const delegation = orchestration.delegation;
      const spawnContract = new AgentSpawnHostContractProjection(
        () => delegation.roleCatalogSnapshot(),
        () => delegation.resourceClaimCapabilityIds(),
        () => delegation.modelCatalogSnapshot(),
      ).createProjection();
      registry
        .register(AgentHostCapabilityNames.Subagent, handlers.subagent, spawnContract)
        .register(AgentHostCapabilityNames.AgentSendMessage, handlers.sendMessage)
        .register(AgentHostCapabilityNames.ListAgents, handlers.listAgents)
        .register(AgentHostCapabilityNames.ListSubagentModels, handlers.listSubagentModels)
        .register(AgentHostCapabilityNames.InterruptAgent, handlers.interruptAgent)
        .register(AgentHostCapabilityNames.ScheduleCreate, handlers.scheduleCreate)
        .register(AgentHostCapabilityNames.ScheduleList, handlers.scheduleList)
        .register(AgentHostCapabilityNames.ScheduleView, handlers.scheduleView)
        .register(AgentHostCapabilityNames.ScheduleEdit, handlers.scheduleEdit)
        .register(AgentHostCapabilityNames.JobList, handlers.jobList)
        .register(AgentHostCapabilityNames.JobOutput, handlers.jobOutput)
        .register(AgentHostCapabilityNames.JobKill, handlers.jobKill);
    },
  },
  {
    capabilities: [
      AgentHostCapabilityNames.ToolSearch,
      AgentHostCapabilityNames.ToolDescribe,
      AgentHostCapabilityNames.ToolLoad,
      AgentHostCapabilityNames.ToolUnload,
    ],
    requires: ["toolSearch"],
    register(registry, options) {
      const toolSearch = options.toolSearch!;
      registry
        .register(AgentHostCapabilityNames.ToolSearch, toolSearch.createSearchHostHandler())
        .register(AgentHostCapabilityNames.ToolDescribe, toolSearch.createDescribeHostHandler())
        .register(AgentHostCapabilityNames.ToolLoad, toolSearch.createLoadHostHandler())
        .register(AgentHostCapabilityNames.ToolUnload, toolSearch.createUnloadHostHandler());
    },
  },
];

export function listDefaultAgentHostCapabilityNames(): ReadonlySet<string> {
  return new Set(DefaultHostCapabilityBindings.flatMap((binding) => binding.capabilities));
}

export function createDefaultHostCapabilityRegistry(
  options: AgentDefaultHostCapabilityRuntimeOptions = {},
): AgentToolHostCapabilityRegistry {
  const registry = new AgentToolHostCapabilityRegistry();
  for (const binding of DefaultHostCapabilityBindings) {
    if (binding.requires?.some((service) => !isRuntimeServiceAvailable(options[service]))) continue;
    binding.register(registry, options);
  }
  return registry;
}

function isRuntimeServiceAvailable(value: unknown): boolean {
  return value !== undefined && value !== false;
}
