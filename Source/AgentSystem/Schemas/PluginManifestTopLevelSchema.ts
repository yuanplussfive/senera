import { z } from "zod";
import {
  PluginKindSchema,
  PluginMcpServerSchema,
  PluginSandboxSchema,
  PromptingSchema,
  SecuritySchema,
  TemplateSchema,
} from "./PluginManifestSharedSchema.js";
import { ToolSchema } from "./PluginToolManifestSchema.js";
import { SkillSchema } from "./PluginSkillManifestSchema.js";
import { RootCommandSchema } from "./PluginRootCommandManifestSchema.js";

export const PluginManifestSchema = z
  .object({
    ManifestVersion: z.literal(2),
    Contracts: z
      .object({
        File: z.string().min(1),
      })
      .strict()
      .optional(),
    Plugin: z
      .object({
        Name: z.string().min(1),
        Title: z.string().optional(),
        Version: z.string().min(1),
        Kind: PluginKindSchema,
        Description: z.string().optional(),
      })
      .strict(),
    Tools: z.array(ToolSchema).optional(),
    McpServers: z.array(PluginMcpServerSchema).optional(),
    Skills: z.array(SkillSchema).optional(),
    Resources: z.array(z.unknown()).optional(),
    Prompts: z.array(z.unknown()).optional(),
    Templates: z.array(TemplateSchema).optional(),
    RootCommands: z.array(RootCommandSchema).optional(),
    Sandbox: PluginSandboxSchema.optional(),
    Security: SecuritySchema.optional(),
    Prompting: PromptingSchema.optional(),
    XmlProtocol: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .superRefine((manifest, context) => {
    if ((manifest.Tools?.length ?? 0) > 0 && !manifest.Contracts) {
      context.addIssue({
        code: "custom",
        path: ["Contracts"],
        message: "Plugins that declare tools must provide a versioned tool contract bundle.",
      });
    }
  });
