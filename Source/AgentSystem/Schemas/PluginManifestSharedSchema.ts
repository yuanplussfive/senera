import { z } from "zod";

export const PluginKindSchema = z.enum([
  "System",
  "Tool",
  "Resource",
  "Prompt",
  "Skill",
  "Adapter",
  "Provider",
]);

export const DecisionKindSchema = z.literal("ToolCalls");

export const PluginEntrySchema = z
  .object({
    Kind: z.literal("Process"),
    Command: z.string().min(1),
    Args: z.array(z.string()).optional(),
    Cwd: z.string().min(1).optional(),
    Env: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const DecisionActionSchema = z
  .object({
    Name: z.string().min(1),
    Kind: DecisionKindSchema,
    XmlRoot: z.string().min(1),
    Schema: z.string().min(1),
    DescriptionFile: z.string().min(1).optional(),
    SignatureFile: z.string().min(1).optional(),
    SignatureType: z.string().min(1).optional(),
  })
  .strict();

export const TemplateSchema = z
  .object({
    Name: z.string().min(1),
    Path: z.string().min(1),
  })
  .strict();

export const SecuritySchema = z
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

export const PromptingSchema = z
  .object({
    Audience: z.enum(["Model", "User", "System"]).optional(),
    Priority: z.number().optional(),
  })
  .strict();

