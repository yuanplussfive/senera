import { normalizeMarkdownSectionText } from "../Prompt/AgentMarkdownSections.js";
import { createAgentPiToolComposition } from "./AgentPiToolComposition.js";
import type { AgentToolSearchRuntime } from "../ToolSearch/AgentToolSearchRuntime.js";
import { isAgentToolComposable } from "../ToolRuntime/AgentToolCompositionPolicy.js";
import { isDeepStrictEqual } from "node:util";
import { getCurrentTools, type Context } from "@earendil-works/pi-ai";
import { confirmAgentPiDeliveredToolContracts } from "./AgentPiToolContractDelivery.js";
import type { AgentToolExposureState } from "../ToolRuntime/AgentToolExposureState.js";
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
import {
  createAgentToolExecutionDigest,
  projectAgentToolExecutionIdentity,
} from "../ToolContracts/AgentToolContractIdentity.js";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import { orderToolNamesByPreference, resolveAgentToolGrantNames } from "../ToolRuntime/AgentToolAccessGrant.js";
import { isAgentToolExecutable } from "../ToolRuntime/AgentToolAvailability.js";
import { ensureObjectRootJsonSchema } from "../ToolContracts/AgentJsonSchemaObjectRoot.js";
import type { AgentModelToolPlanningMode } from "../ModelEndpoints/AgentModelEndpointContract.js";
import { AgentPiNativeToolBridge } from "./AgentPiNativeToolBridge.js";
import type { AgentToolAccessGrant } from "../ToolRuntime/AgentToolAccessGrant.js";
import type { AgentPiToolCallPreflightInput } from "./AgentPiToolCallPreflight.js";
import { projectAgentToolDescription } from "../ToolRuntime/AgentToolInteractionProjector.js";
import { projectAgentToolCapabilityArguments } from "../ToolSearch/AgentToolCapabilityArgumentProjection.js";
import { isAgentToolAvailableForInteraction } from "../ToolRuntime/AgentToolInteractionAvailability.js";
import {
  isAgentToolDirectlyInvocable,
  isAgentToolSupportedByPlanningMode,
} from "../ToolRuntime/AgentToolInvocationRouting.js";

export interface AgentPiToolRuntimeContractProjector {
  projectToolInvocationSchema(tool: RegisteredTool, schema: Readonly<Record<string, unknown>>): Record<string, unknown>;
  projectToolDescription(tool: RegisteredTool, description: string): string;
}

export interface AgentPiToolRegistryProjectorOptions {
  config: AgentSystemConfig;
  registry: AgentExtensionRegistry;
  execution: AgentPiToolExecutionBridge;
  toolSearch?: Pick<AgentToolSearchRuntime, "discoverAvailable">;
  toolPlanningMode: AgentModelToolPlanningMode;
  runtimeContracts?: AgentPiToolRuntimeContractProjector;
  availableExecutionTargets?: () => readonly ToolExecutionTarget[];
}

export interface AgentPiToolSet {
  readonly fingerprint: string;
  readonly activeToolNames: readonly string[];
  materialize(context: () => AgentPiToolProjectionContext): AgentPiToolDefinition[];
  refresh(): AgentPiToolSet;
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
    this.nativeBridge = new AgentPiNativeToolBridge(
      options.registry,
      options.execution,
      options.toolPlanningMode,
      () => options.availableExecutionTargets?.() ?? ["Sandbox", "Local"],
    );
  }

  project(context: AgentPiToolProjectionContext = {}): AgentPiToolDefinition[] {
    const toolAccessGrant = context.toolAccessGrant;
    const exposure = context.toolExposure?.snapshot();
    const visibleToolNames =
      this.options.toolPlanningMode === "native"
        ? toolAccessGrant
          ? resolveAgentToolGrantNames(toolAccessGrant, this.options.registry.listTools())
          : undefined
        : (exposure?.exposedToolNames ?? toolAccessGrant?.exposedToolNames);
    return this.createToolSet(
      visibleToolNames ?? context.visibleToolNames,
      exposure?.preferredToolNames ?? toolAccessGrant?.preferredToolNames,
      context.interaction,
      context.nativeToolNames,
    ).materialize(() => context);
  }

  names(visibleToolNames?: AgentPiToolProjectionContext["visibleToolNames"]): string[] {
    return this.visibleTools(visibleToolNames).map((tool) => tool.name);
  }

  synchronizeContractEvidence(context: Context, exposure: AgentToolExposureState): void {
    const targets = this.options.availableExecutionTargets?.() ?? ["Sandbox", "Local"];
    exposure.clearConfirmedContracts();
    confirmAgentPiDeliveredToolContracts(context, this.options.registry, exposure, targets);
    for (const descriptor of getCurrentTools(context.messages)) {
      const tool = this.options.registry.getTool(descriptor.name);
      if (!tool) continue;
      const current = this.projectDescriptor(tool, targets);
      if (
        descriptor.description === current.description &&
        isDeepStrictEqual(descriptor.parameters, current.parameters)
      )
        exposure.confirmContract(tool.name, tool.contract?.digest);
    }
  }

  createToolSet(
    visibleToolNames?: AgentPiToolProjectionContext["visibleToolNames"],
    preferredToolNames: readonly string[] = [],
    interaction?: AgentPiToolProjectionContext["interaction"],
    nativeToolNames: readonly string[] = [],
  ): AgentPiToolSet {
    const runtimeTargets = this.options.availableExecutionTargets?.() ?? ["Sandbox", "Local"];
    const selected = new Set(nativeToolNames);
    const candidates = this.visibleTools(visibleToolNames, preferredToolNames, runtimeTargets, interaction).filter(
      (tool) =>
        this.options.toolPlanningMode !== "native" || isAgentToolDirectlyInvocable(tool) || selected.has(tool.name),
    );
    return this.projectToolSet(candidates, runtimeTargets, nativeToolNames, () =>
      this.createToolSet(visibleToolNames, preferredToolNames, interaction, nativeToolNames),
    );
  }

  /** Registration is a runtime catalog; per-turn exposure and authorization remain separate. */
  createRegisteredToolSet(nativeToolNames: readonly string[] = []): AgentPiToolSet {
    const runtimeTargets = this.options.availableExecutionTargets?.() ?? ["Sandbox", "Local"];
    const tools = this.registerableTools(runtimeTargets);
    if (this.options.toolPlanningMode === "native") tools.sort((left, right) => left.name.localeCompare(right.name));
    return this.projectToolSet(
      tools,
      runtimeTargets,
      nativeToolNames,
      () => this.createRegisteredToolSet(nativeToolNames),
      true,
    );
  }

  private projectToolSet(
    candidates: readonly RegisteredTool[],
    runtimeTargets: readonly ToolExecutionTarget[],
    nativeToolNames: readonly string[],
    refresh: () => AgentPiToolSet,
    registerAll = false,
  ): AgentPiToolSet {
    const nativeToolNameSet = new Set(nativeToolNames);
    const projections = candidates.map((tool) => ({
      tool,
      descriptor: {
        ...this.projectDescriptor(tool, runtimeTargets),
        ...(!isAgentToolComposable(tool)
          ? { exposure: "model-only" as const }
          : registerAll && !isAgentToolDirectlyInvocable(tool) && !nativeToolNameSet.has(tool.name)
            ? { exposure: "deferred" as const }
            : {}),
      },
    }));
    const bridgeEnabled = this.options.toolPlanningMode === "native";
    const bridgeDescriptor = bridgeEnabled ? this.nativeBridge.definition(() => ({})) : undefined;
    const descriptors = [
      ...projections.map(({ descriptor }) => descriptor),
      ...(bridgeDescriptor ? [stripToolExecutor(bridgeDescriptor)] : []),
    ];
    const activeToolNames = descriptors
      .filter((descriptor) => descriptor.exposure !== "deferred")
      .map((descriptor) => descriptor.name);
    // The provider descriptor is deliberately smaller than the execution
    // contract. Keep the latter in the session fingerprint without exposing
    // resource claims, handlers, or policy metadata to the model. Otherwise a
    // hot-reloaded resource declaration can leave an existing Pi session
    // running a stale closure while its public schema still looks identical.
    const executionContracts = projections.map(({ tool }) => projectAgentToolExecutionIdentity(tool));
    const invocationDescriptors = descriptors.map(({ label: _label, ...descriptor }) => descriptor);
    const fingerprint = sha256HexOfCanonicalJson({ descriptors: invocationDescriptors, executionContracts });
    return {
      fingerprint,
      activeToolNames,
      refresh,
      materialize: (context) => [
        ...projections.map(({ tool, descriptor }) => this.materializeTool(tool, descriptor, context)),
        ...(bridgeEnabled ? [this.nativeBridge.definition(context)] : []),
      ],
    };
  }

  projectPreflight(
    event: AgentPiToolCallPreflightInput,
    toolAccessGrant: AgentToolAccessGrant,
    reusableCapabilities?: AgentPiToolProjectionContext["reusableCapabilities"],
    toolExposure?: AgentPiToolProjectionContext["toolExposure"],
  ): AgentPiToolPreflightProjection {
    if (this.options.toolPlanningMode === "native") {
      const projected = this.nativeBridge.projectPreflight(event, toolAccessGrant, reusableCapabilities, toolExposure);
      return { event: projected, bridged: projected !== event };
    }
    const tool = this.options.registry.getTool(event.toolName);
    if (!tool) return { event, bridged: false };
    return {
      event: {
        ...event,
        input: projectAgentToolCapabilityArguments(tool, event.input, reusableCapabilities),
      },
      bridged: false,
    };
  }

  private visibleTools(
    visibleToolNames?: AgentPiToolProjectionContext["visibleToolNames"],
    preferredToolNames: readonly string[] = [],
    runtimeTargets: readonly ToolExecutionTarget[] = ["Sandbox", "Local"],
    interaction?: AgentPiToolProjectionContext["interaction"],
  ): RegisteredTool[] {
    const registered = this.registerableTools(runtimeTargets).filter((tool) =>
      isAgentToolAvailableForInteraction(tool, interaction),
    );
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

  private registerableTools(runtimeTargets: readonly ToolExecutionTarget[]): RegisteredTool[] {
    return this.options.registry
      .listTools()
      .filter((tool) => isAgentToolSupportedByPlanningMode(tool, this.options.toolPlanningMode))
      .filter(isAgentToolExecutable)
      .filter((tool) => resolveAvailableAgentToolExecutionTargets(tool, runtimeTargets).length > 0);
  }

  private materializeTool(
    registered: RegisteredTool,
    descriptor: Omit<AgentPiToolDefinition, "execute">,
    context: () => AgentPiToolProjectionContext,
  ): AgentPiToolDefinition {
    const executionDigest = createAgentToolExecutionDigest(registered);
    return {
      ...descriptor,
      execute: async (toolCallId, params, signal, _onUpdate, execution) => {
        const tool = this.options.registry.getTool(registered.name);
        if (!tool || createAgentToolExecutionDigest(tool) !== executionDigest)
          throw new AgentLocalizedError("tool.catalogRevisionChanged", { toolName: registered.name });
        const projectionContext = context();
        const composition =
          tool.runtime.Composition === "orchestrator"
            ? execution &&
              createAgentPiToolComposition(this.options.registry, projectionContext, execution, this.options.toolSearch)
            : undefined;
        if (tool.runtime.Composition === "orchestrator" && !composition)
          throw new Error("Tool composition requires a Pi session execution context.");
        const closeComposition = composition
          ? projectionContext.turnState?.openToolComposition(
              toolCallId,
              composition.tools.map((entry) => entry.name),
              composition.signal,
            )
          : undefined;
        try {
          return await this.options.execution.execute({
            tool,
            toolCallId,
            params: projectAgentToolCapabilityArguments(
              tool,
              normalizeToolParams(params),
              projectionContext.reusableCapabilities,
            ),
            signal,
            context: projectionContext,
            composition,
          });
        } finally {
          closeComposition?.();
        }
      },
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
    const fallback = tool.description ?? tool.search?.Summary ?? resolveAgentToolOwner(tool).description ?? "";

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
