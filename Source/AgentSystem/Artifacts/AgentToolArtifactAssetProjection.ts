import { createAgentArtifactAssetLink } from "./AgentArtifactAssetLink.js";
import type { AgentToolArtifactAssetReference } from "../Types/ToolRuntimeTypes.js";

/**
 * Replaces adapter-local asset handles with the immutable resources published
 * by an Artifact. Adapters can describe an asset before the Artifact has an
 * identity; the recorder resolves that temporary coordinate exactly once.
 */
export function projectArtifactAssetLinks(
  value: unknown,
  assets: readonly AgentToolArtifactAssetReference[] | undefined,
): unknown {
  if (!assets || assets.length === 0) return value;
  const links = new Map(assets.map((asset) => [createAgentArtifactAssetLink(asset.id), asset.resourceUri]));
  const paths = new Map(assets.map((asset) => [createAgentArtifactAssetLink(asset.id), asset.workspacePath]));
  return replaceArtifactAssetLinks(value, links, paths);
}

/**
 * A tool that points at an asset it produced should also say where that asset
 * lives, so the model can open the file on demand instead of receiving its
 * bytes in every tool observation.
 */
function collectReferencedAssetPaths(
  entries: readonly (readonly [string, unknown])[],
  paths: ReadonlyMap<string, string>,
): string | undefined {
  const referenced = new Set<string>();
  for (const [, entry] of entries) {
    if (typeof entry !== "string") continue;
    for (const [placeholder, workspacePath] of paths) {
      if (entry.includes(placeholder)) referenced.add(workspacePath);
    }
  }
  if (referenced.size !== 1) return undefined;
  return [...referenced][0];
}

function replaceArtifactAssetLinks(
  value: unknown,
  links: ReadonlyMap<string, string>,
  paths: ReadonlyMap<string, string> = new Map(),
): unknown {
  if (typeof value === "string") {
    let result = value;
    for (const [placeholder, link] of links) result = result.replaceAll(placeholder, link);
    return result;
  }
  if (Array.isArray(value)) return value.map((entry) => replaceArtifactAssetLinks(entry, links, paths));
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const workspacePath = paths.size > 0 ? collectReferencedAssetPaths(entries, paths) : undefined;
    const projected = Object.fromEntries(
      entries.map(([key, entry]) => [key, replaceArtifactAssetLinks(entry, links, paths)]),
    );
    if (workspacePath !== undefined && !Object.hasOwn(projected, "workspacePath")) {
      projected.workspacePath = workspacePath;
    }
    return projected;
  }
  return value;
}
