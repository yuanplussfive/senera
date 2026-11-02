import { z } from "zod";
import { parseAgentResourceId } from "../Resources/AgentResourceUri.js";
import { AgentResourceUriSchema } from "../Resources/AgentResourceSchema.js";
import { AgentUploadFileNames } from "./AgentUploadLocator.js";

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

const AgentUploadImageAnalysisDigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);

/** Codecs emitted by the local static-image normalizer. */
export const AgentUploadImageAnalysisMimeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);

export type AgentUploadImageAnalysisMime = z.infer<typeof AgentUploadImageAnalysisMimeSchema>;

const AgentUploadImageAnalysisExtensions = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const satisfies Record<AgentUploadImageAnalysisMime, string>;

/**
 * Content-addressed derivative names make a completed manifest point only at
 * complete bytes.
 */
export function createAgentUploadImageAnalysisFileName(input: {
  readonly policyKey: string;
  readonly sha256: string;
  readonly mime: AgentUploadImageAnalysisMime;
}): string {
  return `${AgentUploadFileNames.AnalysisDirectory}/${input.policyKey}-${input.sha256}.${AgentUploadImageAnalysisExtensions[input.mime]}`;
}

export const AgentUploadImageAnalysisAssetSchema = z
  .object({
    policyRevision: z.string().min(1),
    policyKey: AgentUploadImageAnalysisDigestSchema,
    sourceSha256: AgentUploadImageAnalysisDigestSchema,
    fileName: z.string().min(1),
    mime: AgentUploadImageAnalysisMimeSchema,
    size: z.number().int().positive(),
    sha256: AgentUploadImageAnalysisDigestSchema,
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((asset, context) => {
    const canonical = createAgentUploadImageAnalysisFileName(asset);
    if (asset.fileName !== canonical) {
      context.addIssue({
        code: "custom",
        path: ["fileName"],
        message: "imageAnalysis.fileName must identify a cache asset under the analysis directory.",
      });
    }
  });

export type AgentUploadImageAnalysisAsset = z.infer<typeof AgentUploadImageAnalysisAssetSchema>;

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
    retention: z.literal("persistent").optional(),
    owner: z
      .object({
        sessionId: z.string().min(1),
        requestId: z.string().min(1),
      })
      .strict()
      .optional(),
    storage: z
      .object({
        fileName: z.string().min(1),
      })
      .strict(),
    /** Model-facing cache entries; the original file remains canonical. */
    imageAnalysis: z.array(AgentUploadImageAnalysisAssetSchema).optional(),
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
