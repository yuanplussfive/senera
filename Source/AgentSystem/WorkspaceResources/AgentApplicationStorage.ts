import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  isMissingFileError,
  nodeErrorCode,
  runWithConcurrency,
  withAgentFileAccessRetry,
  writeFileAtomic,
} from "../Core/AgentFs.js";
import { relativePathWithin } from "../Core/AgentPath.js";
import type { AgentApplicationPaths } from "../Core/AgentApplicationPaths.js";
import type { AgentWorkspaceCatalog } from "./AgentWorkspaceCatalog.js";
import {
  AgentApplicationStorageCoverageStates,
  AgentApplicationStorageSnapshotSchema,
  type AgentApplicationStorageSnapshot,
} from "./AgentApplicationStorageContract.js";

export interface AgentApplicationStorageReadOptions {
  readonly includeProject?: boolean;
  /** Limits a costly project scan to the workspace the user is currently inspecting. */
  readonly projectWorkspaceId?: string;
  /** Forces a fresh measurement instead of returning the last persisted runtime snapshot. */
  readonly refresh?: boolean;
}

const directoryScanConcurrency = Math.max(1, Math.floor(os.availableParallelism() / 2));
const unavailableDirectoryScanErrorCodes = new Set(["EACCES", "EBUSY", "EMFILE", "ENFILE", "ENOTDIR", "EPERM"]);

export interface AgentDirectoryUsage {
  readonly bytes: number;
  readonly coverage: (typeof AgentApplicationStorageCoverageStates)[keyof typeof AgentApplicationStorageCoverageStates];
  readonly unavailableEntryCount: number;
}

const inFlightStorageReads = new Map<string, Promise<AgentApplicationStorageSnapshot>>();
const catalogIdentities = new WeakMap<AgentWorkspaceCatalog, number>();
let nextCatalogIdentity = 0;

/**
 * A storage snapshot walks every file of every registered workspace, so a
 * runtime read returns the last persisted measurement unless a refresh is
 * requested. Identical concurrent scans join instead of duplicating.
 */
export async function readAgentApplicationStorage(
  paths: AgentApplicationPaths,
  catalog?: AgentWorkspaceCatalog,
  options: AgentApplicationStorageReadOptions = {},
): Promise<AgentApplicationStorageSnapshot> {
  const includeProject = options.includeProject ?? false;
  if (!includeProject && !options.refresh) {
    const cached = await readStorageUsageCache(paths, catalog);
    if (cached) return cached;
  }
  const snapshot = await readCoalescedStorageSnapshot(paths, catalog, options);
  if (!includeProject) await writeStorageUsageCache(paths, snapshot);
  return snapshot;
}

function readCoalescedStorageSnapshot(
  paths: AgentApplicationPaths,
  catalog: AgentWorkspaceCatalog | undefined,
  options: AgentApplicationStorageReadOptions,
): Promise<AgentApplicationStorageSnapshot> {
  const key = [
    paths.root,
    readCatalogIdentity(catalog),
    options.includeProject ? "project" : "runtime",
    options.projectWorkspaceId ?? "",
  ].join("\u0000");
  const pending = inFlightStorageReads.get(key);
  if (pending) return pending;
  const read = readAgentApplicationStorageSnapshot(paths, catalog, options).finally(() => {
    if (inFlightStorageReads.get(key) === read) inFlightStorageReads.delete(key);
  });
  inFlightStorageReads.set(key, read);
  return read;
}

function storageUsageCachePath(paths: AgentApplicationPaths): string {
  return path.join(paths.stateRoot, "cache", "storage-usage.json");
}

async function readStorageUsageCache(
  paths: AgentApplicationPaths,
  catalog: AgentWorkspaceCatalog | undefined,
): Promise<AgentApplicationStorageSnapshot | undefined> {
  try {
    const raw = await fs.readFile(storageUsageCachePath(paths), "utf8");
    const parsed = AgentApplicationStorageSnapshotSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.projectScanIncluded || parsed.data.root !== paths.root) return undefined;
    if (!sameWorkspaceSet(parsed.data.workspaces, catalog?.list() ?? [])) return undefined;
    return parsed.data;
  } catch {
    return undefined;
  }
}

async function writeStorageUsageCache(
  paths: AgentApplicationPaths,
  snapshot: AgentApplicationStorageSnapshot,
): Promise<void> {
  try {
    await writeFileAtomic(storageUsageCachePath(paths), `${JSON.stringify(snapshot)}\n`);
  } catch {
    // A cache write must never turn a successful measurement into a failed request.
  }
}

function sameWorkspaceSet(
  measured: AgentApplicationStorageSnapshot["workspaces"],
  registered: readonly { readonly id: string; readonly name: string; readonly root: string }[],
): boolean {
  if (measured.length !== registered.length) return false;
  const measuredKeys = new Set(
    measured.map((workspace) => `${workspace.id}\u0000${workspace.name}\u0000${workspace.root}`),
  );
  return registered.every((workspace) =>
    measuredKeys.has(`${workspace.id}\u0000${workspace.name}\u0000${workspace.root}`),
  );
}

function readCatalogIdentity(catalog: AgentWorkspaceCatalog | undefined): number {
  if (!catalog) return 0;
  const known = catalogIdentities.get(catalog);
  if (known !== undefined) return known;
  const identity = ++nextCatalogIdentity;
  catalogIdentities.set(catalog, identity);
  return identity;
}

async function readAgentApplicationStorageSnapshot(
  paths: AgentApplicationPaths,
  catalog: AgentWorkspaceCatalog | undefined,
  options: AgentApplicationStorageReadOptions,
): Promise<AgentApplicationStorageSnapshot> {
  const includeProject = options.includeProject ?? false;
  const [workspaces, usage] = await Promise.all([
    Promise.all(
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
    ),
    readAgentDirectoryUsage(paths.root, [path.dirname(storageUsageCachePath(paths))]),
  ]);
  return {
    root: paths.root,
    scope: "application-state",
    measuredAt: new Date().toISOString(),
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
