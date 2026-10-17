import fs from "node:fs/promises";
import path from "node:path";
import { isMissingFileError } from "../Core/AgentFs.js";
import { relativePathWithin } from "../Core/AgentPath.js";
import type { resolveAgentApplicationPaths } from "../Core/AgentApplicationPaths.js";
import type { AgentWorkspaceCatalog } from "./AgentWorkspaceCatalog.js";
import type { AgentApplicationStorageSnapshot } from "./AgentApplicationStorageContract.js";

export interface AgentApplicationStorageReadOptions {
  readonly includeProject?: boolean;
}

export async function readAgentApplicationStorage(
  paths: ReturnType<typeof resolveAgentApplicationPaths>,
  catalog?: AgentWorkspaceCatalog,
  options: AgentApplicationStorageReadOptions = {},
): Promise<AgentApplicationStorageSnapshot> {
  const includeProject = options.includeProject ?? false;
  const workspaces = await Promise.all(
    (catalog?.list() ?? []).map(async (workspace) => {
      const layout = paths.workspaceLayout(workspace.root, workspace.id);
      return {
        ...workspace,
        stateRoot: layout.stateRoot,
        scope: "workspace-state" as const,
        bytes: await readAgentDirectoryBytes(layout.stateRoot),
        ...(includeProject ? { projectBytes: await readAgentDirectoryBytes(workspace.root, [layout.stateRoot]) } : {}),
      };
    }),
  );
  return {
    root: paths.root,
    scope: "application-state",
    bytes: await readAgentDirectoryBytes(paths.root),
    workspaces,
    projectScanIncluded: includeProject,
  };
}

/** Counts owned regular files without traversing links to project or external directories. */
export async function readAgentDirectoryBytes(root: string, excludedRoots: readonly string[] = []): Promise<number> {
  const resolvedRoot = path.resolve(root);
  if (excludedRoots.some((excludedRoot) => isPathWithin(excludedRoot, resolvedRoot))) return 0;
  let directory;
  try {
    directory = await fs.opendir(resolvedRoot);
  } catch (error) {
    if (isMissingFileError(error)) return 0;
    throw error;
  }
  let bytes = 0;
  for await (const entry of directory) {
    const filePath = path.join(resolvedRoot, entry.name);
    if (entry.isDirectory()) bytes += await readAgentDirectoryBytes(filePath, excludedRoots);
    else if (entry.isFile()) {
      try {
        bytes += (await fs.lstat(filePath)).size;
      } catch (error) {
        if (!isMissingFileError(error)) throw error;
      }
    }
  }
  return bytes;
}

function isPathWithin(parent: string, candidate: string): boolean {
  const resolvedParent = path.resolve(parent);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedParent === resolvedCandidate || relativePathWithin(resolvedParent, resolvedCandidate) !== undefined;
}
