import { z } from "zod";
import { ToolSearchSchema } from "./PluginSearchManifestSchema.js";

const SkillEvidenceRequirementSchema = z
  .object({
    Need: z.string().min(1),
    Accepts: z.array(z.string().min(1)).min(1),
    MinimumQuality: z.array(z.string().min(1)).optional(),
    Minimum: z.number().int().min(1).optional(),
    Purpose: z.string().min(1).optional(),
  })
  .strict();

export const SkillSchema = z
  .object({
    Name: z.string().min(1),
    Title: z.string().min(1).optional(),
    DescriptionFile: z.string().min(1),
    WorkflowFile: z.string().min(1).optional(),
    RecommendedTools: z.array(z.string().min(1)).optional(),
    RecommendedAgents: z.array(z.string().min(1)).optional(),
    RecommendedWorkflows: z.array(z.string().min(1)).optional(),
    EvidenceRequirements: z.array(SkillEvidenceRequirementSchema).optional(),
    Search: ToolSearchSchema.optional(),
  })
  .strict();

