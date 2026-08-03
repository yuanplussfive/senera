import { z } from "zod";
import type { AgentHostToolContext } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import type {
  AgentToolDiscoverySource,
  ToolArtifactPolicyManifest,
  ToolEvidenceCapabilityManifest,
  ToolExecutionManifest,
  ToolResourceArgumentManifest,
  ToolRuntimeManifest,
  ToolSearchManifest,
} from "../Types/AgentToolContractTypes.js";
import type { AgentToolObservationProjectionManifest } from "../Types/AgentToolObservationProjectionTypes.js";
import type { ConfigFormDocument } from "../Config/AgentConfigFormDocument.js";
import type { AgentExtensionLocalizedText } from "../Extensions/AgentExtensionLocalization.js";

export interface AgentSystemToolExtensionConfiguration {
  readonly schema: z.ZodType<Record<string, unknown>>;
  readonly ui: ConfigFormDocument<AgentExtensionLocalizedText>;
}

export interface AgentSystemToolExtensionMetadata {
  readonly name: string;
  readonly displayName: AgentExtensionLocalizedText;
  readonly description: AgentExtensionLocalizedText;
  readonly priority?: number;
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
}

export function defineSystemTool<TInput extends z.ZodType<Record<string, unknown>>, TOutput extends z.ZodType>(
  definition: AgentSystemToolDefinition<TInput, TOutput>,
): AgentSystemToolDefinition<TInput, TOutput> {
  return Object.freeze(definition);
}
