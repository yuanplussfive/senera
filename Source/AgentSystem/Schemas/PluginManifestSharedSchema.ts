import { z } from "zod";
import { ToolSearchSchema } from "./PluginSearchManifestSchema.js";

export const PluginKindSchema = z.enum(["System", "Tool", "Resource", "Prompt", "Skill", "Adapter", "Provider"]);

export const PluginEntrySchema = z
  .object({
    Kind: z.literal("Process"),
    Command: z.string().min(1),
    Args: z.array(z.string()).optional(),
    Cwd: z.string().min(1).optional(),
    Env: z.record(z.string(), z.string()).optional(),
  })
  .strict();

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

export const PluginRuntimeSchema = z
  .object({
    Kind: z.literal("Node"),
    NodeVersion: z.string().min(1),
    PackageManager: z.enum(["npm"]),
    Install: z.enum(["none", "install", "ci"]).optional(),
    Script: z.string().min(1),
    SandboxProfile: z.string().min(1),
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
