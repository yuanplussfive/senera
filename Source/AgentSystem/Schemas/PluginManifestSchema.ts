import { z } from "zod";

const PluginKindSchema = z.enum([
  "System",
  "Tool",
  "Resource",
  "Prompt",
  "Skill",
  "Adapter",
  "Provider",
]);

const DecisionKindSchema = z.literal("ToolCalls");

const PluginEntrySchema = z
  .object({
    Kind: z.literal("Process"),
    Command: z.string().min(1),
    Args: z.array(z.string()).optional(),
    Cwd: z.string().min(1).optional(),
    Env: z.record(z.string(), z.string()).optional(),
  })
  .strict();

const ToolHandlerSchema = z.discriminatedUnion("Kind", [
  z
    .object({
      Kind: z.literal("PluginProcess"),
    })
    .strict(),
  z
    .object({
      Kind: z.literal("HostCapability"),
      Capability: z.string().min(1),
    })
    .strict(),
]);

const ToolSearchCapabilityFacetsSchema = z
  .object({
    Actions: z.array(z.string().min(1)).optional(),
    Targets: z.array(z.string().min(1)).optional(),
    Inputs: z.array(z.string().min(1)).optional(),
    Outputs: z.array(z.string().min(1)).optional(),
    Evidence: z.array(z.string().min(1)).optional(),
    Effects: z.array(z.string().min(1)).optional(),
  })
  .strict();

const ToolSearchCapabilityRiskSchema = z
  .object({
    SideEffect: z.string().min(1).optional(),
    Permission: z.string().min(1).optional(),
    Notes: z.array(z.string().min(1)).optional(),
  })
  .strict();

const ToolSearchCapabilitySchema = z
  .object({
    Id: z.string().min(1),
    Title: z.string().min(1).optional(),
    Description: z.string().min(1).optional(),
    Facets: ToolSearchCapabilityFacetsSchema.optional(),
    Aliases: z.array(z.string().min(1)).optional(),
    Examples: z.array(z.string().min(1)).optional(),
    Avoid: z.array(z.string().min(1)).optional(),
    Risk: ToolSearchCapabilityRiskSchema.optional(),
    Metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const ToolSearchSchema = z
  .object({
    Summary: z.string().min(1).optional(),
    Keywords: z.array(z.string().min(1)).optional(),
    Capabilities: z.array(ToolSearchCapabilitySchema).optional(),
    UseCases: z.array(z.string().min(1)).optional(),
    Examples: z.array(z.string().min(1)).optional(),
    Avoid: z.array(z.string().min(1)).optional(),
  })
  .strict();

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
    RefPrefix: z.string().min(1),
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

const ToolSchema = z
  .object({
    Name: z.string().min(1),
    DescriptionFile: z.string().min(1).optional(),
    SignatureFile: z.string().min(1).optional(),
    Permissions: z.array(z.string()).optional(),
    Handler: ToolHandlerSchema.optional(),
    Search: ToolSearchSchema.optional(),
    Artifacts: ToolArtifactPolicySchema.optional(),
    ArtifactPolicyFile: z.string().min(1).optional(),
  })
  .strict();

const DecisionActionSchema = z
  .object({
    Name: z.string().min(1),
    Kind: DecisionKindSchema,
    XmlRoot: z.string().min(1),
    Schema: z.string().min(1),
    DescriptionFile: z.string().min(1).optional(),
    SignatureFile: z.string().min(1).optional(),
  })
  .strict();

const TemplateSchema = z
  .object({
    Name: z.string().min(1),
    Path: z.string().min(1),
  })
  .strict();

const SecuritySchema = z
  .object({
    TrustLevel: z.enum(["System", "Local", "External", "Untrusted"]).optional(),
    Network: z.enum(["Allow", "Deny"]).optional(),
    FileSystem: z
      .object({
        Read: z.array(z.string()).optional(),
        Write: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    RequiresApproval: z.boolean().optional(),
  })
  .strict();

const PromptingSchema = z
  .object({
    Audience: z.enum(["Model", "User", "System"]).optional(),
    Priority: z.number().optional(),
  })
  .strict();

export const PluginManifestSchema = z
  .object({
    Plugin: z
      .object({
        Name: z.string().min(1),
        Title: z.string().optional(),
        Version: z.string().min(1),
        Kind: PluginKindSchema,
        Description: z.string().optional(),
        Entry: PluginEntrySchema.optional(),
      })
      .strict(),
    Compatibility: z.record(z.string(), z.unknown()).optional(),
    Discovery: z
      .object({
        Tags: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    DecisionActions: z.array(DecisionActionSchema).optional(),
    Tools: z.array(ToolSchema).optional(),
    Resources: z.array(z.unknown()).optional(),
    Prompts: z.array(z.unknown()).optional(),
    Templates: z.array(TemplateSchema).optional(),
    Security: SecuritySchema.optional(),
    Prompting: PromptingSchema.optional(),
    XmlProtocol: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
