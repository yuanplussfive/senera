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
import { ArtifactManifestRecordSchema, type ArtifactManifestRecord } from "./AgentArtifactMemoryTypes.js";
import { parseJsonTextOrUndefined } from "../Core/AgentJsonParsing.js";
import { isMissingFileError } from "../Core/AgentFs.js";

export async function indexArtifactManifests(
  artifactRoot: string,
  workspaceRoot: string,
): Promise<Map<string, ArtifactManifestRecord>> {
  return (await indexArtifactManifestSnapshot(artifactRoot, workspaceRoot)).index;
}

export interface ArtifactManifestFileFingerprint {
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly ino: number;
}

export interface ArtifactManifestIndexSnapshot {
  readonly index: Map<string, ArtifactManifestRecord>;
  readonly fingerprints: ReadonlyMap<string, ArtifactManifestFileFingerprint>;
}

/**
 * Indexes manifests and returns the file signatures used by the in-process
 * cache. The signatures include invalid manifests too, so repairing a
 * malformed manifest invalidates the cached negative lookup as well.
 */
export async function indexArtifactManifestSnapshot(
  artifactRoot: string,
  workspaceRoot: string,
): Promise<ArtifactManifestIndexSnapshot> {
  const boundary = new SeneraWorkspaceBoundary({ workspaceRoot, linkPolicy: "deny" });
  const resolvedRoot = await boundary.resolve(artifactRoot, AgentResourceAccessIntents.Read);
  const manifests = new Map<string, ArtifactManifestRecord>();
  const manifestPathsById = new Map<string, string>();
  const fingerprints = new Map<string, ArtifactManifestFileFingerprint>();
  for (const manifestPath of await findManifestFiles(resolvedRoot.absolutePath)) {
    const indexed = await readArtifactManifestIfPresent(
      manifestPath,
      workspaceRoot,
      resolvedRoot.absolutePath,
      boundary,
    );
    if (!indexed) continue;
    fingerprints.set(indexed.path, indexed.fingerprint);
    if (indexed.manifest) {
      const previousPath = manifestPathsById.get(indexed.manifest.artifactId);
      if (previousPath) {
        throw new Error(
          `Duplicate Artifact manifest for ${indexed.manifest.artifactId}: ${indexed.path} conflicts with ${previousPath}.`,
        );
      }
      manifestPathsById.set(indexed.manifest.artifactId, indexed.path);
      manifests.set(indexed.manifest.artifactId, indexed.manifest);
    }
  }
  return { index: manifests, fingerprints };
}

/** Enumerates and stats manifests without parsing their contents. */
export async function collectArtifactManifestFingerprints(
  artifactRoot: string,
  workspaceRoot: string,
): Promise<ReadonlyMap<string, ArtifactManifestFileFingerprint>> {
  const boundary = new SeneraWorkspaceBoundary({ workspaceRoot, linkPolicy: "deny" });
  const resolvedRoot = await boundary.resolve(artifactRoot, AgentResourceAccessIntents.Read);
  const fingerprints = new Map<string, ArtifactManifestFileFingerprint>();
  for (const manifestPath of await findManifestFiles(resolvedRoot.absolutePath)) {
    try {
      const safeManifestPath = await resolveManifestPath(manifestPath, resolvedRoot.absolutePath, boundary);
      const stat = await fs.stat(safeManifestPath);
      fingerprints.set(safeManifestPath, toManifestFingerprint(stat));
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
  }
  return fingerprints;
}

async function findManifestFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await fs.readdir(root, { withFileTypes: true }).catch((error) => {
    if (isMissingFileError(error)) return [];
    throw error;
  });
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
): Promise<{
  readonly path: string;
  readonly fingerprint: ArtifactManifestFileFingerprint;
  readonly manifest?: ArtifactManifestRecord;
}> {
  const safeManifestPath = await resolveManifestPath(manifestPath, artifactRoot, boundary);
  const opened = await boundary.openFile(safeManifestPath, AgentResourceAccessIntents.Read);
  let fingerprint: ArtifactManifestFileFingerprint;
  let source: string;
  try {
    const stat = await opened.handle.stat();
    fingerprint = toManifestFingerprint(stat);
    source = await opened.handle.readFile("utf8");
  } finally {
    await opened.handle.close();
  }
  const parsed = ArtifactManifestRecordSchema.safeParse(parseJsonTextOrUndefined(source));
  if (!parsed.success) return { path: safeManifestPath, fingerprint };
  const normalizedUri = normalizeAgentArtifactUri(parsed.data.artifactUri);
  if (!normalizedUri || parseAgentArtifactUri(normalizedUri) !== parsed.data.artifactId) {
    return { path: safeManifestPath, fingerprint };
  }
  assertInsideRoot(workspaceRoot, safeManifestPath, `manifest 超出工作区：${manifestPath}`);
  return {
    path: safeManifestPath,
    fingerprint,
    manifest: {
      ...parsed.data,
      artifactUri: normalizedUri,
    },
  };
}

async function readArtifactManifestIfPresent(
  manifestPath: string,
  workspaceRoot: string,
  artifactRoot: string,
  boundary: SeneraWorkspaceBoundary,
): Promise<Awaited<ReturnType<typeof readArtifactManifest>> | undefined> {
  try {
    return await readArtifactManifest(manifestPath, workspaceRoot, artifactRoot, boundary);
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
}

async function resolveManifestPath(
  manifestPath: string,
  artifactRoot: string,
  boundary: SeneraWorkspaceBoundary,
): Promise<string> {
  const lexicalManifestPath = assertInsideRoot(
    artifactRoot,
    path.resolve(manifestPath),
    `manifest 超出 artifact 根目录：${manifestPath}`,
  );
  const resolved = await boundary.resolve(lexicalManifestPath, AgentResourceAccessIntents.Read);
  return assertInsideRoot(
    artifactRoot,
    resolved.absolutePath,
    `manifest 的真实路径超出 artifact 根目录：${manifestPath}`,
  );
}

function toManifestFingerprint(stat: import("node:fs").Stats): ArtifactManifestFileFingerprint {
  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
    ino: stat.ino,
  };
}
