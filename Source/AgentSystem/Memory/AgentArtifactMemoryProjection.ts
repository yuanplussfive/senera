import path from "node:path";
import { assertInsideRoot, toPosixPath } from "../Artifacts/AgentArtifactLocator.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import type { ReadableArtifactRef } from "./AgentArtifactMemoryTypes.js";

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

export interface Utf8RangeSlice {
  text: string;
  startByte: number;
  endByte: number;
  totalBytes: number;
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

export function projectArtifactJsonForModel(ref: ReadableArtifactRef, value: unknown, workspaceRoot: string): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => projectArtifactJsonForModel(ref, entry, workspaceRoot));
  }

  if (!value || typeof value !== "object") {
    return projectModelSafeScalar(value, workspaceRoot);
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
      if (!isArtifactJsonFieldVisibleForModel(ref, key)) {
        return [];
      }
      return [[key, projectArtifactJsonForModel(ref, entry, workspaceRoot)]];
    }),
  );
}

export function isArtifactJsonFieldVisibleForModel(ref: ReadableArtifactRef, field: string): boolean {
  return !artifactJsonHiddenFields(ref).has(field);
}

export function artifactJsonProjectionPolicyHash(ref: ReadableArtifactRef): string {
  return sha256HexOfCanonicalJson({
    ref,
    hiddenFields: [...artifactJsonHiddenFields(ref)].sort(),
  });
}

function artifactJsonHiddenFields(ref: ReadableArtifactRef): ReadonlySet<string> {
  return ArtifactInternalRoutingFieldsByRef[ref] ?? EmptyArtifactInternalRoutingFields;
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
