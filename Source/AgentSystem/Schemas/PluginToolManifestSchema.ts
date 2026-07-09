import { z } from "zod";
import { ToolArtifactPolicySchema } from "./PluginArtifactManifestSchema.js";
import { ToolSearchSchema } from "./PluginSearchManifestSchema.js";

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
  z
    .object({
      Kind: z.literal("McpTool"),
      Server: z.string().min(1),
      Tool: z.string().min(1),
    })
    .strict(),
]);

const ToolEvidenceCapabilitySchema = z
  .object({
    Produces: z.string().min(1),
    Quality: z.string().min(1),
    Satisfies: z.array(z.string().min(1)).optional(),
    Kinds: z.array(z.string().min(1)).optional(),
    CapabilityIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

const ToolApprovalSchema = z
  .object({
    Mode: z.enum(["allow", "ask", "deny"]),
    Reason: z.string().min(1).optional(),
  })
  .strict();

const ToolExecutionSchema = z
  .object({
    Boundary: z.enum(["Local", "Sandbox", "SandboxPreferred"]),
    Network: z.enum(["Allow", "Deny"]),
    Workspace: z.enum(["ReadOnly", "ReadWrite"]),
    LocalFallback: z.enum(["Allow", "Deny"]),
  })
  .strict();

export const ToolSchema = z
  .object({
    Name: z.string().min(1),
    DescriptionFile: z.string().min(1).optional(),
    SignatureFile: z.string().min(1).optional(),
    SignatureType: z.string().min(1).optional(),
    Permissions: z.array(z.string()).optional(),
    Handler: ToolHandlerSchema.optional(),
    Execution: ToolExecutionSchema,
    Search: ToolSearchSchema.optional(),
    EvidenceCapabilities: z.array(ToolEvidenceCapabilitySchema).optional(),
    Approval: ToolApprovalSchema.optional(),
    Artifacts: ToolArtifactPolicySchema.optional(),
    ArtifactPolicyFile: z.string().min(1).optional(),
  })
  .strict();
