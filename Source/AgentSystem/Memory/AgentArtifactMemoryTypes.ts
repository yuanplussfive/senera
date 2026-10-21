import { z } from "zod";
import { AgentToolExecutionOutcomeSchema } from "../ToolRuntime/AgentToolResultOutcome.js";
import { type AgentArtifactFileNames, parseAgentArtifactUri } from "../Artifacts/AgentArtifactLocator.js";

export const ReadableArtifactRefs = [
  "summary",
  "projection",
  "evidence",
  "delta",
  "raw",
  "rawResponse",
  "rawBlob",
  "rawPreview",
  "workspaceDiff",
  "workspacePatch",
  "stdout",
  "stderr",
] as const;

export type ReadableArtifactRef = (typeof ReadableArtifactRefs)[number];

export const ReadableArtifactRefDefinitions = {
  summary: { file: "summary", mediaType: "text/markdown" },
  projection: { file: "projection", mediaType: "text/markdown" },
  evidence: { file: "evidence", mediaType: "application/json" },
  delta: { file: "delta", mediaType: "application/json" },
  raw: { file: "raw", mediaType: "application/json" },
  rawResponse: { file: "rawResponse", mediaType: "application/json" },
  rawBlob: { file: "raw", mediaType: "application/json" },
  rawPreview: { file: "rawPreview", mediaType: "application/json" },
  workspaceDiff: { file: "workspaceDiff", mediaType: "application/json" },
  workspacePatch: { file: "workspacePatch", mediaType: "text/x-diff" },
  stdout: { file: "stdout", mediaType: "text/plain" },
  stderr: { file: "stderr", mediaType: "text/plain" },
} as const satisfies Record<ReadableArtifactRef, { file: keyof typeof AgentArtifactFileNames; mediaType: string }>;

export const ArtifactMemoryReadArgumentsSchema = z
  .object({
    artifactUris: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .refine((uri) => parseAgentArtifactUri(uri) !== undefined, "Expected a valid Senera Artifact URI."),
      )
      .min(1)
      .describe("Canonical artifact URIs, for example senera://artifact/art_1234567890abcdef12345678."),
    view: z
      .enum(["compact", "full"])
      .describe(
        "compact returns a saved LLM summary when available, otherwise a deterministic summary; full returns the raw result.",
      ),
  })
  .strict();

export type ArtifactMemoryReadArguments = z.infer<typeof ArtifactMemoryReadArgumentsSchema>;
export type ArtifactMemoryReadView = ArtifactMemoryReadArguments["view"];

const ArtifactSha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

/** Integrity identity for manifest-owned files that are not model-readable refs. */
export const ArtifactSnapshotContentSchema = z
  .object({
    file: z.string().trim().min(1),
    byteLength: z.number().int().nonnegative(),
    sha256: ArtifactSha256Schema,
  })
  .strict();

export const WorkspaceSnapshotContentsSchema = z
  .object({
    before: ArtifactSnapshotContentSchema,
    after: ArtifactSnapshotContentSchema,
  })
  .strict();

export type ArtifactSnapshotContent = z.infer<typeof ArtifactSnapshotContentSchema>;

export const ArtifactManifestContentSchema = z
  .object({
    ref: z.enum(ReadableArtifactRefs),
    mediaType: z.string().min(1),
    byteLength: z.number().int().nonnegative(),
    sha256: ArtifactSha256Schema,
  })
  .passthrough();

export type ArtifactManifestContentRecord = z.infer<typeof ArtifactManifestContentSchema>;

const ArtifactManifestContentsSchema = z
  .array(z.union([ArtifactManifestContentSchema, z.unknown().transform(() => undefined)]))
  .transform((contents) => contents.filter((content) => content !== undefined));

export const ArtifactManifestRecordSchema = z
  .object({
    schemaVersion: z.number().int().positive().optional().catch(undefined),
    artifactId: z.string().min(1),
    artifactUri: z.string().min(1),
    sessionId: z.string().min(1).optional(),
    sessionIds: z.array(z.string().min(1)).optional(),
    createdAt: z.string().min(1).optional(),
    redactionPolicySha256: ArtifactSha256Schema.optional(),
    process: z
      .object({
        exitCode: z.number().int().nullable(),
        signal: z.string().nullable(),
        streams: z
          .array(
            z
              .object({
                stream: z.enum(["stdout", "stderr"]),
                ref: z.enum(["stdout", "stderr"]),
                byteLength: z.number().int().nonnegative(),
                sha256: ArtifactSha256Schema,
              })
              .strict(),
          )
          .optional(),
      })
      .passthrough()
      .optional(),
    outcome: AgentToolExecutionOutcomeSchema.optional(),
    files: z.record(z.string(), z.string().min(1)),
    contents: ArtifactManifestContentsSchema.optional().catch(undefined),
  })
  .passthrough();

export type ArtifactManifestRecord = z.infer<typeof ArtifactManifestRecordSchema>;

export interface ArtifactMemoryReadResultItem {
  artifactUri: string;
  artifactId: string;
  status: "found" | "not_found" | "invalid" | "failed";
  view: ArtifactMemoryReadView;
  message: string;
  artifactRefs?: string[];
  compressionMethod?: "mechanical" | "llm";
  sourceSha256?: string;
  content?: unknown;
}
