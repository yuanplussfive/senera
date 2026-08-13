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
import { AgentToolChildGrantModes } from "../Types/AgentToolContractTypes.js";
import { isObjectJsonSchema } from "../ToolContracts/AgentJsonSchemaObjectRoot.js";

export const AgentSystemExtensionManifestFileName = "extension.json";

export const AgentSystemExtensionJsonSchema = z.record(z.string(), z.unknown());
const JsonObjectSchema = AgentSystemExtensionJsonSchema.refine(isObjectJsonSchema, {
  message: "System Tool schemas must describe a JSON object.",
});

export const AgentSystemToolContractSchema = z
  .object({
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
    inputSchema: JsonObjectSchema,
    outputSchema: AgentSystemExtensionJsonSchema.optional(),
    observationProjection: z.string().trim().min(1),
    permissions: z.array(z.string()).default([]),
    execution: ToolExecutionSchema,
    runtime: ToolRuntimeSchema,
    resources: z.array(ToolResourceArgumentSchema).default([]),
    sources: z.array(AgentToolDiscoverySourceSchema).default([]),
    search: ToolSearchSchema.optional(),
    evidenceCapabilities: z.array(ToolEvidenceCapabilitySchema).default([]),
    approval: ToolApprovalSchema.optional(),
    artifacts: ToolArtifactPolicySchema.optional(),
  })
  .strict()
  .superRefine((tool, context) => {
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
          McpServerContributionSchema,
          SkillContributionSchema,
        ]),
      )
      .min(1),
  })
  .strict();

export type AgentSystemToolContract = z.infer<typeof AgentSystemToolContractSchema>;
export type AgentSystemExtensionManifest = z.infer<typeof AgentSystemExtensionManifestSchema>;
export type AgentSystemHostToolContribution = z.infer<typeof HostToolContributionSchema>;
export { AgentToolObservationProjectionSchema };
