import fs from "node:fs";
import path from "node:path";
import { copyAgentPathSync, isMissingFileError, removeAgentPathSync, writeFileAtomicSync } from "../Core/AgentFs.js";
import type { AgentWorkspaceLayout } from "../Core/AgentWorkspaceLayout.js";

const MigrationDirectoryName = "migrations";
const MigrationMarkerName = "host-state.json";
const CurrentMigrationVersion = 3 as const;

interface AgentWorkspaceStateMigrationInput {
  readonly workspaceRoot: string;
  readonly workspaceId: string;
  readonly source: AgentWorkspaceLayout;
  readonly target: AgentWorkspaceLayout;
  readonly legacyConfigPath?: string;
  readonly targetConfigPath?: string;
  readonly additionalEntries?: readonly AgentWorkspaceStateMigrationEntry[];
}

interface AgentWorkspaceStateMigrationEntry {
  readonly source: string;
  readonly target: string;
}

interface AgentWorkspaceStateMigrationMarker {
  readonly version: 1 | 2 | 3;
  readonly workspaceId: string;
  readonly sourceStateRoot: string;
  readonly targetStateRoot: string;
  readonly completedAt: string;
  readonly backups: readonly string[];
}

export type AgentWorkspaceStateMigrationResult =
  | { readonly status: "not-needed" }
  | { readonly status: "already-complete"; readonly markerPath: string }
  | { readonly status: "migrated"; readonly markerPath: string; readonly backupRoot?: string };

/**
 * Imports old application-owned workspace state into the workspace itself.
 * The source is deliberately copied, never removed. Existing workspace state
 * always wins: migration only fills missing entries and never replaces or
 * moves data already created in the workspace.
 */
export function migrateAgentWorkspaceState(
  input: AgentWorkspaceStateMigrationInput,
): AgentWorkspaceStateMigrationResult {
  const sourceStateRoot = path.resolve(input.source.stateRoot);
  const targetStateRoot = path.resolve(input.target.stateRoot);
  const markerPath = path.join(targetStateRoot, MigrationDirectoryName, MigrationMarkerName);
  if (sourceStateRoot === targetStateRoot) return { status: "not-needed" };

  const marker = readMigrationMarker(markerPath);
  const markerMatchesMigration = Boolean(
    marker &&
    marker.workspaceId === input.workspaceId &&
    marker.sourceStateRoot === sourceStateRoot &&
    marker.targetStateRoot === targetStateRoot,
  );
  if (markerMatchesMigration && marker?.version === CurrentMigrationVersion) {
    return { status: "already-complete", markerPath };
  }

  const targetConfigPath = input.targetConfigPath ? path.resolve(input.targetConfigPath) : undefined;
  const legacyConfigPath = input.legacyConfigPath ? path.resolve(input.legacyConfigPath) : undefined;
  const additionalEntries = (input.additionalEntries ?? [])
    .map((entry) => ({ source: path.resolve(entry.source), target: path.resolve(entry.target) }))
    // A source that already is the target has nothing to migrate; keeping it
    // would bypass the not-needed shortcut and write a permanent marker.
    .filter((entry) => entry.source !== entry.target && fs.existsSync(entry.source));
  const shouldPreserveTargetConfig = Boolean(targetConfigPath && fs.existsSync(targetConfigPath));
  const migrationEntries = [
    { source: input.source.dataRoot, target: input.target.dataRoot, preserve: shouldPreserveTargetConfig },
    { source: input.source.piSessionsRoot, target: input.target.piSessionsRoot, preserve: false },
    { source: input.source.userPluginsRoot, target: input.target.userPluginsRoot, preserve: false },
  ].filter((entry) => fs.existsSync(entry.source));
  const shouldCopyConfig = Boolean(
    legacyConfigPath && targetConfigPath && !shouldPreserveTargetConfig && fs.existsSync(legacyConfigPath),
  );
  if (migrationEntries.length === 0 && !shouldCopyConfig && additionalEntries.length === 0) {
    if (markerMatchesMigration && marker) {
      writeFileAtomicSync(
        markerPath,
        `${JSON.stringify({ ...marker, version: CurrentMigrationVersion, completedAt: new Date().toISOString() }, null, 2)}\n`,
        { fsync: true },
      );
      return { status: "migrated", markerPath };
    }
    return { status: "not-needed" };
  }

  const copiedTargets: string[] = [];
  let copiedConfig = false;
  try {
    fs.mkdirSync(targetStateRoot, { recursive: true });
    if (shouldCopyConfig) {
      fs.mkdirSync(path.dirname(targetConfigPath!), { recursive: true });
      copyAgentPathSync(legacyConfigPath!, targetConfigPath!);
      copiedConfig = true;
    }
    for (const entry of migrationEntries) {
      if (entry.preserve && path.resolve(entry.target) === path.resolve(input.target.dataRoot)) {
        copyDataDomainsWithoutConfig(entry.source, entry.target, copiedTargets);
        continue;
      }
      copyMissingManagedPath(entry.source, entry.target, copiedTargets);
    }
    for (const entry of additionalEntries) {
      if (shouldPreserveTargetConfig && targetConfigPath && path.resolve(entry.target) === targetConfigPath) continue;
      copyMissingManagedPath(entry.source, entry.target, copiedTargets);
    }

    const marker: AgentWorkspaceStateMigrationMarker = {
      version: CurrentMigrationVersion,
      workspaceId: input.workspaceId,
      sourceStateRoot,
      targetStateRoot,
      completedAt: new Date().toISOString(),
      backups: [],
    };
    writeFileAtomicSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, { fsync: true });
    return { status: "migrated", markerPath };
  } catch (error) {
    for (const target of copiedTargets.reverse()) removeAgentPathSync(target, { force: true, recursive: true });
    if (copiedConfig && targetConfigPath) removeAgentPathSync(targetConfigPath, { force: true });
    throw new Error(`Workspace state migration failed for ${input.workspaceRoot}; the legacy source was preserved.`, {
      cause: error,
    });
  }
}

function copyDataDomainsWithoutConfig(sourceRoot: string, targetRoot: string, copiedTargets: string[]): void {
  if (!fs.existsSync(sourceRoot)) return;
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    if (entry.name === "config") continue;
    copyMissingManagedPath(path.join(sourceRoot, entry.name), path.join(targetRoot, entry.name), copiedTargets);
  }
}

function copyMissingManagedPath(source: string, target: string, copiedTargets: string[]): void {
  if (!fs.existsSync(source)) return;
  const sourceStats = fs.lstatSync(source);
  const targetStats = fs.existsSync(target) ? fs.lstatSync(target) : undefined;
  if (targetStats) {
    if (!sourceStats.isDirectory() || !targetStats.isDirectory() || targetStats.isSymbolicLink()) return;
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      copyMissingManagedPath(path.join(source, entry.name), path.join(target, entry.name), copiedTargets);
    }
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  copyAgentPathSync(source, target, { recursive: sourceStats.isDirectory(), force: false, errorOnExist: true });
  copiedTargets.push(target);
}

function readMigrationMarker(filePath: string): AgentWorkspaceStateMigrationMarker | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Workspace state migration marker is invalid: ${filePath}`, { cause: error });
  }
  if (!value || typeof value !== "object") {
    throw new Error(`Workspace state migration marker is invalid: ${filePath}`);
  }
  const marker = value as Partial<AgentWorkspaceStateMigrationMarker>;
  if (
    (marker.version !== 1 && marker.version !== 2 && marker.version !== CurrentMigrationVersion) ||
    typeof marker.workspaceId !== "string" ||
    typeof marker.sourceStateRoot !== "string" ||
    typeof marker.targetStateRoot !== "string" ||
    !Array.isArray(marker.backups)
  ) {
    throw new Error(`Workspace state migration marker is invalid: ${filePath}`);
  }
  return value as AgentWorkspaceStateMigrationMarker;
}
