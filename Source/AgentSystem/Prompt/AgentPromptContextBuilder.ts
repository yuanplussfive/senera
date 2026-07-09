import { AgentHostCapabilityNames } from "../AgentDefaultHostCapabilities.js";
import { buildAgentRootCommand } from "../AgentRootCommand.js";
import { AgentSkillActivationService } from "../Skills/AgentSkillActivation.js";
import type { AgentPluginRegistry } from "../Plugin/AgentPluginRegistry.js";
import { compareLoadedPluginsForPrompting } from "../Plugin/AgentPluginOrdering.js";
import { EmptyAgentRoleplayPresetContext } from "../Presets/AgentPresetTypes.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { LoadedPlugin, RegisteredTool } from "../Types/PluginRuntimeTypes.js";
import { AgentMarkdownPromptXmlRenderer } from "../Xml/AgentMarkdownPromptXmlRenderer.js";
import { AgentPromptContractProjector } from "./AgentPromptContractProjector.js";
import { buildAgentExecutionEnvironmentContext } from "./AgentExecutionEnvironmentContext.js";
import type {
  AgentPromptContext,
  AgentPromptContextOptions,
  AgentPromptRootCommandOptions,
} from "./AgentPromptContextTypes.js";
import { AgentPromptDocumentationReader } from "./AgentPromptDocumentationReader.js";
import { AgentPromptSkillContextProjector } from "./AgentPromptSkillContextProjector.js";
import { resolveAgentPromptSections } from "./AgentPromptSectionResolver.js";
import { AgentPromptToolContextProjector } from "./AgentPromptToolContextProjector.js";

export type {
  AgentPromptContext,
  AgentPromptContextOptions,
  AgentPromptRootCommandOptions,
  AgentPromptSectionOptions,
  AgentPromptSkillCatalogContext,
  AgentPromptSkillContext,
  AgentPromptSkillMatchedFieldContext,
  AgentPromptToolContext,
} from "./AgentPromptContextTypes.js";

export class AgentPromptContextBuilder {
  private readonly skillActivation: AgentSkillActivationService;
  private readonly toolContextProjector: AgentPromptToolContextProjector;
  private readonly skillContextProjector: AgentPromptSkillContextProjector;

  constructor(
    private readonly registry: AgentPluginRegistry,
    config: AgentSystemConfig,
    private readonly workspaceRoot: string = process.cwd(),
  ) {
    this.skillActivation = new AgentSkillActivationService(registry);

    const documentationReader = new AgentPromptDocumentationReader(
      new AgentMarkdownPromptXmlRenderer({
        xmlFenceLanguages: config.PluginDocumentation?.PromptXml?.XmlFenceLanguages,
        codeFenceLanguages: config.PluginDocumentation?.PromptXml?.CodeFenceLanguages,
      }),
    );
    this.toolContextProjector = new AgentPromptToolContextProjector(
      new AgentPromptContractProjector(),
      documentationReader,
    );
    this.skillContextProjector = new AgentPromptSkillContextProjector(documentationReader);
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
      .sort((left, right) => this.comparePromptPriority(left.plugin, right.plugin))
      .map((tool) => this.toolContextProjector.projectTool(tool, toolSections));

    return {
      ExecutionEnvironment: buildAgentExecutionEnvironmentContext(this.workspaceRoot),
      ToolCards: toolCards,
      ActiveSkills: this.skillContextProjector.projectActiveSkills(
        options.activeSkills ?? this.skillActivation.activate({
          input: options.skillQuery,
          rootCommand,
        }),
      ),
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
      policy,
    });
  }

  private resolveLoadedTools(loadedToolNames: "all" | readonly string[]): RegisteredTool[] {
    const tools = this.registry.listTools();
    if (loadedToolNames === "all") {
      return tools;
    }
    const loadedToolNameSet = new Set(loadedToolNames);
    return tools.filter((tool) => loadedToolNameSet.has(tool.name));
  }

  private resolvePromptLoadedTools(
    tools: readonly RegisteredTool[],
    loadedToolNames: AgentPromptContextOptions["loadedToolNames"],
  ): RegisteredTool[] {
    if (loadedToolNames === "all") {
      return [...tools];
    }
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
    return rootCommand.includeToolCatalog ? rootCommand.allowedTools : [];
  }

  private resolveVisibleToolDiscoveryToolName(
    loadedTools: readonly RegisteredTool[],
    promptToolNameSet: ReadonlySet<string>,
  ): string | null {
    const toolDiscoveryToolName = loadedTools.find((tool) =>
      tool.handler.kind === "HostCapability"
      && tool.handler.capability === AgentHostCapabilityNames.ToolSearch
    )?.name;
    return toolDiscoveryToolName && promptToolNameSet.has(toolDiscoveryToolName)
      ? toolDiscoveryToolName
      : null;
  }

  private comparePromptPriority(left: LoadedPlugin, right: LoadedPlugin): number {
    return compareLoadedPluginsForPrompting(left, right);
  }
}
