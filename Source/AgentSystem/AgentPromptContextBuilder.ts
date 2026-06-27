import fs from "node:fs";
import type { AgentPluginRegistry } from "./AgentPluginRegistry.js";
import type { AgentSystemConfig } from "./Types/AgentConfigTypes.js";
import type {
  RegisteredDecisionAction,
  RegisteredTool,
} from "./Types/PluginRuntimeTypes.js";
import {
  normalizeMarkdownSectionText,
  parseMarkdownSections,
} from "./AgentMarkdownSections.js";
import { AgentMarkdownPromptXmlRenderer } from "./AgentMarkdownPromptXmlRenderer.js";
import {
  AgentPromptContractProjector,
  type AgentPromptContractView,
} from "./AgentPromptContractProjector.js";
import { createXmlProtocolSpec, type AgentXmlProtocolSpec } from "./AgentXmlPolicy.js";
import type { AgentActionDecision } from "./AgentActionPlanner.js";
import {
  buildAgentRootCommand,
  type AgentRootCommand,
  type AgentRootCommandWorkflowRecommendation,
} from "./AgentRootCommand.js";
import type { TaskFrame } from "./BamlClient/baml_client/types.js";
import { AgentHostCapabilityNames } from "./AgentDefaultHostCapabilities.js";
import {
  AgentSkillActivationService,
  type AgentActivatedSkill,
} from "./AgentSkillActivation.js";
import { compareLoadedPluginsForPrompting } from "./AgentPluginOrdering.js";
import {
  EmptyAgentRoleplayPresetContext,
  type AgentRoleplayPresetContext,
} from "./Presets/AgentPresetTypes.js";

export interface AgentPromptToolContext {
  name: string;
  description: string;
  whenToUse: string;
  whenNotToUse: string;
  argumentsContract?: AgentPromptContractView;
  documentationXml: string;
}

export interface AgentPromptSkillCatalogContext {
  name: string;
  title: string;
  summary: string;
  useCases: string[];
  avoid: string[];
  recommendedTools: string[];
  recommendedAgents: string[];
  recommendedWorkflows: string[];
}

export interface AgentPromptSkillContext extends AgentPromptSkillCatalogContext {
  documentationXml: string;
  workflowXml: string;
  matchedTerms: string[];
  matchedFields: AgentPromptSkillMatchedFieldContext[];
  score: number;
}

export interface AgentPromptSkillMatchedFieldContext {
  term: string;
  fields: string[];
}

export interface AgentPromptDecisionActionContext {
  name: string;
  kind: string;
  xmlRoot: string;
  description: string;
  whenToUse: string;
  whenNotToUse: string;
  outputContract?: AgentPromptContractView;
  documentationXml: string;
}

export interface AgentPromptContext {
  ToolCallProtocol: AgentPromptToolCallProtocolContext;
  DecisionActions: AgentPromptDecisionActionContext[];
  ToolCards: AgentPromptToolContext[];
  ActiveSkills: AgentPromptSkillContext[];
  ToolDiscoveryToolName: string | null;
  RootCommand: AgentRootCommand | null;
  RoleplayPreset: AgentRoleplayPresetContext;
}

export interface AgentPromptToolCallProtocolContext {
  root: string;
  callTag: string;
  nameTag: string;
  argumentsTag: string;
  arrayItemTag: string;
}

export interface AgentPromptContextOptions {
  loadedToolNames?: string[] | "all";
  toolSections?: AgentPromptSectionOptions;
  actionSections?: AgentPromptSectionOptions;
  summarySection?: string;
  triggerSection?: string;
  avoidSection?: string;
  rootCommand?: AgentRootCommand;
  roleplayPreset?: AgentRoleplayPresetContext;
  skillQuery?: string;
  activeSkills?: readonly AgentActivatedSkill[];
}

export interface AgentPromptSectionOptions {
  summary?: string;
  trigger?: string;
  avoid?: string;
}

export class AgentPromptContextBuilder {
  private readonly markdownRenderer: AgentMarkdownPromptXmlRenderer;
  private readonly contractProjector = new AgentPromptContractProjector();
  private readonly protocol: AgentXmlProtocolSpec;
  private readonly skillActivation: AgentSkillActivationService;

  constructor(
    private readonly registry: AgentPluginRegistry,
    config: AgentSystemConfig,
  ) {
    this.protocol = createXmlProtocolSpec(config);
    this.skillActivation = new AgentSkillActivationService(registry);
    this.markdownRenderer = new AgentMarkdownPromptXmlRenderer({
      xmlFenceLanguages: config.PluginDocumentation?.PromptXml?.XmlFenceLanguages,
      codeFenceLanguages: config.PluginDocumentation?.PromptXml?.CodeFenceLanguages,
    });
  }

  buildBaseContext(options: AgentPromptContextOptions = {}): AgentPromptContext {
    const tools = this.registry.listTools();
    const fallbackSections = this.resolveSections({
      summary: options.summarySection,
      trigger: options.triggerSection,
      avoid: options.avoidSection,
    });
    const toolSections = this.resolveSections(options.toolSections, fallbackSections);
    const actionSections = this.resolveSections(options.actionSections, fallbackSections);
    const loadedToolNames =
      options.loadedToolNames === "all"
        ? new Set(tools.map((tool) => tool.name))
        : new Set(options.loadedToolNames ?? []);

    const actions = this.registry
      .listDecisionActions()
      .sort((left, right) => this.comparePromptPriority(left.plugin, right.plugin))
      .map((action) => this.buildDecisionActionContext(action, actionSections));
    const loadedTools = tools.filter((tool) => loadedToolNames.has(tool.name));
    const toolDiscoveryToolName = loadedTools.find((tool) =>
      tool.handler.kind === "HostCapability"
      && tool.handler.capability === AgentHostCapabilityNames.ToolSearch
    )?.name;
    const rootCommand = options.rootCommand ?? null;
    const promptToolNames = rootCommand?.includeToolCatalog
      ? rootCommand.allowedTools
      : rootCommand
        ? []
        : loadedTools.map((tool) => tool.name);
    const promptToolNameSet = new Set(promptToolNames);
    const toolCards = tools
      .filter((tool) => promptToolNameSet.has(tool.name))
      .sort((left, right) => this.comparePromptPriority(left.plugin, right.plugin))
      .map((tool) => this.buildToolContext(tool, toolSections));
    const visibleToolDiscoveryToolName = toolDiscoveryToolName && promptToolNameSet.has(toolDiscoveryToolName)
      ? toolDiscoveryToolName
      : null;
    const activeSkills = this.buildActiveSkillContexts(
      options.activeSkills
        ?? this.skillActivation.activate({
          input: options.skillQuery,
          rootCommand,
        }),
    );

    return {
      ToolCallProtocol: this.buildToolCallProtocolContext(actions),
      DecisionActions: actions,
      ToolCards: toolCards,
      ActiveSkills: activeSkills,
      ToolDiscoveryToolName: visibleToolDiscoveryToolName,
      RootCommand: rootCommand,
      RoleplayPreset: options.roleplayPreset ?? EmptyAgentRoleplayPresetContext,
    };
  }

  buildRootCommand(options: {
    decision: AgentActionDecision;
    loadedToolNames: "all" | readonly string[];
    taskContract?: TaskFrame;
    workflowRecommendedTools?: readonly string[];
    workflowRecommendations?: readonly AgentRootCommandWorkflowRecommendation[];
  }): AgentRootCommand {
    const loadedTools = this.resolveLoadedTools(options.loadedToolNames);
    const policy = this.registry.getRootCommandPolicy(options.decision.action);
    if (!policy) {
      throw new Error(`RootCommand policy 没有声明 action：${options.decision.action}`);
    }

    return buildAgentRootCommand({
      decision: options.decision,
      loadedTools,
      policy,
      taskContract: options.taskContract,
      workflowRecommendedTools: options.workflowRecommendedTools,
      workflowRecommendations: options.workflowRecommendations,
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

  private buildToolCallProtocolContext(
    actions: readonly AgentPromptDecisionActionContext[],
  ): AgentPromptToolCallProtocolContext {
    const action = actions.find((item) => item.kind === "ToolCalls");
    if (!action) {
      throw new Error("ToolCalls 决策动作没有注册。");
    }

    return {
      root: action.xmlRoot,
      callTag: this.protocol.items.toolCall,
      nameTag: this.protocol.toolCall.name,
      argumentsTag: this.protocol.toolCall.arguments,
      arrayItemTag: this.protocol.items.arrayItem,
    };
  }

  private buildDecisionActionContext(
    action: RegisteredDecisionAction,
    sections: Required<AgentPromptSectionOptions>,
  ): AgentPromptDecisionActionContext {
    const document = this.readToolDocument(action.descriptionFile);
    const fallbackDescription = action.plugin.manifest.Plugin.Description ?? "";

    return {
      name: action.name,
      kind: action.kind,
      xmlRoot: action.xmlRoot,
      description:
        normalizeMarkdownSectionText(document.sections.get(sections.summary)) ||
        fallbackDescription,
      whenToUse:
        normalizeMarkdownSectionText(document.sections.get(sections.trigger)) ||
        fallbackDescription,
      whenNotToUse: normalizeMarkdownSectionText(document.sections.get(sections.avoid)),
      outputContract: this.contractProjector.projectFromFile(
        action.signatureFile,
        action.xmlRoot,
        action.signatureType,
      ),
      documentationXml: action.descriptionFile
        ? this.markdownRenderer.renderOrThrow(
            fs.readFileSync(action.descriptionFile, "utf8"),
            action.descriptionFile,
          )
        : "",
    };
  }

  private buildToolContext(
    tool: RegisteredTool,
    sections: Required<AgentPromptSectionOptions>,
  ): AgentPromptToolContext {
    const document = this.readToolDocument(tool.descriptionFile);
    const fallbackDescription = tool.plugin.manifest.Plugin.Description ?? "";

    return {
      name: tool.name,
      description:
        normalizeMarkdownSectionText(document.sections.get(sections.summary)) ||
        fallbackDescription,
      whenToUse:
        normalizeMarkdownSectionText(document.sections.get(sections.trigger)) ||
        fallbackDescription,
      whenNotToUse: normalizeMarkdownSectionText(document.sections.get(sections.avoid)),
      argumentsContract: this.contractProjector.projectFromFile(
        tool.signatureFile,
        "arguments",
        tool.signatureType,
      ),
      documentationXml: tool.descriptionFile
        ? this.markdownRenderer.renderOrThrow(
            fs.readFileSync(tool.descriptionFile, "utf8"),
            tool.descriptionFile,
          )
        : "",
    };
  }

  private buildActiveSkillContexts(
    activeSkills: readonly AgentActivatedSkill[],
  ): AgentPromptSkillContext[] {
    return activeSkills.map((skill) => {
      return {
        ...this.toSkillCatalogContext(skill),
        documentationXml: this.renderSkillMarkdown(skill.descriptionFile),
        workflowXml: skill.workflowFile
          ? this.renderSkillMarkdown(skill.workflowFile)
          : "",
        matchedTerms: [...new Set(skill.matchedTerms)],
        matchedFields: skill.matchedFields.map((entry) => ({
          term: entry.term,
          fields: [...entry.fields],
        })),
        score: Number(skill.score.toFixed(6)),
      };
    });
  }

  private toSkillCatalogContext(skill: Pick<
    AgentActivatedSkill,
    "name" | "title" | "summary" | "useCases" | "avoid" | "recommendedTools"
    | "recommendedAgents" | "recommendedWorkflows"
  >): AgentPromptSkillCatalogContext {
    return {
      name: skill.name,
      title: skill.title,
      summary: skill.summary,
      useCases: skill.useCases,
      avoid: skill.avoid,
      recommendedTools: skill.recommendedTools,
      recommendedAgents: skill.recommendedAgents,
      recommendedWorkflows: skill.recommendedWorkflows,
    };
  }

  private renderSkillMarkdown(filePath: string): string {
    return this.markdownRenderer.renderOrThrow(
      fs.readFileSync(filePath, "utf8"),
      filePath,
    );
  }

  private readToolDocument(descriptionFile: string | undefined) {
    if (!descriptionFile) {
      return {
        sections: new Map<string, string>(),
      };
    }

    return parseMarkdownSections(fs.readFileSync(descriptionFile, "utf8"));
  }

  private comparePromptPriority(
    left: RegisteredDecisionAction["plugin"],
    right: RegisteredDecisionAction["plugin"],
  ): number {
    return compareLoadedPluginsForPrompting(left, right);
  }

  private resolveSections(
    value: AgentPromptSectionOptions | undefined,
    fallback: Required<AgentPromptSectionOptions> = {
      summary: "简述",
      trigger: "何时使用",
      avoid: "不要使用的情况",
    },
  ): Required<AgentPromptSectionOptions> {
    return {
      summary: value?.summary ?? fallback.summary,
      trigger: value?.trigger ?? fallback.trigger,
      avoid: value?.avoid ?? fallback.avoid,
    };
  }
}
