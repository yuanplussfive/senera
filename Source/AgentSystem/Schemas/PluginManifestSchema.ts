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

const ToolSchema = z
  .object({
    Name: z.string().min(1),
    DescriptionFile: z.string().min(1).optional(),
    SignatureFile: z.string().min(1).optional(),
    Permissions: z.array(z.string()).optional(),
    Handler: ToolHandlerSchema.optional(),
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
