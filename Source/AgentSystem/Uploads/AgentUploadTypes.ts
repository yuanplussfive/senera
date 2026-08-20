import { z } from "zod";
import { parseAgentResourceId } from "../Resources/AgentResourceUri.js";
import { AgentResourceUriSchema } from "../Resources/AgentResourceSchema.js";

export const AgentUploadStatus = {
  Uploaded: "uploaded",
} as const;

export const AgentUploadAttachmentSchema = z
  .object({
    resourceUri: AgentResourceUriSchema,
    name: z.string().min(1),
    mime: z.string().min(1),
    size: z.number().int().nonnegative(),
    sha256: z.string().min(1).optional(),
    status: z.literal(AgentUploadStatus.Uploaded),
  })
  .strict();

export const AgentUploadAttachmentListSchema = z.array(AgentUploadAttachmentSchema);

export type AgentUploadAttachment = z.infer<typeof AgentUploadAttachmentSchema>;

export const AgentResolvedUploadResourceSchema = z
  .object({
    resourceUri: AgentResourceUriSchema,
    filePath: z.string().min(1),
    name: z.string().min(1),
    mime: z.string().min(1),
    declaredMime: z.string().min(1).optional(),
    size: z.number().int().nonnegative(),
    sha256: z.string().min(1),
  })
  .strict();

export type AgentResolvedUploadResource = z.infer<typeof AgentResolvedUploadResourceSchema>;

const AgentUploadManifestShape = z
  .object({
    resourceId: z.string().min(1),
    resourceUri: AgentResourceUriSchema,
    name: z.string().min(1),
    mime: z.string().min(1),
    declaredMime: z.string().min(1).optional(),
    detectedMime: z.string().min(1).optional(),
    size: z.number().int().nonnegative(),
    sha256: z.string().min(1),
    createdAt: z.string().min(1),
    storage: z
      .object({
        fileName: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export const AgentUploadManifestSchema = AgentUploadManifestShape.superRefine((manifest, context) => {
  if (parseAgentResourceId(manifest.resourceUri) !== manifest.resourceId) {
    context.addIssue({
      code: "custom",
      path: ["resourceUri"],
      message: "resourceId must match the identifier in resourceUri.",
    });
  }
});

export type AgentUploadManifest = z.infer<typeof AgentUploadManifestSchema>;

export interface AgentResolvedUpload {
  manifest: AgentUploadManifest;
  filePath: string;
  uploadDir: string;
}
