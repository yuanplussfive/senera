import { z } from "zod";
import { type AgentArtifactFileNames } from "../Artifacts/AgentArtifactLocator.js";
import {
  normalizeToolArrayArgument,
  normalizeToolNumberArgument,
} from "../ToolRuntime/AgentToolArgumentNormalization.js";

export const ReadableArtifactRefs = [
  "summary",
  "projection",
  "evidence",
  "delta",
  "raw",
  "rawBlob",
  "rawPreview",
  "workspaceDiff",
  "workspacePatch",
  "stdout",
  "stderr",
] as const;

export type ReadableArtifactRef = (typeof ReadableArtifactRefs)[number];

export const ReadableArtifactRefDefinitions = {
  summary: {
    file: "summary",
    format: "text",
    mediaType: "text/markdown",
  },
  projection: {
    file: "projection",
    format: "text",
    mediaType: "text/markdown",
  },
  evidence: {
    file: "evidence",
    format: "json",
    mediaType: "application/json",
  },
  delta: {
    file: "delta",
    format: "json",
    mediaType: "application/json",
  },
  raw: {
    file: "raw",
    format: "json",
    mediaType: "application/json",
  },
  rawBlob: {
    file: "raw",
    format: "text",
    mediaType: "application/json",
  },
  rawPreview: {
    file: "rawPreview",
    format: "json",
    mediaType: "application/json",
  },
  workspaceDiff: {
    file: "workspaceDiff",
    format: "json",
    mediaType: "application/json",
  },
  workspacePatch: {
    file: "workspacePatch",
    format: "text",
    mediaType: "text/x-diff",
  },
  stdout: {
    file: "stdout",
    format: "text",
    mediaType: "text/plain",
  },
  stderr: {
    file: "stderr",
    format: "text",
    mediaType: "text/plain",
  },
} as const satisfies Record<
  ReadableArtifactRef,
  {
    file: keyof typeof AgentArtifactFileNames;
    format: "json" | "text";
    mediaType: string;
  }
>;

export const ArtifactMemoryReadArgumentsSchema = z
  .object({
    artifactUris: z.preprocess(normalizeToolArrayArgument, z.array(z.string().trim().min(1)).min(1)),
    refs: z.preprocess(normalizeToolArrayArgument, z.array(z.enum(ReadableArtifactRefs)).min(1)).optional(),
    maxBytesPerRef: z.preprocess(normalizeToolNumberArgument, z.number().int().positive()).optional(),
    startBytePerRef: z.preprocess(normalizeToolNumberArgument, z.number().int().nonnegative()).optional(),
    refRanges: z
      .preprocess(
        normalizeToolArrayArgument,
        z
          .array(
            z
              .object({
                ref: z.enum(ReadableArtifactRefs),
                maxBytes: z.preprocess(normalizeToolNumberArgument, z.number().int().positive()),
                startByte: z.preprocess(normalizeToolNumberArgument, z.number().int().nonnegative()).optional(),
              })
              .strict(),
          )
          .min(1)
          .superRefine((ranges, ctx) => {
            const seen = new Set<string>();
            ranges.forEach((range, index) => {
              if (seen.has(range.ref)) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  path: [index, "ref"],
                  message: `refRanges 中不能重复指定 ${range.ref}。`,
                });
              }
              seen.add(range.ref);
            });
          }),
      )
      .optional(),
  })
  .strict();

export type ArtifactMemoryReadArguments = z.infer<typeof ArtifactMemoryReadArgumentsSchema>;

export interface ArtifactManifestRecord {
  artifactId: string;
  artifactUri: string;
  sessionId?: string;
  createdAt?: string;
  files: Record<string, string>;
  contents?: Array<{
    ref: ReadableArtifactRef;
    mediaType: string;
    byteLength: number;
    sha256: string;
  }>;
}

export interface ArtifactMemoryReadResultItem {
  artifactUri: string;
  artifactId: string;
  status: "found" | "not_found" | "invalid";
  message: string;
  availableRefs: {
    item: Array<{
      ref: ReadableArtifactRef;
      byteLength: number;
      mediaType?: string;
      sha256?: string;
    }>;
  };
  availableRefCount: number;
  refResults: {
    item: ArtifactMemoryRefReadResult[];
  };
  unavailableRefCount: number;
  oversizedRefCount: number;
  failedRefCount: number;
  memories: {
    item: Array<ArtifactMemoryContentItem>;
  };
  memoryCount: number;
}

export interface ArtifactMemoryRefReadResult {
  ref: ReadableArtifactRef;
  status: "loaded" | "unavailable" | "too_large" | "failed";
  message: string;
  sourceByteLength?: number;
  structuredJsonMaxBytes?: number;
  alternativeRef?: ReadableArtifactRef;
}

export interface ArtifactMemoryContentItem {
  ref: string;
  sourceSha256?: string;
  range: {
    startByte: number;
    endByte: number;
    totalBytes: number;
    returnedBytes: number;
    complete: boolean;
    nextStartByte?: number;
  };
  content: string;
}
