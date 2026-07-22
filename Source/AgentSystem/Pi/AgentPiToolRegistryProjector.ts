import crypto from "node:crypto";
import { AgentMarkdownPromptXmlRenderer } from "../Xml/AgentMarkdownPromptXmlRenderer.js";
import { normalizeMarkdownSectionText } from "../Xml/AgentMarkdownSections.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { RegisteredTool } from "../Types/PluginRuntimeTypes.js";
import type { AgentPluginRegistry } from "../Plugin/AgentPluginRegistry.js";
import { AgentPromptDocumentationReader } from "../Prompt/AgentPromptDocumentationReader.js";
import { resolveAgentPromptSections } from "../Prompt/AgentPromptSectionResolver.js";
import type { AgentPiToolExecutionBridge } from "./AgentPiToolExecutionBridge.js";
import type { AgentPiToolDefinition, AgentPiToolProjectionContext } from "./AgentPiTypes.js";
import { projectAgentToolInvocationSchema } from "../ToolRuntime/AgentToolExecutionPlan.js";

export interface AgentPiToolRuntimeContractProjector {
  projectToolInvocationSchema(tool: RegisteredTool, schema: Readonly<Record<string, unknown>>): Record<string, unknown>;
  projectToolDescription(tool: RegisteredTool, description: string): string;
}

export interface AgentPiToolRegistryProjectorOptions {
  config: AgentSystemConfig;
  registry: AgentPluginRegistry;
  execution: AgentPiToolExecutionBridge;
  runtimeContracts?: AgentPiToolRuntimeContractProjector;
}

export interface AgentPiToolSet {
  readonly fingerprint: string;
  readonly activeToolNames: readonly string[];
  materialize(context: () => AgentPiToolProjectionContext): AgentPiToolDefinition[];
}

const EmptyObjectParameterSchema = {
  type: "object",
  properties: {},
  additionalProperties: true,
} as const;

export class AgentPiToolRegistryProjector {
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
    return this.createToolSet(context.visibleToolNames).materialize(() => context);
  }

  names(visibleToolNames?: AgentPiToolProjectionContext["visibleToolNames"]): string[] {
    return this.visibleTools(visibleToolNames).map((tool) => tool.name);
  }

  createToolSet(visibleToolNames?: AgentPiToolProjectionContext["visibleToolNames"]): AgentPiToolSet {
    const tools = this.visibleTools(visibleToolNames);
    const descriptors = tools.map((tool) => this.projectDescriptor(tool));
    const activeToolNames = descriptors.map((descriptor) => descriptor.name);
    const fingerprint = crypto.createHash("sha256").update(stableSerialize(descriptors)).digest("hex");
    return {
      fingerprint,
      activeToolNames,
      materialize: (context) => tools.map((tool, index) => this.materializeTool(tool, descriptors[index]!, context)),
    };
  }

  private visibleTools(visibleToolNames: AgentPiToolProjectionContext["visibleToolNames"] = "all"): RegisteredTool[] {
    if (visibleToolNames === "all") {
      return this.options.registry.listTools();
    }

    const visible = new Set(visibleToolNames);
    return this.options.registry.listTools().filter((tool) => visible.has(tool.name));
  }

  private materializeTool(
    tool: RegisteredTool,
    descriptor: Omit<AgentPiToolDefinition, "execute">,
    context: () => AgentPiToolProjectionContext,
  ): AgentPiToolDefinition {
    return {
      ...descriptor,
      execute: (toolCallId, params, signal) =>
        this.options.execution.execute({
          tool,
          toolCallId,
          params: normalizeToolParams(params),
          signal,
          context: context(),
        }),
    };
  }

  private projectDescriptor(tool: RegisteredTool): Omit<AgentPiToolDefinition, "execute"> {
    const staticSchema = tool.contract?.arguments?.jsonSchema ?? EmptyObjectParameterSchema;
    const runtimeSchema =
      this.options.runtimeContracts?.projectToolInvocationSchema(tool, staticSchema) ?? staticSchema;
    return Object.freeze({
      name: tool.name,
      label: tool.plugin.manifest.Plugin.Title ?? tool.name,
      description: this.projectDescription(tool),
      parameters: projectAgentToolInvocationSchema(tool, runtimeSchema),
      executionMode: "sequential" as const,
    });
  }

  private projectDescription(tool: RegisteredTool): string {
    const sections = resolveConfiguredToolDescriptionSections(this.options.config);
    const document = this.documentationReader.readMarkdownSections(tool.descriptionFile);
    const summary = normalizeMarkdownSectionText(document.sections.get(sections.summary));
    const trigger = normalizeMarkdownSectionText(document.sections.get(sections.trigger));
    const fallback = tool.search?.Summary ?? tool.plugin.manifest.Plugin.Description ?? "";

    const description = [
      summary || fallback,
      trigger,
      ...tool.permissions.map((permission) => `permission: ${permission}`),
    ]
      .filter(Boolean)
      .join("\n\n");
    return this.options.runtimeContracts?.projectToolDescription(tool, description) ?? description;
  }
}

function normalizeToolParams(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function resolveConfiguredToolDescriptionSections(config: AgentSystemConfig) {
  const configured = config.PluginDocumentation?.ToolDescription;
  return resolveAgentPromptSections({
    summary: configured?.SummarySection,
    trigger: configured?.TriggerSection,
    avoid: configured?.AvoidSection,
  });
}
