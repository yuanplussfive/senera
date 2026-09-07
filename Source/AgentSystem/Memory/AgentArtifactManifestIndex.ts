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
import { parseJsonText } from "../Core/AgentJsonParsing.js";

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
  const parsed = ArtifactManifestRecordSchema.safeParse(
    parseJsonText(await fs.readFile(safeManifestPath, "utf8"), "Artifact manifest"),
  );
  if (!parsed.success) return undefined;
  const normalizedUri = normalizeAgentArtifactUri(parsed.data.artifactUri);
  if (!normalizedUri || parseAgentArtifactUri(normalizedUri) !== parsed.data.artifactId) return undefined;
  assertInsideRoot(workspaceRoot, safeManifestPath, `manifest 超出工作区：${manifestPath}`);
  return {
    ...parsed.data,
    artifactUri: normalizedUri,
  };
}
