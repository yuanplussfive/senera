import fs from "node:fs/promises";
import path from "node:path";
import {
  AgentArtifactFileNames,
  assertInsideRoot,
  normalizeAgentArtifactUri,
  parseAgentArtifactUri,
} from "../Artifacts/AgentArtifactLocator.js";
import { SeneraWorkspaceBoundary } from "../Execution/SeneraWorkspaceBoundary.js";
import { AgentResourceAccessIntents } from "../Safety/AgentResourceAccessPolicy.js";
import {
  type ArtifactManifestRecord,
  type ReadableArtifactRef,
  ReadableArtifactRefs,
} from "./AgentArtifactMemoryTypes.js";

export async function indexArtifactManifests(
  artifactRoot: string,
  workspaceRoot: string,
): Promise<Map<string, ArtifactManifestRecord>> {
  const boundary = new SeneraWorkspaceBoundary({ workspaceRoot, linkPolicy: "deny" });
  const resolvedRoot = await boundary.resolve(artifactRoot, AgentResourceAccessIntents.Read);
  const manifests = new Map<string, ArtifactManifestRecord>();
  for (const manifestPath of await findManifestFiles(resolvedRoot.absolutePath)) {
    const manifest = await readArtifactManifest(manifestPath, workspaceRoot, resolvedRoot.absolutePath, boundary);
    if (manifest) {
      manifests.set(manifest.artifactId, manifest);
    }
  }
  return manifests;
}

async function findManifestFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await findManifestFiles(entryPath)));
      continue;
    }
    if (entry.isFile() && entry.name === AgentArtifactFileNames.manifest) {
      result.push(entryPath);
    }
  }
  return result;
}

async function readArtifactManifest(
  manifestPath: string,
  workspaceRoot: string,
  artifactRoot: string,
  boundary: SeneraWorkspaceBoundary,
): Promise<ArtifactManifestRecord | undefined> {
  const lexicalManifestPath = assertInsideRoot(
    artifactRoot,
    path.resolve(manifestPath),
    `manifest 超出 artifact 根目录：${manifestPath}`,
  );
  const resolved = await boundary.resolve(lexicalManifestPath, AgentResourceAccessIntents.Read);
  const safeManifestPath = assertInsideRoot(
    artifactRoot,
    resolved.absolutePath,
    `manifest 的真实路径超出 artifact 根目录：${manifestPath}`,
  );
  const value = JSON.parse(await fs.readFile(safeManifestPath, "utf8")) as Record<string, unknown>;
  const artifactId = typeof value.artifactId === "string" ? value.artifactId : "";
  const artifactUri = typeof value.artifactUri === "string" ? value.artifactUri : "";
  const sessionId = typeof value.sessionId === "string" && value.sessionId.length > 0 ? value.sessionId : undefined;
  const createdAt = typeof value.createdAt === "string" && value.createdAt.length > 0 ? value.createdAt : undefined;
  const files =
    value.files && typeof value.files === "object" && !Array.isArray(value.files)
      ? (value.files as Record<string, string>)
      : {};
  const normalizedUri = normalizeAgentArtifactUri(artifactUri);
  if (!artifactId || !normalizedUri || parseAgentArtifactUri(normalizedUri) !== artifactId) {
    return undefined;
  }
  assertInsideRoot(workspaceRoot, safeManifestPath, `manifest 超出工作区：${manifestPath}`);
  return {
    artifactId,
    artifactUri: normalizedUri,
    sessionId,
    createdAt,
    files,
    contents: readArtifactContents(value.contents),
  };
}

function readArtifactContents(value: unknown): ArtifactManifestRecord["contents"] {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const ref = typeof record.ref === "string" ? record.ref : "";
    const mediaType = typeof record.mediaType === "string" ? record.mediaType : "";
    const byteLength = typeof record.byteLength === "number" ? record.byteLength : -1;
    const sha256 = typeof record.sha256 === "string" ? record.sha256 : "";
    if (
      !ReadableArtifactRefs.includes(ref as ReadableArtifactRef) ||
      !mediaType ||
      !Number.isSafeInteger(byteLength) ||
      byteLength < 0 ||
      !/^[a-f0-9]{64}$/.test(sha256)
    ) {
      return [];
    }
    return [{ ref: ref as ReadableArtifactRef, mediaType, byteLength, sha256 }];
  });
}
