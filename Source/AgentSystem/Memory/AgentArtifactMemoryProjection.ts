import path from "node:path";
import { assertInsideRoot, toPosixPath } from "../Artifacts/AgentArtifactLocator.js";
import type { ReadableArtifactRef } from "./AgentArtifactMemoryTypes.js";
import { ReadableArtifactRefDefinitions } from "./AgentArtifactMemoryTypes.js";

const EmptyArtifactInternalRoutingFields = new Set<string>();

const ArtifactWrapperInternalRoutingFields = new Set([
  "absoluteDir",
  "absolutePath",
  "artifactPath",
  "files",
  "manifestPath",
  "relativeDir",
  "relativePath",
  "workspaceRoot",
]);

const ArtifactEvidenceInternalFields = new Set([...ArtifactWrapperInternalRoutingFields, "key", "plannerMemory"]);

const ArtifactDeltaInternalFields = new Set([...ArtifactWrapperInternalRoutingFields, "key"]);

const ArtifactInternalRoutingFieldsByRef: Partial<Record<ReadableArtifactRef, ReadonlySet<string>>> = {
  delta: ArtifactDeltaInternalFields,
  evidence: ArtifactEvidenceInternalFields,
  workspaceDiff: ArtifactWrapperInternalRoutingFields,
};

export function decodeArtifactMemoryContent(
  ref: ReadableArtifactRef,
  data: Buffer,
  options: {
    workspaceRoot: string;
  },
): string {
  const text = data.toString("utf8");
  if (ReadableArtifactRefDefinitions[ref].format === "text") {
    return text;
  }

  const parsed = JSON.parse(text) as unknown;
  return `${JSON.stringify(projectModelSafeJson(ref, parsed, options.workspaceRoot), null, 2)}\n`;
}

export interface Utf8RangeSlice {
  text: string;
  startByte: number;
  endByte: number;
  totalBytes: number;
}

export function sliceUtf8Range(value: string, requestedStartByte: number, maxBytes: number): Utf8RangeSlice {
  return sliceUtf8Buffer(Buffer.from(value, "utf8"), requestedStartByte, maxBytes);
}

export function sliceUtf8Buffer(encoded: Buffer, requestedStartByte: number, maxBytes: number): Utf8RangeSlice {
  const totalBytes = encoded.byteLength;
  const boundedStart = Math.min(totalBytes, Math.max(0, Math.floor(requestedStartByte)));
  const startByte = alignUtf8Start(encoded, boundedStart);
  const requestedEnd = Math.min(totalBytes, startByte + Math.max(1, Math.floor(maxBytes)));
  const endByte = alignUtf8End(encoded, startByte, requestedEnd);
  return {
    text: encoded.subarray(startByte, endByte).toString("utf8"),
    startByte,
    endByte,
    totalBytes,
  };
}

function alignUtf8Start(encoded: Buffer, offset: number): number {
  let aligned = offset;
  while (aligned < encoded.byteLength && isUtf8ContinuationByte(encoded[aligned]!)) aligned += 1;
  return aligned;
}

function alignUtf8End(encoded: Buffer, startByte: number, offset: number): number {
  let aligned = offset;
  while (aligned > startByte && aligned < encoded.byteLength && isUtf8ContinuationByte(encoded[aligned]!)) {
    aligned -= 1;
  }
  if (aligned > startByte || startByte >= encoded.byteLength) return aligned;

  aligned = startByte + 1;
  while (aligned < encoded.byteLength && isUtf8ContinuationByte(encoded[aligned]!)) aligned += 1;
  return aligned;
}

function isUtf8ContinuationByte(value: number): boolean {
  return (value & 0xc0) === 0x80;
}

function projectModelSafeJson(ref: ReadableArtifactRef, value: unknown, workspaceRoot: string): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => projectModelSafeJson(ref, entry, workspaceRoot));
  }

  if (!value || typeof value !== "object") {
    return projectModelSafeScalar(value, workspaceRoot);
  }

  const hiddenFields = ArtifactInternalRoutingFieldsByRef[ref] ?? EmptyArtifactInternalRoutingFields;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
      if (hiddenFields.has(key)) {
        return [];
      }
      return [[key, projectModelSafeJson(ref, entry, workspaceRoot)]];
    }),
  );
}

function projectModelSafeScalar(value: unknown, workspaceRoot: string): unknown {
  if (typeof value !== "string") {
    return value;
  }

  return normalizeLocalAbsolutePath(value, workspaceRoot) ?? value;
}

function normalizeLocalAbsolutePath(value: string, workspaceRoot: string): string | undefined {
  if (!path.isAbsolute(value)) {
    return undefined;
  }

  try {
    const root = path.resolve(workspaceRoot);
    const target = assertInsideRoot(root, path.resolve(value), "path outside workspace");
    const relative = path.relative(root, target);
    return relative ? toPosixPath(relative) : ".";
  } catch {
    return undefined;
  }
}
