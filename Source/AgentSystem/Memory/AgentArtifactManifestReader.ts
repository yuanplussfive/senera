import path from "node:path";
import {
  assertInsideRoot,
  normalizeAgentArtifactUri,
  parseAgentArtifactUri,
} from "../Artifacts/AgentArtifactLocator.js";
import { SeneraWorkspaceBoundary } from "../Execution/SeneraWorkspaceBoundary.js";
import { AgentResourceAccessIntents } from "../Safety/AgentResourceAccessPolicy.js";
import { ArtifactManifestRecordSchema, type ArtifactManifestRecord } from "./AgentArtifactMemoryTypes.js";
import { parseJsonTextOrUndefined } from "../Core/AgentJsonParsing.js";

export interface ArtifactManifestFileFingerprint {
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly ino: number;
}

export async function readArtifactManifest(
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
