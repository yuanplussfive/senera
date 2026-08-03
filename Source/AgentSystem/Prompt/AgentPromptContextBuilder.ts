import { AgentHostCapabilityNames } from "../AgentDefaultHostCapabilities.js";
import { buildAgentRootCommand } from "../AgentRootCommand.js";
import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import { EmptyAgentRoleplayPresetContext } from "../Presets/AgentPresetTypes.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import { resolveAgentToolOwner } from "../Types/AgentToolOwner.js";
import { buildAgentExecutionEnvironmentContext } from "./AgentExecutionEnvironmentContext.js";
import type {
  AgentPromptContext,
  AgentPromptContextOptions,
  AgentPromptRootCommandOptions,
} from "./AgentPromptContextTypes.js";
import { AgentPromptDocumentationReader } from "./AgentPromptDocumentationReader.js";
import { resolveAgentPromptSections } from "./AgentPromptSectionResolver.js";
import { AgentPromptToolContextProjector } from "./AgentPromptToolContextProjector.js";

export type {
  AgentPromptContext,
  AgentPromptContextOptions,
  AgentPromptRootCommandOptions,
  AgentPromptSectionOptions,
  AgentPromptToolContext,
} from "./AgentPromptContextTypes.js";

export class AgentPromptContextBuilder {
  private readonly toolContextProjector: AgentPromptToolContextProjector;

  constructor(
    private readonly registry: AgentExtensionRegistry,
    private readonly workspaceRoot: string = process.cwd(),
  ) {
    const documentationReader = new AgentPromptDocumentationReader();
    this.toolContextProjector = new AgentPromptToolContextProjector(documentationReader);
  }

  buildBaseContext(options: AgentPromptContextOptions = {}): AgentPromptContext {
    const tools = this.registry.listTools();
    const fallbackSections = resolveAgentPromptSections({
      summary: options.summarySection,
      trigger: options.triggerSection,
      avoid: options.avoidSection,
    });
    const toolSections = resolveAgentPromptSections(options.toolSections, fallbackSections);
    const loadedTools = this.resolvePromptLoadedTools(tools, options.loadedToolNames);
    const rootCommand = options.rootCommand ?? null;
    const promptToolNameSet = new Set(this.resolvePromptToolNames(rootCommand, loadedTools));
    const toolCards = tools
      .filter((tool) => promptToolNameSet.has(tool.name))
      .sort(comparePromptPriority)
      .map((tool) => this.toolContextProjector.projectTool(tool, toolSections));

    return {
      ExecutionEnvironment: buildAgentExecutionEnvironmentContext(this.workspaceRoot),
      ToolCards: toolCards,
      ToolDiscoveryToolName: this.resolveVisibleToolDiscoveryToolName(loadedTools, promptToolNameSet),
      RootCommand: rootCommand,
      RoleplayPreset: options.roleplayPreset ?? EmptyAgentRoleplayPresetContext,
    };
  }

  buildRootCommand(options: AgentPromptRootCommandOptions) {
    const loadedTools = this.resolveLoadedTools(options.loadedToolNames);
    const policy = this.registry.getRootCommandPolicy(options.decision.action);
    if (!policy) {
      throw new Error(`RootCommand policy 没有声明 action：${options.decision.action}`);
    }

    return buildAgentRootCommand({
      decision: options.decision,
      loadedTools,
      registeredTools: this.registry.listTools(),
      policy,
    });
  }

  private resolveLoadedTools(loadedToolNames: readonly string[]): RegisteredTool[] {
    const tools = this.registry.listTools();
    const loadedToolNameSet = new Set(loadedToolNames);
    return tools.filter((tool) => loadedToolNameSet.has(tool.name));
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

function comparePromptPriority(left: RegisteredTool, right: RegisteredTool): number {
  const leftOwner = resolveAgentToolOwner(left);
  const rightOwner = resolveAgentToolOwner(right);
  return (leftOwner.priority ?? 100) - (rightOwner.priority ?? 100) || left.name.localeCompare(right.name);
}
