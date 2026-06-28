import fs from "node:fs/promises";
import path from "node:path";
import {
  AgentArtifactFileNames,
  assertInsideRoot,
  normalizeAgentArtifactUri,
  parseAgentArtifactUri,
} from "../Artifacts/AgentArtifactLocator.js";
import type { ArtifactManifestRecord } from "./AgentArtifactMemoryTypes.js";

export async function indexArtifactManifests(
  artifactRoot: string,
  workspaceRoot: string,
): Promise<Map<string, ArtifactManifestRecord>> {
  const manifests = new Map<string, ArtifactManifestRecord>();
  for (const manifestPath of await findManifestFiles(artifactRoot)) {
    const manifest = await readArtifactManifest(manifestPath, workspaceRoot, artifactRoot);
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
      result.push(...await findManifestFiles(entryPath));
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
): Promise<ArtifactManifestRecord | undefined> {
  const safeManifestPath = assertInsideRoot(
    artifactRoot,
    path.resolve(manifestPath),
    `manifest 超出 artifact 根目录：${manifestPath}`,
  );
  const value = JSON.parse(await fs.readFile(safeManifestPath, "utf8")) as Record<string, unknown>;
  const artifactId = typeof value.artifactId === "string" ? value.artifactId : "";
  const artifactUri = typeof value.artifactUri === "string" ? value.artifactUri : "";
  const files = value.files && typeof value.files === "object" && !Array.isArray(value.files)
    ? value.files as Record<string, string>
    : {};
  const normalizedUri = normalizeAgentArtifactUri(artifactUri);
  if (!artifactId || !normalizedUri || parseAgentArtifactUri(normalizedUri) !== artifactId) {
    return undefined;
  }
  assertInsideRoot(workspaceRoot, safeManifestPath, `manifest 超出工作区：${manifestPath}`);
  return {
    artifactId,
    artifactUri: normalizedUri,
    files,
  };
}

