import fs from "node:fs/promises";
import path from "node:path";
import { isMissingFileError, removeAgentPathWithRetry, writeFileAtomicSync } from "../Core/AgentFs.js";
import { relativePathWithin } from "../Core/AgentPath.js";
import { AgentKeyedLeaseQueue } from "../Core/AgentKeyedLeaseQueue.js";
import { readAgentDirectoryBytes } from "./AgentApplicationStorage.js";

const MigrationDirectoryName = "migrations";
const HostStateBackupDirectoryName = "host-state";
const MigrationMarkerName = "host-state.json";
const migrationMutationLeases = new AgentKeyedLeaseQueue<string>();

export interface AgentWorkspaceStateMigrationBackup {
  readonly id: string;
  readonly path: string;
  readonly bytes: number;
  readonly createdAt: string;
  readonly referencedByMarker: boolean;
}

export interface AgentWorkspaceStateMigrationInventory {
  readonly stateRoot: string;
  readonly migrationRoot: string;
  readonly markerPath: string;
  readonly markerStatus: "missing" | "valid" | "invalid";
  readonly backups: readonly AgentWorkspaceStateMigrationBackup[];
}

interface MigrationMarkerSnapshot {
  readonly version: number;
  readonly backups: readonly string[];
}

export async function readAgentWorkspaceStateMigrationInventory(
  stateRoot: string,
): Promise<AgentWorkspaceStateMigrationInventory> {
  const resolvedStateRoot = path.resolve(stateRoot);
  const migrationRoot = path.join(resolvedStateRoot, MigrationDirectoryName);
  const hostStateRoot = path.join(migrationRoot, HostStateBackupDirectoryName);
  const markerPath = path.join(migrationRoot, MigrationMarkerName);
  const marker = await readMarker(markerPath);
  const referencedBackups = new Set(marker.value?.backups.map((backup) => path.resolve(backup)) ?? []);
  let entries: import("node:fs").Dirent[] = [];
  try {
    const directory = await fs.opendir(hostStateRoot);
    entries = [];
    for await (const entry of directory) entries.push(entry);
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }

  const backups: AgentWorkspaceStateMigrationBackup[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const backupPath = path.join(hostStateRoot, entry.name);
    const stat = await fs.stat(backupPath);
    backups.push({
      id: entry.name,
      path: backupPath,
      bytes: await readAgentDirectoryBytes(backupPath),
      createdAt: stat.birthtime.toISOString(),
      referencedByMarker: [...referencedBackups].some(
        (reference) =>
          reference === path.resolve(backupPath) || relativePathWithin(backupPath, reference) !== undefined,
      ),
    });
  }
  backups.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  return {
    stateRoot: resolvedStateRoot,
    migrationRoot,
    markerPath,
    markerStatus: marker.status,
    backups,
  };
}

export async function removeAgentWorkspaceStateMigrationBackup(input: {
  readonly stateRoot: string;
  readonly backupId: string;
}): Promise<AgentWorkspaceStateMigrationInventory> {
  const stateRoot = path.resolve(input.stateRoot);
  if (input.backupId !== path.basename(input.backupId)) {
    throw new Error("Migration backup id must be a directory name.");
  }
  const migrationRoot = path.join(stateRoot, MigrationDirectoryName);
  const hostStateRoot = path.join(migrationRoot, HostStateBackupDirectoryName);
  const backupPath = path.resolve(hostStateRoot, input.backupId);
  const markerPath = path.join(migrationRoot, MigrationMarkerName);
  const relative = relativePathWithin(hostStateRoot, backupPath);
  if (!relative || relative.includes(path.sep) || relative === ".") {
    throw new Error("Migration backup must be a direct child of the host-state backup directory.");
  }
  return migrationMutationLeases.run(markerPath, async () => {
    const stats = await fs.lstat(backupPath).catch((error: unknown) => {
      if (isMissingFileError(error)) return undefined;
      throw error;
    });
    if (stats && !stats.isDirectory()) throw new Error("Migration backup is not a directory.");
    if (stats?.isSymbolicLink()) throw new Error("Migration backup cannot be a symbolic link.");

    if (stats) await removeAgentPathWithRetry(backupPath, { recursive: true });
    await removeBackupFromMarker(markerPath, backupPath);
    return readAgentWorkspaceStateMigrationInventory(stateRoot);
  });
}

async function readMarker(filePath: string): Promise<{
  readonly status: AgentWorkspaceStateMigrationInventory["markerStatus"];
  readonly value?: MigrationMarkerSnapshot;
}> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return { status: "missing" };
    throw error;
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return { status: "invalid" };
    const marker = value as Partial<MigrationMarkerSnapshot>;
    if (typeof marker.version !== "number" || !Array.isArray(marker.backups)) return { status: "invalid" };
    const backups = marker.backups.filter((backup): backup is string => typeof backup === "string");
    if (backups.length !== marker.backups.length) return { status: "invalid" };
    return { status: "valid", value: { version: marker.version, backups } };
  } catch {
    return { status: "invalid" };
  }
}

async function removeBackupFromMarker(markerPath: string, backupPath: string): Promise<void> {
  const marker = await readMarker(markerPath);
  if (marker.status === "missing") return;
  if (marker.status === "invalid" || !marker.value) {
    throw new Error(`Cannot clean migration backup while marker is invalid: ${markerPath}`);
  }
  const backups = marker.value.backups.filter((candidate) => {
    const resolved = path.resolve(candidate);
    return resolved !== backupPath && relativePathWithin(backupPath, resolved) === undefined;
  });
  if (backups.length === marker.value.backups.length) return;
  const raw = JSON.parse(await fs.readFile(markerPath, "utf8")) as Record<string, unknown>;
  raw.version = Math.max(2, marker.value.version);
  raw.backups = backups;
  writeFileAtomicSync(markerPath, `${JSON.stringify(raw, null, 2)}\n`, { fsync: true });
}
