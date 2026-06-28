import { z } from "zod";
import { AgentArtifactFileNames } from "../Artifacts/AgentArtifactLocator.js";
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
  "workspaceDiff",
  "workspacePatch",
] as const satisfies Array<keyof typeof AgentArtifactFileNames>;

export type ReadableArtifactRef = typeof ReadableArtifactRefs[number];

export const ReadableArtifactRefDefinitions = {
  summary: {
    file: "summary",
    format: "text",
  },
  projection: {
    file: "projection",
    format: "text",
  },
  evidence: {
    file: "evidence",
    format: "json",
  },
  delta: {
    file: "delta",
    format: "json",
  },
  raw: {
    file: "raw",
    format: "json",
  },
  workspaceDiff: {
    file: "workspaceDiff",
    format: "json",
  },
  workspacePatch: {
    file: "workspacePatch",
    format: "text",
  },
} as const satisfies Record<ReadableArtifactRef, {
  file: keyof typeof AgentArtifactFileNames;
  format: "json" | "text";
}>;

export const ArtifactMemoryReadArgumentsSchema = z
  .object({
    artifactUris: z.preprocess(normalizeToolArrayArgument, z.array(z.string().trim().min(1)).min(1)),
    refs: z.preprocess(normalizeToolArrayArgument, z.array(z.enum(ReadableArtifactRefs)).min(1)).optional(),
    maxBytesPerRef: z.preprocess(normalizeToolNumberArgument, z.number().int().positive()).optional(),
  })
  .strict();

export type ArtifactMemoryReadArguments = z.infer<typeof ArtifactMemoryReadArgumentsSchema>;

export interface ArtifactManifestRecord {
  artifactId: string;
  artifactUri: string;
  files: Record<string, string>;
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
    }>;
  };
  availableRefCount: number;
  memories: {
    item: Array<ArtifactMemoryContentItem>;
  };
  memoryCount: number;
}

export interface ArtifactMemoryContentItem {
  ref: string;
  content: string;
  byteLength: number;
  truncated: boolean;
}

