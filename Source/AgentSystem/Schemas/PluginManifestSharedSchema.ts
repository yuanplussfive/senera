import { z } from "zod";
import { ToolSearchSchema } from "./PluginSearchManifestSchema.js";

export const PluginKindSchema = z.enum(["System", "Tool", "Resource", "Prompt", "Skill", "Adapter", "Provider"]);

export const PluginDiscoverySourceSchema = z
  .object({
    Id: z
      .string()
      .regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u, "Discovery source ids must use lowercase dot or kebab notation."),
    Title: z.string().trim().min(1),
    Description: z.string().trim().min(1),
  })
  .strict();

export const PluginDiscoverySchema = z
  .object({
    Sources: z.array(PluginDiscoverySourceSchema).min(1),
  })
  .strict()
  .superRefine((discovery, context) => {
    const seen = new Set<string>();
    discovery.Sources.forEach((source, index) => {
      if (seen.has(source.Id)) {
        context.addIssue({
          code: "custom",
          path: ["Sources", index, "Id"],
          message: `Discovery source ${source.Id} may only be declared once per plugin.`,
        });
      }
      seen.add(source.Id);
    });
  });

export const PluginMcpServerSchema = z
  .object({
    Id: z.string().min(1),
    Transport: z.literal("stdio"),
    Command: z.string().min(1),
    Args: z.array(z.string()).optional(),
    Cwd: z.string().min(1).optional(),
    Env: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const PluginSandboxSchema = z
  .object({
    Network: z.enum(["Allow", "Deny"]).optional(),
    Workspace: z
      .object({
        Read: z.array(z.string()).optional(),
        Write: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    State: z
      .object({
        Write: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const TemplateSchema = z
  .object({
    Name: z.string().min(1),
    Path: z.string().min(1),
    Description: z.string().min(1).optional(),
    ExposeToPi: z.boolean().optional(),
    Search: ToolSearchSchema.optional(),
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
