import { z } from "zod";
import { AgentExtensionNameSchema } from "../Extensions/AgentExtensionIdentity.js";
import { AgentExtensionLocalizedTextSchema } from "../Extensions/AgentExtensionLocalization.js";
import {
  AgentToolDiscoverySourceSchema,
  ToolArtifactPolicySchema,
  ToolApprovalSchema,
  ToolEvidenceCapabilitySchema,
  ToolExecutionSchema,
  ToolResourceArgumentSchema,
  ToolRuntimeSchema,
  ToolSearchSchema,
} from "../Schemas/AgentToolContractSchema.js";
import { AgentToolObservationProjectionSchema } from "../Schemas/AgentToolObservationProjectionSchema.js";
import { inspectAgentToolSchedulingContract } from "../Types/AgentToolRuntimeContract.js";
import { AgentToolChildGrantModes, ToolLoadingModes } from "../Types/AgentToolContractTypes.js";
import { isObjectJsonSchema } from "../ToolContracts/AgentJsonSchemaObjectRoot.js";
import { AgentSystemExtensionPlatformSchema } from "./AgentSystemExtensionPlatform.js";

export const AgentSystemExtensionManifestFileName = "extension.json";

export const AgentSystemExtensionJsonSchema = z.record(z.string(), z.unknown());
const JsonObjectSchema = AgentSystemExtensionJsonSchema.refine(isObjectJsonSchema, {
  message: "System Tool schemas must describe a JSON object.",
});
const SystemToolDescriptionSchema = z.union([z.string().trim().min(1), AgentExtensionLocalizedTextSchema]);

export const AgentSystemToolContractSchema = z
  .object({
    name: z.string().trim().min(1),
    description: SystemToolDescriptionSchema,
    loading: z.enum([ToolLoadingModes.Bootstrap, ToolLoadingModes.Dynamic]).default(ToolLoadingModes.Bootstrap),
    inputSchema: JsonObjectSchema,
    outputSchema: AgentSystemExtensionJsonSchema.optional(),
    observationProjection: z.string().trim().min(1),
    permissions: z.array(z.string()).default([]),
    execution: ToolExecutionSchema,
    runtime: ToolRuntimeSchema,
    resources: z.array(ToolResourceArgumentSchema).default([]),
    sources: z.array(AgentToolDiscoverySourceSchema).default([]),
    search: ToolSearchSchema,
    evidenceCapabilities: z.array(ToolEvidenceCapabilitySchema).default([]),
    approval: ToolApprovalSchema.optional(),
    artifacts: ToolArtifactPolicySchema.optional(),
  })
  .strict()
  .superRefine((tool, context) => {
    if (!tool.search.Capabilities || tool.search.Capabilities.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["search", "Capabilities"],
        message: "System Tools must declare at least one capability.",
      });
    }
    if (!tool.search.UseCases || tool.search.UseCases.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["search", "UseCases"],
        message: "System Tools must declare at least one applicable use case.",
      });
    }
    if (tool.runtime.Scheduling === undefined) {
      context.addIssue({
        code: "custom",
        path: ["runtime", "Scheduling"],
        message: "System Tools must declare Runtime.Scheduling explicitly.",
      });
    }
    const issuePaths = {
      scheduling: ["runtime", "Scheduling"],
      maxConcurrency: ["runtime", "MaxConcurrency"],
      resources: ["resources"],
    } as const;
    for (const issue of inspectAgentToolSchedulingContract({
      handlerKind: "HostCapability",
      scheduling: tool.runtime.Scheduling,
      maxConcurrency: tool.runtime.MaxConcurrency,
      resourceCount: tool.resources.length,
    })) {
      context.addIssue({
        code: "custom",
        path: [...issuePaths[issue.field]],
        message: issue.message,
      });
    }
  });

const HostToolContributionSchema = z
  .object({
    kind: z.literal("hostTool"),
    contract: z.string().trim().min(1),
    capability: z.string().trim().min(1),
    recommendedForSkills: z.array(AgentExtensionNameSchema).default([]),
    childGrant: z.enum(AgentToolChildGrantModes).default(AgentToolChildGrantModes.Inherit),
  })
  .strict();

const SidecarToolContributionSchema = z
  .object({
    kind: z.literal("sidecarTool"),
    contract: z.string().trim().min(1),
    capability: z.string().trim().min(1),
  })
  .strict();

const McpServerContributionSchema = z
  .object({
    kind: z.literal("mcpServer"),
    descriptor: z.string().trim().min(1),
  })
  .strict();

const SkillContributionSchema = z
  .object({
    kind: z.literal("skill"),
    path: z.string().trim().min(1),
  })
  .strict();

export const AgentSystemExtensionManifestSchema = z
  .object({
    $schema: z.string().optional(),
    schemaVersion: z.literal(1),
    id: AgentExtensionNameSchema,
    version: z
      .string()
      .trim()
      .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u),
    displayName: AgentExtensionLocalizedTextSchema,
    description: AgentExtensionLocalizedTextSchema,
    priority: z.number().finite().optional(),
    platforms: z.array(AgentSystemExtensionPlatformSchema).min(1).optional(),
    configuration: z
      .object({
        schema: z.string().trim().min(1),
        ui: z.string().trim().min(1).optional(),
      })
      .strict()
      .optional(),
    contributions: z
      .array(
        z.discriminatedUnion("kind", [
          HostToolContributionSchema,
          SidecarToolContributionSchema,
          McpServerContributionSchema,
          SkillContributionSchema,
        ]),
      )
      .max(64)
      .optional(),
  })
  .strict();

export type AgentSystemToolContract = z.infer<typeof AgentSystemToolContractSchema>;
export const AgentSystemSidecarToolContractSchema = z
  .object({
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
    instructions: z.string().trim().min(1),
    inputSchema: JsonObjectSchema,
  })
  .strict();
export type AgentSystemSidecarToolContract = z.infer<typeof AgentSystemSidecarToolContractSchema>;
export type AgentSystemExtensionManifest = z.infer<typeof AgentSystemExtensionManifestSchema>;
export type { AgentSystemExtensionPlatform } from "./AgentSystemExtensionPlatform.js";
export type AgentSystemHostToolContribution = z.infer<typeof HostToolContributionSchema>;
export type AgentSystemSidecarToolContribution = z.infer<typeof SidecarToolContributionSchema>;
export { AgentToolObservationProjectionSchema };
