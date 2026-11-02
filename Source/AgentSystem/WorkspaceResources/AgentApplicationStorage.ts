import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isMissingFileError, nodeErrorCode, runWithConcurrency, withAgentFileAccessRetry } from "../Core/AgentFs.js";
import { relativePathWithin } from "../Core/AgentPath.js";
import type { resolveAgentApplicationPaths } from "../Core/AgentApplicationPaths.js";
import type { AgentWorkspaceCatalog } from "./AgentWorkspaceCatalog.js";
import {
  AgentApplicationStorageCoverageStates,
  type AgentApplicationStorageSnapshot,
} from "./AgentApplicationStorageContract.js";

export interface AgentApplicationStorageReadOptions {
  readonly includeProject?: boolean;
  /** Limits a costly project scan to the workspace the user is currently inspecting. */
  readonly projectWorkspaceId?: string;
}

const directoryScanConcurrency = Math.max(1, Math.floor(os.availableParallelism() / 2));
const unavailableDirectoryScanErrorCodes = new Set(["EACCES", "EBUSY", "EMFILE", "ENFILE", "ENOTDIR", "EPERM"]);

export interface AgentDirectoryUsage {
  readonly bytes: number;
  readonly coverage: (typeof AgentApplicationStorageCoverageStates)[keyof typeof AgentApplicationStorageCoverageStates];
  readonly unavailableEntryCount: number;
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
      const usage = await readAgentDirectoryUsage(layout.stateRoot);
      const includesProject =
        includeProject && (!options.projectWorkspaceId || workspace.id === options.projectWorkspaceId);
      const projectUsage = includesProject
        ? await readAgentDirectoryUsage(workspace.root, [layout.stateRoot])
        : undefined;
      return {
        ...workspace,
        stateRoot: layout.stateRoot,
        scope: "workspace-state" as const,
        ...usage,
        ...(projectUsage
          ? {
              projectBytes: projectUsage.bytes,
              projectCoverage: projectUsage.coverage,
              projectUnavailableEntryCount: projectUsage.unavailableEntryCount,
            }
          : {}),
      };
    }),
  );
  const usage = await readAgentDirectoryUsage(paths.root);
  return {
    root: paths.root,
    scope: "application-state",
    ...usage,
    workspaces,
    projectScanIncluded: includeProject,
    ...(options.projectWorkspaceId ? { projectScanWorkspaceId: options.projectWorkspaceId } : {}),
  };
}

/**
 * Counts owned regular files without traversing links. Entries which remain
 * inaccessible after the shared access retry window produce a partial
 * measurement instead of turning a diagnostics request into an HTTP failure.
 */
export async function readAgentDirectoryBytes(root: string, excludedRoots: readonly string[] = []): Promise<number> {
  return (await readAgentDirectoryUsage(root, excludedRoots)).bytes;
}

export async function readAgentDirectoryUsage(
  root: string,
  excludedRoots: readonly string[] = [],
): Promise<AgentDirectoryUsage> {
  const resolvedRoot = path.resolve(root);
  if (excludedRoots.some((excludedRoot) => isPathWithin(excludedRoot, resolvedRoot))) return emptyDirectoryUsage();

  let bytes = 0;
  let unavailableEntryCount = 0;
  const pendingDirectories = [resolvedRoot];
  while (pendingDirectories.length > 0) {
    const directoryBatch = pendingDirectories.splice(0, directoryScanConcurrency);
    const entriesByDirectory = await runWithConcurrency(directoryBatch, directoryScanConcurrency, async (directory) =>
      readDirectoryEntries(directory),
    );
    const files: string[] = [];
    for (const entries of entriesByDirectory) {
      unavailableEntryCount += entries.unavailableEntryCount;
      for (const { directory, entry } of entries.entries) {
        if (entry.isSymbolicLink()) continue;
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!excludedRoots.some((excludedRoot) => isPathWithin(excludedRoot, entryPath))) {
            pendingDirectories.push(entryPath);
          }
          continue;
        }
        if (entry.isFile()) files.push(entryPath);
      }
    }
    const sizes = await runWithConcurrency(files, directoryScanConcurrency, readFileSize);
    for (const size of sizes) {
      bytes += size.bytes;
      unavailableEntryCount += size.unavailableEntryCount;
    }
  }

  return {
    bytes,
    coverage:
      unavailableEntryCount === 0
        ? AgentApplicationStorageCoverageStates.Complete
        : AgentApplicationStorageCoverageStates.Partial,
    unavailableEntryCount,
  };
}

async function readDirectoryEntries(directory: string): Promise<{
  readonly entries: readonly { readonly directory: string; readonly entry: import("node:fs").Dirent }[];
  readonly unavailableEntryCount: number;
}> {
  try {
    const entries = await withAgentFileAccessRetry(() => fs.readdir(directory, { withFileTypes: true }));
    return {
      entries: entries.map((entry) => ({ directory, entry })),
      unavailableEntryCount: 0,
    };
  } catch (error) {
    if (isMissingFileError(error)) return { entries: [], unavailableEntryCount: 0 };
    if (isUnavailableDirectoryScanError(error)) return { entries: [], unavailableEntryCount: 1 };
    throw error;
  }
}

async function readFileSize(filePath: string): Promise<Pick<AgentDirectoryUsage, "bytes" | "unavailableEntryCount">> {
  try {
    const entry = await withAgentFileAccessRetry(() => fs.lstat(filePath));
    return { bytes: entry.isFile() ? entry.size : 0, unavailableEntryCount: 0 };
  } catch (error) {
    if (isMissingFileError(error)) return { bytes: 0, unavailableEntryCount: 0 };
    if (isUnavailableDirectoryScanError(error)) return { bytes: 0, unavailableEntryCount: 1 };
    throw error;
  }
}

function emptyDirectoryUsage(): AgentDirectoryUsage {
  return {
    bytes: 0,
    coverage: AgentApplicationStorageCoverageStates.Complete,
    unavailableEntryCount: 0,
  };
}

function isUnavailableDirectoryScanError(error: unknown): boolean {
  return unavailableDirectoryScanErrorCodes.has(nodeErrorCode(error) ?? "");
}

function isPathWithin(parent: string, candidate: string): boolean {
  const resolvedParent = path.resolve(parent);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedParent === resolvedCandidate || relativePathWithin(resolvedParent, resolvedCandidate) !== undefined;
}
