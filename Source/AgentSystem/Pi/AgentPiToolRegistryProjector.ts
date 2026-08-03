import { normalizeMarkdownSectionText } from "../Prompt/AgentMarkdownSections.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import { resolveAgentToolOwner } from "../Types/AgentToolOwner.js";
import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import { AgentPromptDocumentationReader } from "../Prompt/AgentPromptDocumentationReader.js";
import { resolveAgentPromptSections } from "../Prompt/AgentPromptSectionResolver.js";
import type { AgentPiToolExecutionBridge } from "./AgentPiToolExecutionBridge.js";
import type { AgentPiToolDefinition, AgentPiToolProjectionContext } from "./AgentPiTypes.js";
import { projectAgentToolInvocationSchema } from "../ToolRuntime/AgentToolExecutionPlan.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { orderToolNamesByPreference } from "../ToolRuntime/AgentToolAccessGrant.js";

export interface AgentPiToolRuntimeContractProjector {
  projectToolInvocationSchema(tool: RegisteredTool, schema: Readonly<Record<string, unknown>>): Record<string, unknown>;
  projectToolDescription(tool: RegisteredTool, description: string): string;
}

export interface AgentPiToolRegistryProjectorOptions {
  config: AgentSystemConfig;
  registry: AgentExtensionRegistry;
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
    this.documentationReader = new AgentPromptDocumentationReader();
  }

  project(context: AgentPiToolProjectionContext = {}): AgentPiToolDefinition[] {
    const toolAccessGrant = context.toolAccessGrant;
    const exposure = context.toolExposure?.snapshot();
    return this.createToolSet(
      exposure?.exposedToolNames ?? toolAccessGrant?.exposedToolNames ?? context.visibleToolNames,
      exposure?.preferredToolNames ?? toolAccessGrant?.preferredToolNames,
    ).materialize(() => context);
  }

  names(visibleToolNames?: AgentPiToolProjectionContext["visibleToolNames"]): string[] {
    return this.visibleTools(visibleToolNames).map((tool) => tool.name);
  }

  createToolSet(
    visibleToolNames?: AgentPiToolProjectionContext["visibleToolNames"],
    preferredToolNames: readonly string[] = [],
  ): AgentPiToolSet {
    const tools = this.visibleTools(visibleToolNames, preferredToolNames);
    const projections = tools.map((tool) => ({ tool, descriptor: this.projectDescriptor(tool) }));
    const descriptors = projections.map(({ descriptor }) => descriptor);
    const activeToolNames = descriptors.map((descriptor) => descriptor.name);
    const fingerprint = sha256HexOfCanonicalJson(descriptors);
    return {
      fingerprint,
      activeToolNames,
      materialize: (context) =>
        projections.map(({ tool, descriptor }) => this.materializeTool(tool, descriptor, context)),
    };
  }

  private visibleTools(
    visibleToolNames?: AgentPiToolProjectionContext["visibleToolNames"],
    preferredToolNames: readonly string[] = [],
  ): RegisteredTool[] {
    const registered = this.options.registry.listTools();
    if (!visibleToolNames) {
      return registered;
    }

    const visible = new Set(visibleToolNames);
    const byName = new Map(registered.filter((tool) => visible.has(tool.name)).map((tool) => [tool.name, tool]));
    return orderToolNamesByPreference([...byName.keys()], preferredToolNames).flatMap((toolName) => {
      const tool = byName.get(toolName);
      return tool ? [tool] : [];
    });
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
    const owner = resolveAgentToolOwner(tool);
    const staticSchema = tool.contract?.arguments?.jsonSchema ?? EmptyObjectParameterSchema;
    const runtimeSchema =
      this.options.runtimeContracts?.projectToolInvocationSchema(tool, staticSchema) ?? staticSchema;
    return Object.freeze({
      name: tool.name,
      label: owner.title ?? tool.name,
      description: this.projectDescription(tool),
      parameters: projectAgentToolInvocationSchema(tool, runtimeSchema),
      executionMode: "parallel" as const,
    });
  }

  private projectDescription(tool: RegisteredTool): string {
    const sections = resolveConfiguredToolDescriptionSections(this.options.config);
    const document = this.documentationReader.readMarkdownSections(tool.descriptionFile);
    const summary = normalizeMarkdownSectionText(document.sections.get(sections.summary));
    const trigger = normalizeMarkdownSectionText(document.sections.get(sections.trigger));
    const fallback = tool.search?.Summary ?? resolveAgentToolOwner(tool).description ?? "";

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

function resolveConfiguredToolDescriptionSections(config: AgentSystemConfig) {
  const configured = config.ToolDocumentation?.ToolDescription;
  return resolveAgentPromptSections({
    summary: configured?.SummarySection,
    trigger: configured?.TriggerSection,
    avoid: configured?.AvoidSection,
  });
}
