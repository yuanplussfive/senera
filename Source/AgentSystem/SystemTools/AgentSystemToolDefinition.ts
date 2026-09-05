import { z } from "zod";
import type { AgentHostToolContext } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import type {
  AgentToolDiscoverySource,
  ToolArtifactPolicyManifest,
  ToolEvidenceCapabilityManifest,
  ToolApprovalManifest,
  ToolExecutionManifest,
  ToolResourceArgumentManifest,
  ToolRuntimeManifest,
  ToolSearchManifest,
} from "../Types/AgentToolContractTypes.js";
import type { AgentToolObservationProjectionManifest } from "../Types/AgentToolObservationProjectionTypes.js";
import type { ConfigFormDocument } from "../Config/AgentConfigFormDocument.js";
import type { AgentExtensionLocalizedText } from "../Extensions/AgentExtensionLocalization.js";
import type { AgentToolArtifactPayload } from "../Types/ToolRuntimeTypes.js";
import type { AgentSystemExtensionPlatform } from "./AgentSystemExtensionPlatform.js";

const SystemToolExecutionResultMarker = Symbol("senera.system-tool-execution-result");

/**
 * Lets a host-owned system tool keep its normal, schema-validated result
 * separate from durable artifact material. The marker is intentionally not
 * enumerable, so it can never leak into a model-facing tool result.
 */
export interface AgentSystemToolExecutionResult<TOutput> {
  readonly [SystemToolExecutionResultMarker]: true;
  readonly result: TOutput;
  readonly artifactPayload?: AgentToolArtifactPayload;
}

export function systemToolExecutionResult<TOutput>(
  result: TOutput,
  options: { readonly artifactPayload?: AgentToolArtifactPayload } = {},
): AgentSystemToolExecutionResult<TOutput> {
  return Object.defineProperty(
    {
      result,
      ...(options.artifactPayload ? { artifactPayload: options.artifactPayload } : {}),
    },
    SystemToolExecutionResultMarker,
    { value: true },
  ) as AgentSystemToolExecutionResult<TOutput>;
}

export function isSystemToolExecutionResult<TOutput>(
  value: TOutput | AgentSystemToolExecutionResult<TOutput>,
): value is AgentSystemToolExecutionResult<TOutput> {
  return (
    typeof value === "object" &&
    value !== null &&
    SystemToolExecutionResultMarker in value &&
    (value as Partial<AgentSystemToolExecutionResult<TOutput>>)[SystemToolExecutionResultMarker] === true
  );
}

export interface AgentSystemToolExtensionConfiguration {
  readonly schema: z.ZodType<Record<string, unknown>>;
  readonly ui: ConfigFormDocument<AgentExtensionLocalizedText>;
}

export interface AgentSystemToolExtensionMetadata {
  readonly name: string;
  readonly displayName: AgentExtensionLocalizedText;
  readonly description: AgentExtensionLocalizedText;
  readonly priority?: number;
  readonly platforms?: readonly AgentSystemExtensionPlatform[];
  readonly skills?: readonly string[];
  readonly configuration?: AgentSystemToolExtensionConfiguration;
}

export interface AgentSystemToolMetadata {
  readonly description: string;
  readonly permissions?: readonly string[];
  readonly execution?: ToolExecutionManifest;
  readonly runtime?: ToolRuntimeManifest;
  readonly resources?: readonly ToolResourceArgumentManifest[];
  readonly sources?: readonly AgentToolDiscoverySource[];
  readonly search?: ToolSearchManifest;
  readonly evidenceCapabilities?: readonly ToolEvidenceCapabilityManifest[];
  readonly approval?: ToolApprovalManifest;
  readonly artifacts?: ToolArtifactPolicyManifest;
  readonly observation: AgentToolObservationProjectionManifest;
}

export interface AgentSystemToolDefinition<
  TInput extends z.ZodType<Record<string, unknown>> = z.ZodType<Record<string, unknown>>,
  TOutput extends z.ZodType = z.ZodType,
> {
  readonly extension: AgentSystemToolExtensionMetadata;
  readonly metadata: AgentSystemToolMetadata;
  readonly name: string;
  readonly input: TInput;
  readonly output: TOutput;
  execute(input: z.output<TInput>, context: AgentHostToolContext): Promise<z.input<TOutput>> | z.input<TOutput>;
  /**
   * Optional artifact-aware execution path. It preserves the public execute
   * return type used by existing host-tool callers and tests.
   */
  executeWithArtifacts?(
    input: z.output<TInput>,
    context: AgentHostToolContext,
  ): Promise<AgentSystemToolExecutionResult<z.input<TOutput>>> | AgentSystemToolExecutionResult<z.input<TOutput>>;
}

export function defineSystemTool<TInput extends z.ZodType<Record<string, unknown>>, TOutput extends z.ZodType>(
  definition: AgentSystemToolDefinition<TInput, TOutput>,
): AgentSystemToolDefinition<TInput, TOutput> {
  return Object.freeze(definition);
}
