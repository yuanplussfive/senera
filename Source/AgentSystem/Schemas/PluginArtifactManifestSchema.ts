import { z } from "zod";

const ToolArtifactRedactionSchema = z
  .object({
    Keys: z.array(z.string().min(1)).optional(),
    Paths: z.array(z.string().min(1)).optional(),
  })
  .strict();

const ToolArtifactConditionSchema = z
  .object({
    Selector: z.string().min(1),
    Exists: z.boolean().optional(),
    Equals: z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
    ]).optional(),
    In: z.array(z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
    ])).optional(),
  })
  .strict();

const ToolArtifactEvidenceIdentitySchema = z
  .object({
    Parts: z.array(z.union([
      z.string().min(1),
      z.object({
        Slot: z.string().min(1),
        Required: z.boolean().optional(),
      }).strict(),
    ])).min(1),
  })
  .strict();

const ToolArtifactEvidenceSlotSchema = z.union([
  z.string().min(1),
  z.object({
    Selector: z.string().min(1),
    Scope: z.enum(["Record", "Root"]).optional(),
  }).strict(),
]);

const ToolArtifactEvidencePresentationSchema = z
  .object({
    Locator: z.string().min(1),
    Display: z.string().min(1),
    Label: z.string().min(1),
    Source: z.string().min(1),
  })
  .strict();

const ToolArtifactEvidenceModelProjectionSchema = z
  .object({
    Slots: z.array(z.string().min(1)).min(1),
  })
  .strict();

const ToolArtifactEvidencePlannerMemorySchema = z
  .object({
    Facts: z.array(z.string().min(1)).min(1),
    ArtifactRefs: z.array(z.string().min(1)).optional(),
  })
  .strict();

const ToolArtifactEvidenceProjectionSchema = z
  .object({
    SummaryTemplate: z.string().min(1),
    ArtifactTemplate: z.string().min(1),
  })
  .strict();

const ToolArtifactEvidenceSchema = z
  .object({
    Kind: z.string().min(1),
    Records: z.string().min(1),
    Slots: z.record(z.string(), ToolArtifactEvidenceSlotSchema),
    Identity: ToolArtifactEvidenceIdentitySchema,
    Presentation: ToolArtifactEvidencePresentationSchema,
    ModelProjection: ToolArtifactEvidenceModelProjectionSchema,
    PlannerMemory: ToolArtifactEvidencePlannerMemorySchema,
    Projection: ToolArtifactEvidenceProjectionSchema,
    Confidence: z.number().min(0).max(1),
    When: z.union([z.string().min(1), ToolArtifactConditionSchema]).optional(),
    Metadata: z.record(z.string(), ToolArtifactEvidenceSlotSchema).optional(),
  })
  .strict();

const ToolArtifactSummarySchema = z
  .object({
    Template: z.string().min(1),
    ArtifactTemplate: z.string().min(1),
  })
  .strict();

const ToolArtifactWorkspacePathSchema = z
  .object({
    Selector: z.string().min(1),
    Base: z.string().min(1).optional(),
  })
  .strict();

const ToolArtifactWorkspaceSchema = z
  .object({
    Capture: z.enum(["none", "declared"]).optional(),
    Paths: z.array(ToolArtifactWorkspacePathSchema).optional(),
    MaxFileBytes: z.number().int().min(1).optional(),
    MaxFiles: z.number().int().min(1).optional(),
    MaxDirectoryDepth: z.number().int().min(0).optional(),
    CaptureContent: z.enum(["none", "text"]).optional(),
    PatchContextLines: z.number().int().min(0),
  })
  .strict();

export const ToolArtifactPolicySchema = z
  .object({
    Redact: ToolArtifactRedactionSchema.optional(),
    Evidence: z.array(ToolArtifactEvidenceSchema).optional(),
    Summary: ToolArtifactSummarySchema.optional(),
    Workspace: ToolArtifactWorkspaceSchema.optional(),
  })
  .strict();

