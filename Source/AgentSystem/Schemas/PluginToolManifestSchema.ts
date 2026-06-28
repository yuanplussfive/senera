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

export const ToolSchema = z
  .object({
    Name: z.string().min(1),
    DescriptionFile: z.string().min(1).optional(),
    SignatureFile: z.string().min(1).optional(),
    SignatureType: z.string().min(1).optional(),
    Permissions: z.array(z.string()).optional(),
    Handler: ToolHandlerSchema.optional(),
    Search: ToolSearchSchema.optional(),
    EvidenceCapabilities: z.array(ToolEvidenceCapabilitySchema).optional(),
    Artifacts: ToolArtifactPolicySchema.optional(),
    ArtifactPolicyFile: z.string().min(1).optional(),
  })
  .strict();

