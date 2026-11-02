import { z } from "zod";
import { AgentToolExecutionOutcomeSchema } from "../ToolRuntime/AgentToolResultOutcome.js";
import type { AgentArtifactFileNames } from "../Artifacts/AgentArtifactLocator.js";

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

/** Runtime input after the package-owned ArtifactMemoryReadTool contract has been validated. */
export interface LegacyArtifactMemoryReadArguments {
  readonly artifactUris: readonly string[];
  readonly view: "compact" | "full";
}

export const ArtifactReadParts = [
  "result",
  "source",
  "summary",
  "process",
  "outcome",
  "stdout",
  "stderr",
  "changes",
  "assets",
] as const;
export const ArtifactReadResultProtocol = "senera.artifact-read/v1";
export const ArtifactReadViews = ["structure", "content"] as const;
export type ArtifactReadPart = (typeof ArtifactReadParts)[number];
export interface ArtifactReadRequest {
  readonly uri: string;
  readonly part?: ArtifactReadPart;
  readonly paths?: readonly string[];
  readonly view?: (typeof ArtifactReadViews)[number];
}
export type ArtifactMemoryReadArguments =
  LegacyArtifactMemoryReadArguments | { readonly requests: readonly ArtifactReadRequest[] };
export function artifactReadRequests(args: ArtifactMemoryReadArguments): readonly ArtifactReadRequest[] {
  return "requests" in args ? args.requests : args.artifactUris.map((uri) => ({ uri }));
}

export type ArtifactMemoryReadView = "compact" | "full" | "structure" | "selected";

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
  requestedUri: string;
  artifactUri: string;
  artifactId: string;
  status: "found" | "not_found" | "invalid" | "failed";
  view: ArtifactMemoryReadView;
  message: string;
  artifactRefs?: string[];
  compressionMethod?: "mechanical" | "llm";
  sourceSha256?: string;
  content?: unknown;
  part?: ArtifactReadPart;
  availableParts?: readonly ArtifactReadPart[];
}
