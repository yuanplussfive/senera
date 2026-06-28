import { z } from "zod";

export const ToolSearchCapabilityFacetsSchema = z
  .object({
    Actions: z.array(z.string().min(1)).optional(),
    Targets: z.array(z.string().min(1)).optional(),
    Inputs: z.array(z.string().min(1)).optional(),
    Outputs: z.array(z.string().min(1)).optional(),
    Evidence: z.array(z.string().min(1)).optional(),
    Effects: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const ToolSearchCapabilityRiskSchema = z
  .object({
    SideEffect: z.string().min(1).optional(),
    Permission: z.string().min(1).optional(),
    Notes: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const ToolSearchCapabilitySchema = z
  .object({
    Id: z.string().min(1),
    Title: z.string().min(1).optional(),
    Description: z.string().min(1).optional(),
    Facets: ToolSearchCapabilityFacetsSchema.optional(),
    Aliases: z.array(z.string().min(1)).optional(),
    Risk: ToolSearchCapabilityRiskSchema.optional(),
    Metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const ToolSearchSchema = z
  .object({
    Summary: z.string().min(1).optional(),
    Tags: z.array(z.string().min(1)).optional(),
    Capabilities: z.array(ToolSearchCapabilitySchema).optional(),
    UseCases: z.array(z.string().min(1)).optional(),
    Examples: z.array(z.string().min(1)).optional(),
    Avoid: z.array(z.string().min(1)).optional(),
  })
  .strict();

