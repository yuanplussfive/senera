import path from "node:path";
import { resolveArtifactsConfig } from "../AgentDefaults.js";
import { assertInsideRoot, parseAgentArtifactUri } from "../Artifacts/AgentArtifactLocator.js";
import { SeneraWorkspaceBoundary } from "../Execution/SeneraWorkspaceBoundary.js";
import { AgentResourceAccessIntents } from "../Safety/AgentResourceAccessPolicy.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { AgentArtifactManifestIndexCache } from "./AgentArtifactManifestIndexCache.js";
import { assertArtifactMemoryReadRequestWithinLimits, readArtifactMemories } from "./AgentArtifactMemoryReader.js";
import type { ArtifactMemoryReadArguments } from "./AgentArtifactMemoryTypes.js";

const ArtifactManifestIndexes = new AgentArtifactManifestIndexCache();

export async function readAgentArtifactMemoryContent(
  args: ArtifactMemoryReadArguments,
  options: {
    readonly config: AgentSystemConfig;
    readonly workspaceRoot: string;
    readonly artifactManifestIndex?: AgentArtifactManifestIndexCache;
    readonly signal?: AbortSignal;
  },
) {
  const artifacts = resolveArtifactsConfig(options.config);
  assertArtifactMemoryReadRequestWithinLimits(args, { maxArtifacts: artifacts.MemoryReadMaxArtifacts });
  const artifactRoot = await resolveArtifactRoot(options.workspaceRoot, artifacts.RootDir);
  const manifests = await (options.artifactManifestIndex ?? ArtifactManifestIndexes).load({
    artifactRoot,
    workspaceRoot: options.workspaceRoot,
    requiredArtifactIds: args.artifactUris.flatMap((uri) => parseAgentArtifactUri(uri) ?? []),
  });
  return readArtifactMemories(args, manifests, {
    workspaceRoot: options.workspaceRoot,
    artifactRoot,
    maxArtifacts: artifacts.MemoryReadMaxArtifacts,
    maxConcurrency: artifacts.MemoryReadMaxConcurrency,
    signal: options.signal,
  });
}

async function resolveArtifactRoot(workspaceRoot: string, rootDir: string): Promise<string> {
  const lexicalRoot = assertInsideRoot(
    workspaceRoot,
    path.resolve(workspaceRoot, rootDir),
    `artifact 根目录超出工作区：${rootDir}`,
  );
  const resolved = await new SeneraWorkspaceBoundary({ workspaceRoot, linkPolicy: "deny" }).resolve(
    lexicalRoot,
    AgentResourceAccessIntents.Read,
  );
  return resolved.absolutePath;
}
