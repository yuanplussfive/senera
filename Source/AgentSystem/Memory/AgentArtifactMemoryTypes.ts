import { z } from "zod";
import { AgentToolExecutionOutcomeSchema } from "../ToolRuntime/AgentToolResultOutcome.js";
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

const ArtifactJsonPredicateSchema = z.discriminatedUnion("operator", [
  z
    .object({
      field: z.string(),
      operator: z.enum(["eq", "ne", "gt", "gte", "lt", "lte", "contains"]),
      value: z.unknown(),
    })
    .strict(),
  z
    .object({
      field: z.string(),
      operator: z.enum(["exists", "not_exists"]),
    })
    .strict(),
]);

export const ArtifactJsonViewRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("index"),
      sourcePath: z.preprocess(normalizeToolArrayArgument, z.array(z.string())).optional(),
      cursor: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("query"),
      sourcePath: z.preprocess(normalizeToolArrayArgument, z.array(z.string())).optional(),
      select: z.preprocess(normalizeToolArrayArgument, z.array(z.string()).min(1)).optional(),
      where: z.preprocess(normalizeToolArrayArgument, z.array(ArtifactJsonPredicateSchema).min(1)).optional(),
      cursor: z.string().min(1).optional(),
    })
    .strict(),
]);

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
    jsonView: ArtifactJsonViewRequestSchema.optional(),
  })
  .strict();

export type ArtifactMemoryReadArguments = z.infer<typeof ArtifactMemoryReadArgumentsSchema>;
export type ArtifactJsonViewRequest = z.infer<typeof ArtifactJsonViewRequestSchema>;
export type ArtifactJsonIndexViewRequest = Extract<ArtifactJsonViewRequest, { kind: "index" }>;
export type ArtifactJsonQuery = Extract<ArtifactJsonViewRequest, { kind: "query" }>;

const ArtifactSha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const ArtifactManifestContentSchema = z
  .object({
    ref: z.enum(ReadableArtifactRefs),
    mediaType: z.string().min(1),
    byteLength: z.number().int().nonnegative(),
    sha256: ArtifactSha256Schema,
    structure: z
      .object({
        file: z.string().min(1),
        mediaType: z.literal("application/x-ndjson"),
        byteLength: z.number().int().nonnegative(),
        sha256: ArtifactSha256Schema,
      })
      .passthrough()
      .optional(),
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
    outcome: AgentToolExecutionOutcomeSchema.optional(),
    files: z.record(z.string(), z.string().min(1)),
    contents: ArtifactManifestContentsSchema.optional().catch(undefined),
  })
  .passthrough();

export type ArtifactManifestRecord = z.infer<typeof ArtifactManifestRecordSchema>;

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
  failedRefCount: number;
  memories: {
    item: Array<ArtifactMemoryContentItem>;
  };
  memoryCount: number;
}

export interface ArtifactMemoryRefReadResult {
  ref: ReadableArtifactRef;
  status: "loaded" | "unavailable" | "failed";
  message: string;
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
  structuredContent?: unknown;
  content: string;
  view?: ArtifactMemoryJsonView;
}

export type ArtifactMemoryJsonView =
  | {
      kind: "json_index";
      sourcePath?: string[];
      rootType: "array" | "boolean" | "null" | "number" | "object" | "string";
      rootItemCount?: number;
      fieldCount: number;
      startFieldIndex: number;
      returnedFieldCount: number;
      remainingFieldCount: number;
      complete: boolean;
      nextCursor?: string;
      blockedAtFieldIndex?: number;
    }
  | {
      kind: "json_query";
      sourcePath: string[];
      selectedFields?: string[];
      scanned: number;
      returned: number;
      complete: boolean;
      nextCursor?: string;
      blockedAtIndex?: number;
    };
