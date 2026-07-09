import { AgentMarkdownPromptXmlRenderer } from "../Xml/AgentMarkdownPromptXmlRenderer.js";
import { normalizeMarkdownSectionText } from "../Xml/AgentMarkdownSections.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { RegisteredTool } from "../Types/PluginRuntimeTypes.js";
import type { AgentPluginRegistry } from "../Plugin/AgentPluginRegistry.js";
import { AgentPromptContractProjector } from "../Prompt/AgentPromptContractProjector.js";
import { AgentPromptDocumentationReader } from "../Prompt/AgentPromptDocumentationReader.js";
import { resolveAgentPromptSections } from "../Prompt/AgentPromptSectionResolver.js";
import type { AgentPiToolExecutionBridge } from "./AgentPiToolExecutionBridge.js";
import type {
  AgentPiToolDefinition,
  AgentPiToolProjectionContext,
} from "./AgentPiTypes.js";

export interface AgentPiToolRegistryProjectorOptions {
  config: AgentSystemConfig;
  registry: AgentPluginRegistry;
  execution: AgentPiToolExecutionBridge;
}

const EmptyObjectParameterSchema = {
  type: "object",
  properties: {},
  additionalProperties: true,
} as const;

export class AgentPiToolRegistryProjector {
  private readonly contractProjector = new AgentPromptContractProjector();
  private readonly documentationReader: AgentPromptDocumentationReader;

  constructor(private readonly options: AgentPiToolRegistryProjectorOptions) {
    this.documentationReader = new AgentPromptDocumentationReader(
      new AgentMarkdownPromptXmlRenderer({
        xmlFenceLanguages: options.config.PluginDocumentation?.PromptXml?.XmlFenceLanguages,
        codeFenceLanguages: options.config.PluginDocumentation?.PromptXml?.CodeFenceLanguages,
      }),
    );
  }

  project(context: AgentPiToolProjectionContext = {}): AgentPiToolDefinition[] {
    return this.visibleTools(context.visibleToolNames)
      .map((tool) => this.projectTool(tool, context));
  }

  names(visibleToolNames?: AgentPiToolProjectionContext["visibleToolNames"]): string[] {
    return this.visibleTools(visibleToolNames).map((tool) => tool.name);
  }

  private visibleTools(
    visibleToolNames: AgentPiToolProjectionContext["visibleToolNames"] = "all",
  ): RegisteredTool[] {
    if (visibleToolNames === "all") {
      return this.options.registry.listTools();
    }

    const visible = new Set(visibleToolNames);
    return this.options.registry.listTools().filter((tool) => visible.has(tool.name));
  }

  private projectTool(
    tool: RegisteredTool,
    context: AgentPiToolProjectionContext,
  ): AgentPiToolDefinition {
    return {
      name: tool.name,
      label: tool.plugin.manifest.Plugin.Title ?? tool.name,
      description: this.projectDescription(tool),
      parameters: this.projectParameterSchema(tool),
      executionMode: "sequential",
      execute: (toolCallId, params, signal) =>
        this.options.execution.execute({
          tool,
          toolCallId,
          params: normalizeToolParams(params),
          signal,
          context,
        }),
    };
  }

  private projectDescription(tool: RegisteredTool): string {
    const sections = resolveConfiguredToolDescriptionSections(this.options.config);
    const document = this.documentationReader.readMarkdownSections(tool.descriptionFile);
    const summary = normalizeMarkdownSectionText(document.sections.get(sections.summary));
    const trigger = normalizeMarkdownSectionText(document.sections.get(sections.trigger));
    const fallback = tool.search?.Summary ?? tool.plugin.manifest.Plugin.Description ?? "";

    return [
      summary || fallback,
      trigger,
      ...tool.permissions.map((permission) => `permission: ${permission}`),
    ].filter(Boolean).join("\n\n");
  }

  private projectParameterSchema(tool: RegisteredTool): Record<string, unknown> {
    return this.contractProjector.projectFromFile(
      tool.signatureFile,
      "arguments",
      tool.signatureType,
    )?.jsonSchema ?? { ...EmptyObjectParameterSchema };
  }
}

function normalizeToolParams(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function resolveConfiguredToolDescriptionSections(
  config: AgentSystemConfig,
) {
  const configured = config.PluginDocumentation?.ToolDescription;
  return resolveAgentPromptSections({
    summary: configured?.SummarySection,
    trigger: configured?.TriggerSection,
    avoid: configured?.AvoidSection,
  });
}
