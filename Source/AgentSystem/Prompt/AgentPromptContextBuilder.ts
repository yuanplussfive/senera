import { AgentHostCapabilityNames } from "../AgentDefaultHostCapabilities.js";
import { buildAgentRootCommand } from "../AgentRootCommand.js";
import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import { EmptyAgentRoleplayPresetContext } from "../Presets/AgentPresetTypes.js";
import { EmptyAgentContinuityMemoryPromptContext } from "../Continuity/AgentContinuityMemoryTypes.js";
import { EmptyAgentWorkflowPromptContext } from "./AgentWorkflowPromptContext.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import { resolveAgentToolOwner } from "../Types/AgentToolOwner.js";
import { buildAgentExecutionEnvironmentContext } from "./AgentExecutionEnvironmentContext.js";
import type {
  AgentPromptContext,
  AgentPromptContextOptions,
  AgentPromptRootCommandOptions,
  AgentPromptToolContext,
} from "./AgentPromptContextTypes.js";
import { AgentPromptDocumentationReader } from "./AgentPromptDocumentationReader.js";
import { resolveAgentPromptSections } from "./AgentPromptSectionResolver.js";
import { AgentPromptToolContextProjector } from "./AgentPromptToolContextProjector.js";
import {
  createSeneraExecutionRuntimeCapabilities,
  type SeneraExecutionRuntimeCapabilities,
} from "../Execution/SeneraExecutionRuntimeCapabilities.js";
import {
  projectSeneraProcessBackendsToToolTargets,
  resolveAvailableAgentToolExecutionTargets,
} from "../ToolRuntime/AgentToolExecutionPlan.js";
import { compileAgentPromptContext } from "./AgentPromptContextCompiler.js";
import { EmptyAgentSceneContext } from "./AgentSceneContextCompiler.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";

export type {
  AgentPromptContext,
  AgentPromptContextOptions,
  AgentPromptRootCommandOptions,
  AgentPromptSectionOptions,
  AgentPromptToolContext,
} from "./AgentPromptContextTypes.js";

export class AgentPromptContextBuilder {
  private readonly toolContextProjector: AgentPromptToolContextProjector;
  private staticProjectionRevision = -1;
  private readonly staticProjectionCache = new Map<string, StaticPromptProjection>();

  constructor(
    private readonly registry: AgentExtensionRegistry,
    private readonly workspaceRoot: string = process.cwd(),
    private readonly executionCapabilities: () => SeneraExecutionRuntimeCapabilities = () =>
      createSeneraExecutionRuntimeCapabilities(),
    private readonly sandboxGuestWorkspaceRoot?: string,
  ) {
    const documentationReader = new AgentPromptDocumentationReader();
    this.toolContextProjector = new AgentPromptToolContextProjector(documentationReader);
  }

  buildBaseContext(options: AgentPromptContextOptions = {}): AgentPromptContext {
    const capabilities = this.executionCapabilities();
    const tools = this.availableTools(capabilities);
    const fallbackSections = resolveAgentPromptSections({
      summary: options.summarySection,
      trigger: options.triggerSection,
      avoid: options.avoidSection,
    });
    const toolSections = resolveAgentPromptSections(options.toolSections, fallbackSections);
    const loadedTools = this.resolvePromptLoadedTools(tools, options.loadedToolNames);
    const rootCommand = options.rootCommand ?? null;
    const promptToolNameSet = new Set(this.resolvePromptToolNames(rootCommand, loadedTools));
    const staticProjection = this.resolveStaticProjection({
      capabilities,
      tools,
      loadedTools,
      rootCommand,
      promptToolNameSet,
      toolSections,
    });

    return compileAgentPromptContext({
      executionEnvironment: staticProjection.executionEnvironment,
      toolCards: staticProjection.toolCards,
      toolDiscoveryToolName: staticProjection.toolDiscoveryToolName,
      rootCommand,
      roleplayPreset: options.roleplayPreset ?? EmptyAgentRoleplayPresetContext,
      continuityMemory: options.continuityMemory ?? EmptyAgentContinuityMemoryPromptContext,
      workflow: options.workflow ?? EmptyAgentWorkflowPromptContext,
      scene: options.scene ?? EmptyAgentSceneContext,
    });
  }

  buildRootCommand(options: AgentPromptRootCommandOptions) {
    const registeredTools = this.availableTools();
    const loadedTools = this.resolveLoadedTools(options.loadedToolNames, registeredTools);
    const policy = this.registry.getRootCommandPolicy(options.decision.action);
    if (!policy) {
      throw new Error(`RootCommand policy 没有声明 action：${options.decision.action}`);
    }

    return buildAgentRootCommand({
      decision: options.decision,
      loadedTools,
      registeredTools,
      policy,
      allowedToolNames: options.allowedToolNames,
    });
  }

  private resolveLoadedTools(
    loadedToolNames: readonly string[],
    tools: readonly RegisteredTool[] = this.availableTools(),
  ): RegisteredTool[] {
    const loadedToolNameSet = new Set(loadedToolNames);
    return tools.filter((tool) => loadedToolNameSet.has(tool.name));
  }

  private availableTools(capabilities = this.executionCapabilities()): RegisteredTool[] {
    const runtimeTargets = projectSeneraProcessBackendsToToolTargets(capabilities.processBackends);
    return this.registry
      .listTools()
      .filter((tool) => resolveAvailableAgentToolExecutionTargets(tool, runtimeTargets).length > 0);
  }

  private resolveStaticProjection(input: {
    capabilities: SeneraExecutionRuntimeCapabilities;
    tools: readonly RegisteredTool[];
    loadedTools: readonly RegisteredTool[];
    rootCommand: AgentPromptContext["RootCommand"];
    promptToolNameSet: ReadonlySet<string>;
    toolSections: ReturnType<typeof resolveAgentPromptSections>;
  }): StaticPromptProjection {
    if (this.staticProjectionRevision !== this.registry.revision) {
      this.staticProjectionRevision = this.registry.revision;
      this.staticProjectionCache.clear();
    }

    const key = sha256HexOfCanonicalJson({
      workspaceRoot: this.workspaceRoot,
      capabilities: input.capabilities,
      loadedToolNames: input.loadedTools.map((tool) => tool.name),
      promptToolNames: [...input.promptToolNameSet].sort(),
      toolSections: input.toolSections,
      includeToolCatalog: input.rootCommand?.includeToolCatalog ?? null,
    });
    const cached = this.staticProjectionCache.get(key);
    if (cached) return cached;

    const projection: StaticPromptProjection = {
      executionEnvironment: buildAgentExecutionEnvironmentContext(
        this.workspaceRoot,
        input.capabilities,
        undefined,
        this.sandboxGuestWorkspaceRoot,
      ),
      toolCards: input.tools
        .filter((tool) => input.promptToolNameSet.has(tool.name))
        .sort(comparePromptPriority)
        .map((tool) => this.toolContextProjector.projectTool(tool, input.toolSections)),
      toolDiscoveryToolName: this.resolveVisibleToolDiscoveryToolName(input.loadedTools, input.promptToolNameSet),
    };
    this.staticProjectionCache.set(key, projection);
    return projection;
  }

  private resolvePromptLoadedTools(
    tools: readonly RegisteredTool[],
    loadedToolNames: AgentPromptContextOptions["loadedToolNames"],
  ): RegisteredTool[] {
    const loadedToolNameSet = new Set(loadedToolNames ?? []);
    return tools.filter((tool) => loadedToolNameSet.has(tool.name));
  }

  private resolvePromptToolNames(
    rootCommand: AgentPromptContext["RootCommand"],
    loadedTools: readonly RegisteredTool[],
  ): readonly string[] {
    if (!rootCommand) {
      return loadedTools.map((tool) => tool.name);
    }
    return rootCommand.includeToolCatalog ? rootCommand.toolAccessGrant.exposedToolNames : [];
  }

  private resolveVisibleToolDiscoveryToolName(
    loadedTools: readonly RegisteredTool[],
    promptToolNameSet: ReadonlySet<string>,
  ): string | null {
    const toolDiscoveryToolName = loadedTools.find(
      (tool) =>
        tool.handler.kind === "HostCapability" && tool.handler.capability === AgentHostCapabilityNames.ToolSearch,
    )?.name;
    return toolDiscoveryToolName && promptToolNameSet.has(toolDiscoveryToolName) ? toolDiscoveryToolName : null;
  }
}

interface StaticPromptProjection {
  readonly executionEnvironment: ReturnType<typeof buildAgentExecutionEnvironmentContext>;
  readonly toolCards: readonly AgentPromptToolContext[];
  readonly toolDiscoveryToolName: string | null;
}

function comparePromptPriority(left: RegisteredTool, right: RegisteredTool): number {
  const leftOwner = resolveAgentToolOwner(left);
  const rightOwner = resolveAgentToolOwner(right);
  return (leftOwner.priority ?? 100) - (rightOwner.priority ?? 100) || left.name.localeCompare(right.name);
}
