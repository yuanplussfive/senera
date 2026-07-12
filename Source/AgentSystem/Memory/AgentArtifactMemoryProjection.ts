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

export function truncateUtf8(value: string, maxBytes: number): string {
  return Buffer.byteLength(value, "utf8") > maxBytes
    ? Buffer.from(value).subarray(0, maxBytes).toString("utf8")
    : value;
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
