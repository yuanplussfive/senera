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
import { resolveAvailableAgentToolExecutionTargets } from "../ToolRuntime/AgentToolExecutionPlan.js";
import type { ToolExecutionTarget } from "../Types/AgentToolContractTypes.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { orderToolNamesByPreference } from "../ToolRuntime/AgentToolAccessGrant.js";
import { ensureObjectRootJsonSchema } from "../ToolContracts/AgentJsonSchemaObjectRoot.js";
import { ToolLoadingModes } from "../Types/AgentToolContractTypes.js";
import type { AgentModelToolPlanningMode } from "../ModelEndpoints/AgentModelEndpointContract.js";
import { isAgentToolExposureMutationMetaToolName } from "../ToolSearch/AgentToolSearchRuntimeTypes.js";
import { AgentPiNativeToolBridge } from "./AgentPiNativeToolBridge.js";
import type { AgentToolAccessGrant } from "../ToolRuntime/AgentToolAccessGrant.js";
import type { AgentPiToolCallPreflightInput } from "./AgentPiToolCallPreflight.js";
import { projectAgentToolDescription } from "../ToolRuntime/AgentToolInteractionProjector.js";

export interface AgentPiToolRuntimeContractProjector {
  projectToolInvocationSchema(tool: RegisteredTool, schema: Readonly<Record<string, unknown>>): Record<string, unknown>;
  projectToolDescription(tool: RegisteredTool, description: string): string;
}

export interface AgentPiToolRegistryProjectorOptions {
  config: AgentSystemConfig;
  registry: AgentExtensionRegistry;
  execution: AgentPiToolExecutionBridge;
  toolPlanningMode: AgentModelToolPlanningMode;
  runtimeContracts?: AgentPiToolRuntimeContractProjector;
  availableExecutionTargets?: () => readonly ToolExecutionTarget[];
}

export interface AgentPiToolSet {
  readonly fingerprint: string;
  readonly activeToolNames: readonly string[];
  materialize(context: () => AgentPiToolProjectionContext): AgentPiToolDefinition[];
}

export interface AgentPiToolPreflightProjection {
  readonly event: AgentPiToolCallPreflightInput;
  readonly bridged: boolean;
}

const EmptyObjectParameterSchema = {
  type: "object",
  properties: {},
  additionalProperties: true,
} as const;

export class AgentPiToolRegistryProjector {
  private readonly documentationReader: AgentPromptDocumentationReader;
  private readonly nativeBridge: AgentPiNativeToolBridge;

  constructor(private readonly options: AgentPiToolRegistryProjectorOptions) {
    this.documentationReader = new AgentPromptDocumentationReader();
    this.nativeBridge = new AgentPiNativeToolBridge(options.registry, options.execution);
  }

  project(context: AgentPiToolProjectionContext = {}): AgentPiToolDefinition[] {
    const toolAccessGrant = context.toolAccessGrant;
    const exposure = context.toolExposure?.snapshot();
    const visibleToolNames =
      this.options.toolPlanningMode === "native"
        ? toolAccessGrant?.authorizedToolNames
        : (exposure?.exposedToolNames ?? toolAccessGrant?.exposedToolNames);
    return this.createToolSet(
      visibleToolNames ?? context.visibleToolNames,
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
    const runtimeTargets = this.options.availableExecutionTargets?.() ?? ["Sandbox", "Local"];
    const tools = this.visibleTools(visibleToolNames, preferredToolNames, runtimeTargets).filter((tool) =>
      this.options.toolPlanningMode === "native"
        ? tool.loading === ToolLoadingModes.Bootstrap && !isAgentToolExposureMutationMetaToolName(tool.name)
        : true,
    );
    const projections = tools.map((tool) => ({ tool, descriptor: this.projectDescriptor(tool, runtimeTargets) }));
    const bridgeEnabled = this.options.toolPlanningMode === "native";
    const bridgeDescriptor = bridgeEnabled ? this.nativeBridge.definition(() => ({})) : undefined;
    const descriptors = [
      ...projections.map(({ descriptor }) => descriptor),
      ...(bridgeDescriptor ? [stripToolExecutor(bridgeDescriptor)] : []),
    ];
    const activeToolNames = descriptors.map((descriptor) => descriptor.name);
    const fingerprint = sha256HexOfCanonicalJson(descriptors);
    return {
      fingerprint,
      activeToolNames,
      materialize: (context) => [
        ...projections.map(({ tool, descriptor }) => this.materializeTool(tool, descriptor, context)),
        ...(bridgeEnabled ? [this.nativeBridge.definition(context)] : []),
      ],
    };
  }

  projectPreflight(
    event: AgentPiToolCallPreflightInput,
    toolAccessGrant: AgentToolAccessGrant,
  ): AgentPiToolPreflightProjection {
    if (this.options.toolPlanningMode !== "native") return { event, bridged: false };
    const projected = this.nativeBridge.projectPreflight(event, toolAccessGrant);
    return { event: projected, bridged: projected !== event };
  }

  private visibleTools(
    visibleToolNames?: AgentPiToolProjectionContext["visibleToolNames"],
    preferredToolNames: readonly string[] = [],
    runtimeTargets: readonly ToolExecutionTarget[] = ["Sandbox", "Local"],
  ): RegisteredTool[] {
    const registered = this.options.registry
      .listTools()
      .filter((tool) => resolveAvailableAgentToolExecutionTargets(tool, runtimeTargets).length > 0);
    if (!visibleToolNames) {
      return this.options.toolPlanningMode === "native"
        ? registered.slice().sort((left, right) => left.name.localeCompare(right.name))
        : registered;
    }

    const visible = new Set(visibleToolNames);
    const byName = new Map(registered.filter((tool) => visible.has(tool.name)).map((tool) => [tool.name, tool]));
    if (this.options.toolPlanningMode === "native") {
      return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
    }
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

  private projectDescriptor(
    tool: RegisteredTool,
    runtimeTargets: readonly ToolExecutionTarget[],
  ): Omit<AgentPiToolDefinition, "execute"> {
    const owner = resolveAgentToolOwner(tool);
    const staticSchema = tool.contract?.arguments?.jsonSchema ?? EmptyObjectParameterSchema;
    const runtimeSchema =
      this.options.runtimeContracts?.projectToolInvocationSchema(tool, staticSchema) ?? staticSchema;
    const parameters = ensureObjectRootJsonSchema(runtimeSchema, `Tool ${tool.name} input`);
    return Object.freeze({
      name: tool.name,
      label: owner.title ?? tool.name,
      description: this.projectDescription(tool),
      parameters: projectAgentToolInvocationSchema(tool, parameters, runtimeTargets),
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
    const semanticDescription = projectAgentToolDescription(tool, description);
    return this.options.runtimeContracts?.projectToolDescription(tool, semanticDescription) ?? semanticDescription;
  }
}

function stripToolExecutor(tool: AgentPiToolDefinition): Omit<AgentPiToolDefinition, "execute"> {
  const { execute: _execute, ...descriptor } = tool;
  return descriptor;
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
