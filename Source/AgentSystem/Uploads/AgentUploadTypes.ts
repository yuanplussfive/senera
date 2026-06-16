import { z } from "zod";

export const AgentUploadStatus = {
  Uploaded: "uploaded",
} as const;

export const AgentUploadAttachmentSchema = z
  .object({
    uploadUri: z.string().min(1),
    name: z.string().min(1),
    mime: z.string().min(1),
    size: z.number().int().nonnegative(),
    sha256: z.string().min(1).optional(),
    status: z.literal(AgentUploadStatus.Uploaded),
  })
  .strict();

export const AgentUploadAttachmentListSchema = z.array(AgentUploadAttachmentSchema);

export type AgentUploadAttachment = z.infer<typeof AgentUploadAttachmentSchema>;

export const AgentUploadManifestSchema = z
  .object({
    uploadId: z.string().min(1),
    uploadUri: z.string().min(1),
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

export type AgentUploadManifest = z.infer<typeof AgentUploadManifestSchema>;

export interface AgentResolvedUpload {
  manifest: AgentUploadManifest;
  filePath: string;
  uploadDir: string;
}
