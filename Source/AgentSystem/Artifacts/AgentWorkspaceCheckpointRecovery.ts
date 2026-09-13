import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";
import { isMissingFileError, removeAgentPathWithRetry } from "../Core/AgentFs.js";
import { AgentResourceAccessIntents } from "../Safety/AgentResourceAccessPolicy.js";
import { SeneraWorkspaceBoundary, SeneraWorkspaceBoundaryError } from "../Execution/SeneraWorkspaceBoundary.js";
import { assertInsideRoot } from "./AgentArtifactLocator.js";
import {
  workspaceSnapshotRevision,
  type AgentWorkspaceContinuityCheckpoint,
} from "../Continuity/AgentContinuityLedger.js";
import { hashWorkspaceFile, hashWorkspaceText, missingWorkspaceSnapshot } from "./AgentWorkspaceSnapshotUtils.js";
import type { ToolWorkspaceFileSnapshot, ToolWorkspaceSnapshot } from "../Types/ToolRuntimeTypes.js";

export interface AgentWorkspaceCheckpointRestoreInput {
  readonly workspaceRoot: string;
  readonly checkpoint: AgentWorkspaceContinuityCheckpoint;
  readonly target: ToolWorkspaceSnapshot;
  /**
   * Legacy caller-provided revision. The host no longer needs this value: it
   * derives the expected revision from the checkpoint's opposite snapshot and
   * verifies the live workspace itself. When supplied, it remains an
   * additional consistency check for older callers.
   */
  readonly currentRevision?: string;
  /**
   * The snapshot that must still be present before the restore starts. The
   * host supplies this from the same Artifact as `target`; keeping it here
   * lets the runtime verify the revision instead of trusting model input.
   */
  readonly currentSnapshot?: ToolWorkspaceSnapshot;
  /** Which side of the captured before/after pair should be materialized. */
  readonly targetKind?: "before" | "after";
  readonly artifactRoot?: string;
  readonly signal?: AbortSignal;
}

const WorkspaceFileContentSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("captured"),
      encoding: z.literal("utf8"),
      byteLength: z.number().int().nonnegative(),
      lineCount: z.number().int().nonnegative(),
      text: z.string().optional(),
      artifactPath: z.string().optional(),
      relativeArtifactPath: z.string().optional(),
    })
    .strict(),
  z
    .object({
      state: z.literal("omitted"),
      reason: z.enum(["missing", "directory", "size_limit", "binary", "not_requested", "unsupported"]),
      byteLength: z.number().int().nonnegative().optional(),
    })
    .strict(),
]);

export const AgentWorkspaceFileSnapshotSchema = z
  .object({
    path: z.string().min(1),
    absolutePath: z.string().min(1),
    exists: z.boolean(),
    kind: z.enum(["file", "directory", "missing", "other", "symlink"]),
    size: z.number().nonnegative(),
    mtimeMs: z.number().nonnegative(),
    hash: z.string(),
    content: WorkspaceFileContentSchema.optional(),
    target: z.string().optional(),
  })
  .strict();

export const AgentWorkspaceSnapshotSchema = z
  .object({
    files: z.array(AgentWorkspaceFileSnapshotSchema),
    capturedAt: z.string().min(1),
    warnings: z.array(z.string()).optional(),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    const seen = new Set<string>();
    snapshot.files.forEach((entry, index) => {
      if (seen.has(entry.path)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["files", index, "path"],
          message: `Workspace snapshot contains duplicate path: ${entry.path}`,
        });
      }
      seen.add(entry.path);
      if (!entry.exists && entry.kind !== "missing") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["files", index, "kind"],
          message: "A non-existing workspace entry must have kind=missing.",
        });
      }
      if (entry.exists && entry.kind === "missing") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["files", index, "kind"],
          message: "An existing workspace entry cannot have kind=missing.",
        });
      }
    });
  });

export function readAgentWorkspaceSnapshot(value: unknown): ToolWorkspaceSnapshot {
  return AgentWorkspaceSnapshotSchema.parse(value);
}

export interface AgentWorkspaceCheckpointRestoreResult {
  readonly checkpointId: string;
  readonly baseRevision: string;
  readonly targetRevision: string;
  readonly restoredPaths: readonly string[];
  readonly skippedPaths: readonly { path: string; reason: string }[];
}

interface WorkspaceRestoreRollbackEntry {
  readonly path: string;
  readonly absolutePath: string;
  readonly kind: "missing" | "file" | "directory";
  readonly backupPath?: string;
}

interface WorkspaceRestoreRollback {
  readonly entries: readonly WorkspaceRestoreRollbackEntry[];
  restore(): Promise<void>;
  cleanup(): Promise<void>;
}

export class AgentWorkspaceCheckpointConflictError extends AgentBaseError {
  readonly code = "WorkspaceCheckpointConflict" as const;

  constructor(message: string) {
    super(message);
  }
}

/**
 * Restores a captured source snapshot under an explicit revision guard. The
 * operation is intentionally snapshot-based and leaves paths not present in
 * the target untouched; deleting unrelated files is never implicit.
 */
export async function restoreAgentWorkspaceCheckpoint(
  input: AgentWorkspaceCheckpointRestoreInput,
): Promise<AgentWorkspaceCheckpointRestoreResult> {
  throwIfAborted(input.signal);
  const targetKind = input.targetKind ?? "after";
  const targetRevision = workspaceSnapshotRevision(input.target);
  const expectedTargetRevision = targetKind === "after" ? input.checkpoint.revision : input.checkpoint.baseRevision;
  const expectedCurrentRevision = targetKind === "after" ? input.checkpoint.baseRevision : input.checkpoint.revision;
  if (targetRevision !== expectedTargetRevision) {
    throw new AgentWorkspaceCheckpointConflictError(
      `Workspace checkpoint ${input.checkpoint.id} does not match its ${targetKind} snapshot revision.`,
    );
  }
  if (input.currentRevision !== undefined && input.currentRevision !== expectedCurrentRevision) {
    throw new AgentWorkspaceCheckpointConflictError(
      `Workspace changed since checkpoint ${input.checkpoint.id}; expected ${expectedCurrentRevision}, received ${input.currentRevision}.`,
    );
  }
  if (!input.currentSnapshot && input.currentRevision === undefined) {
    throw new AgentWorkspaceCheckpointConflictError(
      `Workspace checkpoint ${input.checkpoint.id} requires a live workspace revision guard.`,
    );
  }

  const boundary = new SeneraWorkspaceBoundary({ workspaceRoot: input.workspaceRoot, linkPolicy: "deny" });
  if (input.currentSnapshot) {
    await assertLiveWorkspaceRevision(input, expectedCurrentRevision);
  }
  const entries = sortRestoreEntries(input.target.files);
  const preparedTexts = await prepareRestoreTexts(entries, input.artifactRoot, input.signal);
  // Artifact reads can be large. Revalidate after they complete so a concurrent
  // writer cannot change the workspace during preparation and still receive a
  // restore based on the old revision.
  if (input.currentSnapshot) await assertLiveWorkspaceRevision(input, expectedCurrentRevision);
  const rollback = await prepareWorkspaceRestoreRollback(input.workspaceRoot, entries, input.signal);
  const restoredPaths: string[] = [];
  const skippedPaths: Array<{ path: string; reason: string }> = [];
  try {
    for (const entry of entries) {
      throwIfAborted(input.signal);
      const outcome = await restoreFile(entry, boundary, preparedTexts);
      if (outcome.kind === "restored") restoredPaths.push(entry.path);
      else skippedPaths.push({ path: entry.path, reason: outcome.reason });
    }
  } catch (error) {
    try {
      await rollback.restore();
    } catch (rollbackError) {
      throw new AgentWorkspaceCheckpointConflictError(
        `Workspace checkpoint ${input.checkpoint.id} failed and rollback also failed: ${errorText(rollbackError)}.`,
      );
    }
    throw error;
  } finally {
    await rollback.cleanup();
  }
  return {
    checkpointId: input.checkpoint.id,
    baseRevision: input.checkpoint.baseRevision,
    targetRevision,
    restoredPaths,
    skippedPaths,
  };
}

/**
 * Captures the exact pre-restore state needed to undo a partial multi-path
 * restore. This is a bounded per-target backup, not a second workspace copy;
 * directories are only recreated because restore never mutates their existing
 * children unless those children are explicitly listed in the target snapshot.
 */
async function prepareWorkspaceRestoreRollback(
  workspaceRoot: string,
  entries: readonly ToolWorkspaceFileSnapshot[],
  signal: AbortSignal | undefined,
): Promise<WorkspaceRestoreRollback> {
  const backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), "senera-workspace-rollback-"));
  const rollbackEntries: WorkspaceRestoreRollbackEntry[] = [];
  try {
    for (const [index, entry] of entries.entries()) {
      throwIfAborted(signal);
      const absolutePath = assertInsideRoot(
        workspaceRoot,
        path.resolve(workspaceRoot, entry.path),
        `workspace checkpoint 路径超出工作区：${entry.path}`,
      );
      await assertNoSymlinkAncestors(workspaceRoot, absolutePath, entry.path);
      const stat = await fs.lstat(absolutePath).catch((error) => {
        if (isMissingFileError(error) || (error as NodeJS.ErrnoException).code === "ENOTDIR") return undefined;
        throw error;
      });
      if (!stat) {
        rollbackEntries.push({ path: entry.path, absolutePath, kind: "missing" });
        continue;
      }
      if (stat.isSymbolicLink()) {
        throw new AgentWorkspaceCheckpointConflictError(
          `Cannot restore ${entry.path}; the current workspace entry is a symbolic link.`,
        );
      }
      if (stat.isFile()) {
        const backupPath = path.join(backupRoot, `${index}.file`);
        await fs.copyFile(absolutePath, backupPath);
        rollbackEntries.push({ path: entry.path, absolutePath, kind: "file", backupPath });
        continue;
      }
      if (stat.isDirectory()) {
        rollbackEntries.push({ path: entry.path, absolutePath, kind: "directory" });
        continue;
      }
      throw new AgentWorkspaceCheckpointConflictError(
        `Cannot restore ${entry.path}; the current workspace entry has an unsupported type.`,
      );
    }
  } catch (error) {
    await cleanupRollbackDirectory(backupRoot).catch(() => undefined);
    throw error;
  }

  return {
    entries: rollbackEntries,
    restore: () => restoreWorkspaceRollback(workspaceRoot, rollbackEntries),
    cleanup: () => cleanupRollbackDirectory(backupRoot),
  };
}

/**
 * Rollback files are host-owned temporary state. Windows can keep a directory
 * busy briefly after its last handle closes, so use the shared removal policy
 * and move an irreducibly locked directory out of the active temp namespace.
 * This cleanup path never changes the workspace restore result.
 */
async function cleanupRollbackDirectory(backupRoot: string): Promise<void> {
  await removeAgentPathWithRetry(backupRoot, { recursive: true, deferOnBusy: true });
}

async function restoreWorkspaceRollback(
  workspaceRoot: string,
  entries: readonly WorkspaceRestoreRollbackEntry[],
): Promise<void> {
  const boundary = new SeneraWorkspaceBoundary({ workspaceRoot, linkPolicy: "deny" });
  for (const entry of [...entries].reverse()) {
    const resolved = await resolveRollbackPath(boundary, entry);
    if (!resolved) continue;
    if (entry.kind === "missing") {
      await removeFile(resolved.absolutePath);
      continue;
    }
    if (entry.kind === "directory") {
      const existing = await fs.lstat(resolved.absolutePath).catch((error) => {
        if (isMissingFileError(error)) return undefined;
        throw error;
      });
      if (!existing) {
        await fs.mkdir(resolved.absolutePath, { recursive: true });
      } else if (!existing.isDirectory() || existing.isSymbolicLink()) {
        await removeFile(resolved.absolutePath);
        await fs.mkdir(resolved.absolutePath, { recursive: true });
      }
      continue;
    }
    if (!entry.backupPath) throw new Error(`Missing rollback backup for ${entry.path}.`);
    const existing = await fs.lstat(resolved.absolutePath).catch((error) => {
      if (isMissingFileError(error)) return undefined;
      throw error;
    });
    if (existing?.isDirectory() && !existing.isSymbolicLink()) await removeFile(resolved.absolutePath);
    await fs.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
    await fs.copyFile(entry.backupPath, resolved.absolutePath);
  }
}

async function resolveRollbackPath(
  boundary: SeneraWorkspaceBoundary,
  entry: WorkspaceRestoreRollbackEntry,
): Promise<Awaited<ReturnType<SeneraWorkspaceBoundary["resolve"]>> | undefined> {
  try {
    return await boundary.resolve(entry.path, AgentResourceAccessIntents.Replace);
  } catch (error) {
    const unresolved =
      (error instanceof SeneraWorkspaceBoundaryError && error.code === "unresolved_path") ||
      (error as NodeJS.ErrnoException).code === "ENOTDIR";
    if (entry.kind === "missing" && unresolved) {
      const stat = await fs.lstat(entry.absolutePath).catch((statError) => {
        if (isMissingFileError(statError) || (statError as NodeJS.ErrnoException).code === "ENOTDIR") return undefined;
        throw statError;
      });
      if (!stat) return undefined;
    }
    throw error;
  }
}

async function assertNoSymlinkAncestors(
  workspaceRoot: string,
  absolutePath: string,
  displayPath: string,
): Promise<void> {
  const relative = path.relative(path.resolve(workspaceRoot), absolutePath);
  let current = path.resolve(workspaceRoot);
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current).catch((error) => {
      if (isMissingFileError(error) || (error as NodeJS.ErrnoException).code === "ENOTDIR") return undefined;
      throw error;
    });
    if (stat?.isSymbolicLink()) {
      throw new AgentWorkspaceCheckpointConflictError(
        `Cannot restore ${displayPath}; its current path contains a symbolic link.`,
      );
    }
    if (stat && !stat.isDirectory() && current !== absolutePath) return;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function assertLiveWorkspaceRevision(
  input: AgentWorkspaceCheckpointRestoreInput,
  expectedCurrentRevision: string,
): Promise<void> {
  if (!input.currentSnapshot) return;
  const snapshotRevision = workspaceSnapshotRevision(input.currentSnapshot);
  if (snapshotRevision !== expectedCurrentRevision) {
    throw new AgentWorkspaceCheckpointConflictError(
      `Workspace checkpoint ${input.checkpoint.id} contains an invalid current snapshot revision.`,
    );
  }
  const liveSnapshot = await readLiveWorkspaceSnapshot(input.currentSnapshot, input.workspaceRoot, input.signal);
  const liveRevision = workspaceSnapshotRevision(liveSnapshot);
  if (liveRevision !== expectedCurrentRevision) {
    throw new AgentWorkspaceCheckpointConflictError(
      `Workspace changed since checkpoint ${input.checkpoint.id}; expected ${expectedCurrentRevision}, received ${liveRevision}.`,
    );
  }
  await assertUncoveredTargetPathsAbsent(input);
}

/**
 * A before/after capture can discover a path only after the tool runs. Such a
 * path is absent from the opposite snapshot and therefore cannot contribute to
 * its revision. Treat an existing live entry as a conflict instead of
 * overwriting it without an optimistic guard.
 */
async function assertUncoveredTargetPathsAbsent(input: AgentWorkspaceCheckpointRestoreInput): Promise<void> {
  if (!input.currentSnapshot) return;
  const covered = new Set(input.currentSnapshot.files.map((entry) => entry.path));
  const boundary = new SeneraWorkspaceBoundary({ workspaceRoot: input.workspaceRoot, linkPolicy: "deny" });
  for (const entry of input.target.files) {
    if (!entry.exists || entry.kind === "missing" || covered.has(entry.path)) continue;
    throwIfAborted(input.signal);
    const resolved = await boundary.resolve(entry.path, AgentResourceAccessIntents.Read);
    const stat = await fs.lstat(resolved.absolutePath).catch((error) => {
      if (isMissingFileError(error)) return undefined;
      throw error;
    });
    if (stat) {
      throw new AgentWorkspaceCheckpointConflictError(
        `Workspace path ${entry.path} was not covered by the checkpoint's current snapshot and now exists.`,
      );
    }
  }
}

async function restoreFile(
  entry: ToolWorkspaceFileSnapshot,
  boundary: SeneraWorkspaceBoundary,
  preparedTexts: ReadonlyMap<string, string | undefined>,
): Promise<{ readonly kind: "restored" } | { readonly kind: "skipped"; readonly reason: string }> {
  const resolved = await boundary.resolve(entry.path, AgentResourceAccessIntents.Replace);
  const absolutePath = resolved.absolutePath;
  if (!entry.exists || entry.kind === "missing") {
    await removeFile(absolutePath);
    return { kind: "restored" };
  }
  if (entry.kind === "directory") {
    const existing = await fs.lstat(absolutePath).catch(() => undefined);
    if (existing?.isSymbolicLink()) {
      throw new AgentWorkspaceCheckpointConflictError(
        `Cannot restore directory ${entry.path}: the current workspace entry has a different type.`,
      );
    }
    if (existing && !existing.isDirectory()) await fs.rm(absolutePath, { force: true });
    await fs.mkdir(absolutePath, { recursive: true });
    return { kind: "restored" };
  }
  if (entry.kind !== "file") return { kind: "skipped", reason: `unsupported_${entry.kind}` };
  const content = entry.content;
  if (!content || content.state !== "captured")
    return { kind: "skipped", reason: content?.reason ?? "content_unavailable" };
  const text = preparedTexts.get(entry.path);
  if (text === undefined) return { kind: "skipped", reason: "artifact_content_unavailable" };
  const existing = await fs.lstat(absolutePath).catch(() => undefined);
  if (existing?.isSymbolicLink()) {
    throw new AgentWorkspaceCheckpointConflictError(
      `Cannot restore file ${entry.path}: the current workspace entry has a different type.`,
    );
  }
  if (existing?.isDirectory()) await removeFile(absolutePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, text, "utf8");
  return { kind: "restored" };
}

/** Reads and verifies every writable text before the first filesystem mutation. */
async function prepareRestoreTexts(
  entries: readonly ToolWorkspaceFileSnapshot[],
  artifactRoot: string | undefined,
  signal: AbortSignal | undefined,
): Promise<ReadonlyMap<string, string | undefined>> {
  const prepared = new Map<string, string | undefined>();
  for (const entry of entries) {
    throwIfAborted(signal);
    if (entry.kind !== "file" || !entry.exists || entry.content?.state !== "captured") continue;
    const content = entry.content;
    const artifactReference = content.relativeArtifactPath ?? content.artifactPath;
    const text =
      content.text ??
      (artifactReference && artifactRoot ? await readArtifactText(artifactReference, artifactRoot, signal) : undefined);
    if (text !== undefined) validateCapturedText(entry, text);
    prepared.set(entry.path, text);
  }
  return prepared;
}

/**
 * A snapshot is a tree, so lexical ordering is not a valid restore order.
 * Deletions run deepest-first, while directories are created before files.
 * This handles directory/file type changes without making unrelated paths
 * deletable by accident.
 */
function sortRestoreEntries(entries: readonly ToolWorkspaceFileSnapshot[]): ToolWorkspaceFileSnapshot[] {
  return [...entries].sort((left, right) => {
    const leftDepth = workspacePathDepth(left.path);
    const rightDepth = workspacePathDepth(right.path);
    const leftMissing = !left.exists || left.kind === "missing";
    const rightMissing = !right.exists || right.kind === "missing";
    if (leftMissing !== rightMissing) return leftMissing ? -1 : 1;
    if (leftMissing && leftDepth !== rightDepth) return rightDepth - leftDepth;
    const leftDirectory = left.exists && left.kind === "directory";
    const rightDirectory = right.exists && right.kind === "directory";
    if (leftDirectory !== rightDirectory) return leftDirectory ? -1 : 1;
    if (leftDirectory && leftDepth !== rightDepth) return leftDepth - rightDepth;
    return left.path.localeCompare(right.path);
  });
}

function workspacePathDepth(value: string): number {
  return value.split(/[\\/]+/u).filter(Boolean).length;
}

/** Reads only the paths captured in the expected current snapshot. */
async function readLiveWorkspaceSnapshot(
  expected: ToolWorkspaceSnapshot,
  workspaceRoot: string,
  signal: AbortSignal | undefined,
): Promise<ToolWorkspaceSnapshot> {
  const boundary = new SeneraWorkspaceBoundary({ workspaceRoot, linkPolicy: "allow_internal" });
  const files: ToolWorkspaceFileSnapshot[] = [];
  for (const entry of expected.files) {
    throwIfAborted(signal);
    const lexicalPath = assertInsideRoot(
      workspaceRoot,
      path.resolve(workspaceRoot, entry.path),
      `workspace snapshot 路径超出工作区：${entry.path}`,
    );
    let resolved: Awaited<ReturnType<SeneraWorkspaceBoundary["resolve"]>> | undefined;
    try {
      resolved = await boundary.resolve(entry.path, AgentResourceAccessIntents.Read);
    } catch (error) {
      // A missing descendant under a file produces ENOTDIR during boundary
      // inspection. It is still a valid missing snapshot entry; writes to the
      // path remain guarded by the normal mutation boundary later.
      if (!entry.exists) {
        files.push(missingWorkspaceSnapshot(entry.path, lexicalPath));
        continue;
      }
      throw error;
    }
    const stat = await fs.lstat(lexicalPath).catch((error) => {
      if (isMissingFileError(error)) return undefined;
      throw error;
    });
    if (!stat) {
      files.push(missingWorkspaceSnapshot(entry.path, lexicalPath));
      continue;
    }

    if (stat.isSymbolicLink()) {
      const target = await fs.readlink(lexicalPath);
      files.push({
        ...entry,
        absolutePath: lexicalPath,
        exists: true,
        kind: "symlink",
        size: stat.size,
        hash: hashWorkspaceText(target),
        target,
      });
      continue;
    }

    const kind = stat.isFile() ? "file" : stat.isDirectory() ? "directory" : "other";
    const hash = stat.isFile()
      ? await hashWorkspaceFile(resolved.absolutePath)
      : hashWorkspaceText(`${kind}:${stat.size}:${Math.floor(stat.mtimeMs)}`);
    files.push({
      ...entry,
      absolutePath: resolved.absolutePath,
      exists: true,
      kind,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      hash,
    });
  }
  return { capturedAt: expected.capturedAt, files, warnings: expected.warnings };
}

function validateCapturedText(entry: ToolWorkspaceFileSnapshot, text: string): void {
  const expectedBytes = entry.content?.state === "captured" ? entry.content.byteLength : undefined;
  const actualBytes = Buffer.byteLength(text, "utf8");
  if (expectedBytes !== undefined && actualBytes !== expectedBytes) {
    throw new AgentWorkspaceCheckpointConflictError(
      `Workspace checkpoint content length mismatch for ${entry.path}; expected ${expectedBytes}, received ${actualBytes}.`,
    );
  }
  const expectedHash = entry.hash;
  if (expectedHash && hashWorkspaceText(text) !== expectedHash) {
    throw new AgentWorkspaceCheckpointConflictError(`Workspace checkpoint content hash mismatch for ${entry.path}.`);
  }
}

async function readArtifactText(
  filePath: string,
  artifactRoot: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  throwIfAborted(signal);
  const boundary = new SeneraWorkspaceBoundary({ workspaceRoot: artifactRoot, linkPolicy: "deny" });
  const resolved = await boundary.resolve(filePath, AgentResourceAccessIntents.Read);
  const text = await fs.readFile(resolved.absolutePath, "utf8");
  throwIfAborted(signal);
  return text;
}

async function removeFile(filePath: string): Promise<void> {
  const stat = await fs.lstat(filePath).catch(() => undefined);
  if (!stat) return;
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    const entries = await fs.readdir(filePath);
    if (entries.length > 0) {
      throw new AgentWorkspaceCheckpointConflictError(`Refusing to remove non-empty workspace directory: ${filePath}`);
    }
  }
  await fs.rm(filePath, { force: true, recursive: stat.isDirectory() && !stat.isSymbolicLink() });
}
