import fs from "node:fs";
import type { AgentPluginRegistry } from "./AgentPluginRegistry.js";
import type {
  AgentSystemConfig,
  RegisteredDecisionAction,
  RegisteredTool,
} from "./Types.js";
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
import {
  agentActionCapabilityNeeds,
  agentActionInstruction,
  agentActionPreferredTools,
  agentActionToolSearchQueries,
  type AgentActionCapabilityNeed,
  type AgentActionDecision,
} from "./AgentActionPlanner.js";

export interface AgentPromptToolContext {
  name: string;
  description: string;
  whenToUse: string;
  whenNotToUse: string;
  argumentsContract?: AgentPromptContractView;
  documentationXml: string;
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
  ToolDiscoveryToolName?: string;
  ActionDirective: AgentPromptActionDirectiveContext | null;
}

export interface AgentPromptToolCallProtocolContext {
  root: string;
  callTag: string;
  nameTag: string;
  argumentsTag: string;
  arrayItemTag: string;
}

export interface AgentPromptActionDirectiveContext {
  action: string;
  instruction: string;
  preferredTools: string[];
  toolSearchQueries: string[];
  needs: AgentActionCapabilityNeed[];
}

export interface AgentPromptContextOptions {
  loadedToolNames?: string[] | "all";
  toolSections?: AgentPromptSectionOptions;
  actionSections?: AgentPromptSectionOptions;
  summarySection?: string;
  triggerSection?: string;
  avoidSection?: string;
  actionDirective?: AgentActionDecision;
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

  constructor(
    private readonly registry: AgentPluginRegistry,
    config: AgentSystemConfig,
  ) {
    this.protocol = createXmlProtocolSpec(config);
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
    const toolCards = tools
      .filter((tool) => loadedToolNames.has(tool.name))
      .sort((left, right) => this.comparePromptPriority(left.plugin, right.plugin))
      .map((tool) => this.buildToolContext(tool, toolSections));
    const loadedTools = tools.filter((tool) => loadedToolNames.has(tool.name));

    return {
      ToolCallProtocol: this.buildToolCallProtocolContext(actions),
      DecisionActions: actions,
      ToolCards: toolCards,
      ToolDiscoveryToolName: loadedTools.find((tool) =>
        tool.handler.kind === "HostCapability" && tool.handler.capability === "tool.search"
      )?.name,
      ActionDirective: options.actionDirective
        ? this.buildActionDirectiveContext(options.actionDirective)
        : null,
    };
  }

  private buildActionDirectiveContext(
    directive: AgentActionDecision,
  ): AgentPromptActionDirectiveContext {
    return {
      action: directive.action,
      instruction: agentActionInstruction(directive),
      preferredTools: agentActionPreferredTools(directive),
      toolSearchQueries: agentActionToolSearchQueries(directive),
      needs: agentActionCapabilityNeeds(directive),
    };
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
      outputContract: this.contractProjector.projectFromFile(action.signatureFile, action.xmlRoot),
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
      argumentsContract: this.contractProjector.projectFromFile(tool.signatureFile, "arguments"),
      documentationXml: tool.descriptionFile
        ? this.markdownRenderer.renderOrThrow(
            fs.readFileSync(tool.descriptionFile, "utf8"),
            tool.descriptionFile,
          )
        : "",
    };
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
    const leftPriority = left.manifest.Prompting?.Priority ?? 100;
    const rightPriority = right.manifest.Prompting?.Priority ?? 100;

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    return left.manifest.Plugin.Name.localeCompare(right.manifest.Plugin.Name);
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
