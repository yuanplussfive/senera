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
  .strict();

const HostToolContributionSchema = z
  .object({
    kind: z.literal("hostTool"),
    contract: z.string().trim().min(1),
    capability: z.string().trim().min(1),
    recommendedForSkills: z.array(AgentExtensionNameSchema).default([]),
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

function isObjectJsonSchema(schema: Record<string, unknown>): boolean {
  if (schema.type === "object") return true;
  for (const keyword of ["oneOf", "anyOf"] as const) {
    const branches = schema[keyword];
    if (
      Array.isArray(branches) &&
      branches.length > 0 &&
      branches.every(
        (branch) =>
          typeof branch === "object" &&
          branch !== null &&
          !Array.isArray(branch) &&
          isObjectJsonSchema(branch as Record<string, unknown>),
      )
    ) {
      return true;
    }
  }
  return false;
}
