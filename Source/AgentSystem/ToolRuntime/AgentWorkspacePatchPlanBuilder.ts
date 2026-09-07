import type { FileInfo } from "@earendil-works/pi-agent-core";
import { applyPatch } from "diff";
import path from "node:path";
import { errorMessage } from "../Core/AgentErrors.js";
import type { SeneraExecutionEnv } from "../Execution/SeneraExecutionTypes.js";
import {
  resolveWorkspacePath,
  validateWorkspaceMutationPath,
  workspaceRelativePath,
} from "../Execution/SeneraWorkspacePath.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import type { WorkspaceApplyPatchArguments, WorkspacePatchOperation } from "./AgentWorkspaceApplyPatchContract.js";
import { WorkspaceApplyPatchError } from "./AgentWorkspacePatchError.js";
import {
  addWorkspaceMissingPrecondition as addMissingPrecondition,
  captureWorkspaceFilePrecondition as captureExistingFilePrecondition,
  readWorkspaceTextFileWithPrecondition as readExistingFile,
  type WorkspacePatchPrecondition,
  type WorkspacePatchTarget,
} from "./AgentWorkspacePatchTransaction.js";

const DeleteFile = Symbol("delete-file");

interface PlannedFileWrite {
  readonly target: WorkspacePatchTarget;
  readonly content: string;
}

interface PlannedFileDelete {
  readonly target: WorkspacePatchTarget;
}

interface PlannedDirectoryCreate {
  readonly target: WorkspacePatchTarget;
}

interface PlannedDirectoryDelete {
  readonly target: WorkspacePatchTarget;
  readonly recursive: boolean;
}

export interface WorkspacePatchOperationSummary {
  readonly kind: WorkspacePatchOperation["kind"];
  readonly path?: string;
  readonly source?: string;
  readonly destination?: string;
  readonly changedPaths: string[];
}

export interface WorkspacePatchPlan {
  readonly workspaceRoot: string;
  readonly dryRun: boolean;
  readonly fuzzFactor: number;
  readonly operations: WorkspacePatchOperationSummary[];
  readonly writes: Map<string, PlannedFileWrite>;
  readonly deletes: Map<string, PlannedFileDelete>;
  readonly createDirectories: Map<string, PlannedDirectoryCreate>;
  readonly deleteDirectories: Map<string, PlannedDirectoryDelete>;
  readonly preconditions: Map<string, WorkspacePatchPrecondition>;
}

type PendingFileState = PlannedFileWrite | typeof DeleteFile;

interface OperationPlanningInput<TOperation extends WorkspacePatchOperation = WorkspacePatchOperation> {
  readonly operation: TOperation;
  readonly workspaceRoot: string;
  readonly files: SeneraExecutionEnv;
  readonly plan: WorkspacePatchPlan;
  readonly pendingFiles: Map<string, PendingFileState>;
}

export async function buildWorkspacePatchPlan(
  args: WorkspaceApplyPatchArguments,
  workspaceRoot: string,
  files: SeneraExecutionEnv,
): Promise<WorkspacePatchPlan> {
  const plan: WorkspacePatchPlan = {
    workspaceRoot: path.resolve(workspaceRoot),
    dryRun: args.dryRun === true,
    fuzzFactor: args.fuzzFactor ?? 0,
    operations: [],
    writes: new Map(),
    deletes: new Map(),
    createDirectories: new Map(),
    deleteDirectories: new Map(),
    preconditions: new Map(),
  };
  const pendingFiles = new Map<string, PendingFileState>();
  for (const [index, operation] of args.operations.entries()) {
    await planOperation({ operation, workspaceRoot, files, plan, pendingFiles }, index);
  }
  rejectDirectoryDeleteConflicts(plan);
  return plan;
}

export function collectWorkspacePatchChangedPaths(plan: WorkspacePatchPlan): string[] {
  const paths = new Set<string>();
  for (const operation of plan.operations) {
    for (const changedPath of operation.changedPaths) paths.add(changedPath);
  }
  return [...paths].sort();
}

async function planOperation(input: OperationPlanningInput, index: number): Promise<void> {
  const pointer = `/operations/${index}`;
  switch (input.operation.kind) {
    case "add":
      await planAdd({ ...input, operation: input.operation }, pointer);
      return;
    case "update":
      await planUpdate({ ...input, operation: input.operation }, pointer);
      return;
    case "replace":
      await planReplace({ ...input, operation: input.operation }, pointer);
      return;
    case "delete":
      await planDelete({ ...input, operation: input.operation }, pointer);
      return;
    case "move":
      await planMove({ ...input, operation: input.operation }, pointer);
      return;
    case "createDirectory":
      await planCreateDirectory({ ...input, operation: input.operation }, pointer);
      return;
    case "deleteDirectory":
      await planDeleteDirectory({ ...input, operation: input.operation }, pointer);
      return;
  }
}

async function planAdd(
  input: OperationPlanningInput<Extract<WorkspacePatchOperation, { kind: "add" }>>,
  pointer: string,
): Promise<void> {
  const target = await resolveTarget(input.workspaceRoot, input.operation.path, `${pointer}/path`);
  ensurePathUnused(input.plan, target, `${pointer}/path`);
  const existing = await fileInfoOrUndefined(input.files, target.relativePath, `${pointer}/path`);
  if (existing) {
    throw new WorkspaceApplyPatchError({
      message: agentErrorMessage("workspacePatch.addFileExists", { path: target.relativePath }),
      pointer: `${pointer}/path`,
      suggestion: agentErrorMessage("workspacePatch.addFileExistsSuggestion"),
    });
  }
  addMissingPrecondition(input.plan, target, `${pointer}/path`);
  addWrite(input.plan, input.pendingFiles, { target, content: input.operation.content }, `${pointer}/path`);
  input.plan.operations.push({ kind: "add", path: target.relativePath, changedPaths: [target.relativePath] });
}

async function planUpdate(
  input: OperationPlanningInput<Extract<WorkspacePatchOperation, { kind: "update" }>>,
  pointer: string,
): Promise<void> {
  const target = await resolveTarget(input.workspaceRoot, input.operation.path, `${pointer}/path`);
  ensurePathUnused(input.plan, target, `${pointer}/path`);
  const content = await readExistingFile(
    input.files,
    target,
    `${pointer}/path`,
    input.plan,
    input.operation.expectedSha256,
  );
  const patched = applyHunkPatch({
    oldPath: target.relativePath,
    newPath: target.relativePath,
    source: content,
    hunkPatch: input.operation.patch,
    fuzzFactor: input.plan.fuzzFactor,
    pointer: `${pointer}/patch`,
  });
  addWrite(input.plan, input.pendingFiles, { target, content: patched }, `${pointer}/path`);
  input.plan.operations.push({ kind: "update", path: target.relativePath, changedPaths: [target.relativePath] });
}

async function planReplace(
  input: OperationPlanningInput<Extract<WorkspacePatchOperation, { kind: "replace" }>>,
  pointer: string,
): Promise<void> {
  const target = await resolveTarget(input.workspaceRoot, input.operation.path, `${pointer}/path`);
  ensurePathUnused(input.plan, target, `${pointer}/path`);
  await captureExistingFilePrecondition(
    input.files,
    target,
    `${pointer}/path`,
    input.plan,
    input.operation.expectedSha256,
  );
  addWrite(input.plan, input.pendingFiles, { target, content: input.operation.content }, `${pointer}/path`);
  input.plan.operations.push({ kind: "replace", path: target.relativePath, changedPaths: [target.relativePath] });
}

async function planDelete(
  input: OperationPlanningInput<Extract<WorkspacePatchOperation, { kind: "delete" }>>,
  pointer: string,
): Promise<void> {
  const target = await resolveTarget(input.workspaceRoot, input.operation.path, `${pointer}/path`);
  ensurePathUnused(input.plan, target, `${pointer}/path`);
  const stat = await requiredFileInfo(input.files, target, `${pointer}/path`);
  if (stat.kind !== "file") {
    throw new WorkspaceApplyPatchError({
      message: agentErrorMessage("workspacePatch.deleteFileOnly", { path: target.relativePath }),
      pointer: `${pointer}/path`,
      suggestion: agentErrorMessage("workspacePatch.deleteFileOnlySuggestion"),
    });
  }
  await captureExistingFilePrecondition(
    input.files,
    target,
    `${pointer}/path`,
    input.plan,
    input.operation.expectedSha256,
  );
  input.plan.deletes.set(target.relativePath, { target });
  input.pendingFiles.set(target.relativePath, DeleteFile);
  input.plan.operations.push({ kind: "delete", path: target.relativePath, changedPaths: [target.relativePath] });
}

async function planMove(
  input: OperationPlanningInput<Extract<WorkspacePatchOperation, { kind: "move" }>>,
  pointer: string,
): Promise<void> {
  const source = await resolveTarget(input.workspaceRoot, input.operation.source, `${pointer}/source`);
  const destination = await resolveTarget(input.workspaceRoot, input.operation.destination, `${pointer}/destination`);
  if (source.relativePath === destination.relativePath) {
    throw new WorkspaceApplyPatchError({
      message: agentErrorMessage("workspacePatch.moveSamePath", { path: source.relativePath }),
      pointer,
    });
  }
  ensurePathUnused(input.plan, source, `${pointer}/source`);
  ensurePathUnused(input.plan, destination, `${pointer}/destination`);
  const content = await readExistingFile(
    input.files,
    source,
    `${pointer}/source`,
    input.plan,
    input.operation.expectedSha256,
  );
  const destinationExisting = await fileInfoOrUndefined(
    input.files,
    destination.relativePath,
    `${pointer}/destination`,
  );
  if (destinationExisting) {
    throw new WorkspaceApplyPatchError({
      message: agentErrorMessage("workspacePatch.moveDestinationExists", { path: destination.relativePath }),
      pointer: `${pointer}/destination`,
    });
  }
  addMissingPrecondition(input.plan, destination, `${pointer}/destination`);
  const contentAtDestination = input.operation.patch
    ? applyHunkPatch({
        oldPath: source.relativePath,
        newPath: destination.relativePath,
        source: content,
        hunkPatch: input.operation.patch,
        fuzzFactor: input.plan.fuzzFactor,
        pointer: `${pointer}/patch`,
      })
    : content;
  input.plan.deletes.set(source.relativePath, { target: source });
  input.pendingFiles.set(source.relativePath, DeleteFile);
  addWrite(
    input.plan,
    input.pendingFiles,
    { target: destination, content: contentAtDestination },
    `${pointer}/destination`,
  );
  input.plan.operations.push({
    kind: "move",
    source: source.relativePath,
    destination: destination.relativePath,
    changedPaths: [source.relativePath, destination.relativePath],
  });
}

async function planCreateDirectory(
  input: OperationPlanningInput<Extract<WorkspacePatchOperation, { kind: "createDirectory" }>>,
  pointer: string,
): Promise<void> {
  const target = await resolveTarget(input.workspaceRoot, input.operation.path, `${pointer}/path`);
  ensureNotWorkspaceRoot(target, `${pointer}/path`, agentErrorMessage("workspacePatch.createDirectoryRoot"));
  const existing = await fileInfoOrUndefined(input.files, target.relativePath, `${pointer}/path`);
  if (existing && existing.kind !== "directory") {
    throw new WorkspaceApplyPatchError({
      message: agentErrorMessage("workspacePatch.directoryTargetNotDirectory", { path: target.relativePath }),
      pointer: `${pointer}/path`,
    });
  }
  ensurePathUnused(input.plan, target, `${pointer}/path`, {
    allowExistingDirectoryCreate: existing?.kind === "directory",
  });
  input.plan.createDirectories.set(target.relativePath, { target });
  input.plan.operations.push({
    kind: "createDirectory",
    path: target.relativePath,
    changedPaths: [target.relativePath],
  });
}

async function planDeleteDirectory(
  input: OperationPlanningInput<Extract<WorkspacePatchOperation, { kind: "deleteDirectory" }>>,
  pointer: string,
): Promise<void> {
  const target = await resolveTarget(input.workspaceRoot, input.operation.path, `${pointer}/path`);
  ensureNotWorkspaceRoot(target, `${pointer}/path`, agentErrorMessage("workspacePatch.deleteDirectoryRoot"));
  ensurePathUnused(input.plan, target, `${pointer}/path`);
  const stat = await requiredFileInfo(input.files, target, `${pointer}/path`);
  if (stat.kind !== "directory") {
    throw new WorkspaceApplyPatchError({
      message: agentErrorMessage("workspacePatch.deleteDirectoryOnly", { path: target.relativePath }),
      pointer: `${pointer}/path`,
      suggestion: agentErrorMessage("workspacePatch.deleteDirectoryOnlySuggestion"),
    });
  }
  input.plan.deleteDirectories.set(target.relativePath, {
    target,
    recursive: input.operation.recursive === true,
  });
  input.plan.operations.push({
    kind: "deleteDirectory",
    path: target.relativePath,
    changedPaths: [target.relativePath],
  });
}

function applyHunkPatch(input: {
  readonly oldPath: string;
  readonly newPath: string;
  readonly source: string;
  readonly hunkPatch: string;
  readonly fuzzFactor: number;
  readonly pointer: string;
}): string {
  const hunkPatch = normalizeHunkPatch(input.hunkPatch, input.pointer);
  const patchText = [`--- a/${input.oldPath}`, `+++ b/${input.newPath}`, hunkPatch].join("\n");
  try {
    const result = applyPatch(input.source, patchText, {
      autoConvertLineEndings: true,
      fuzzFactor: input.fuzzFactor,
    });
    if (result === false) {
      throw new WorkspaceApplyPatchError({
        message: agentErrorMessage("workspacePatch.patchApplyFailed", { path: input.oldPath }),
        pointer: input.pointer,
        suggestion: agentErrorMessage("workspacePatch.patchApplyFailedSuggestion"),
      });
    }
    return result;
  } catch (error) {
    if (error instanceof WorkspaceApplyPatchError) throw error;
    throw new WorkspaceApplyPatchError({
      message: errorMessage(error),
      pointer: input.pointer,
      suggestion: agentErrorMessage("workspacePatch.patchStructureSuggestion"),
    });
  }
}

function normalizeHunkPatch(value: string, pointer: string): string {
  const normalized = value.replace(/\r\n/g, "\n");
  if (/^(diff --git|--- |\+\+\+ )/m.test(normalized)) {
    throw new WorkspaceApplyPatchError({
      message: agentErrorMessage("workspacePatch.patchHeaderOnly"),
      pointer,
      suggestion: agentErrorMessage("workspacePatch.patchHeaderOnlySuggestion"),
    });
  }
  const hunkStart = /^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/m.exec(normalized);
  if (!hunkStart) {
    throw new WorkspaceApplyPatchError({
      message: agentErrorMessage("workspacePatch.patchMissingHunkHeader"),
      pointer,
      suggestion: agentErrorMessage("workspacePatch.patchMissingHunkHeaderSuggestion"),
    });
  }
  if (normalized.slice(0, hunkStart.index).trim().length > 0) {
    throw new WorkspaceApplyPatchError({
      message: agentErrorMessage("workspacePatch.patchNonEmptyBeforeHeader"),
      pointer,
      suggestion: agentErrorMessage("workspacePatch.patchNonEmptyBeforeHeaderSuggestion"),
    });
  }
  const hunkPatch = normalized.slice(hunkStart.index);
  return hunkPatch.endsWith("\n") ? hunkPatch : `${hunkPatch}\n`;
}

async function requiredFileInfo(
  files: SeneraExecutionEnv,
  target: WorkspacePatchTarget,
  pointer: string,
): Promise<FileInfo> {
  const stat = await fileInfoOrUndefined(files, target.relativePath, pointer);
  if (!stat) {
    throw new WorkspaceApplyPatchError({
      message: agentErrorMessage("workspacePatch.pathMissing", { path: target.relativePath }),
      pointer,
    });
  }
  return stat;
}

async function fileInfoOrUndefined(
  files: SeneraExecutionEnv,
  filePath: string,
  pointer: string,
): Promise<FileInfo | undefined> {
  const result = await files.fileInfo(filePath);
  if (result.ok) return result.value;
  if (result.error.code === "not_found") return undefined;
  throw new WorkspaceApplyPatchError({
    message: result.error.message,
    pointer,
    suggestion: agentErrorMessage("workspacePatch.fileOperationSuggestion", { path: filePath }),
  });
}

async function resolveTarget(workspaceRoot: string, value: string, pointer: string): Promise<WorkspacePatchTarget> {
  if (value.includes("\0")) {
    throw new WorkspaceApplyPatchError({ message: agentErrorMessage("workspacePatch.pathContainsNul"), pointer });
  }
  const resolved = resolveWorkspacePath(workspaceRoot, value);
  if (!resolved.ok) throw new WorkspaceApplyPatchError({ message: resolved.message, pointer });
  const mutationPath = await validateWorkspaceMutationPath(workspaceRoot, resolved.absolutePath);
  if (!mutationPath.ok) throw new WorkspaceApplyPatchError({ message: mutationPath.message, pointer });
  const relativePath = workspaceRelativePath(workspaceRoot, resolved.absolutePath);
  if (!relativePath || relativePath === ".") {
    throw new WorkspaceApplyPatchError({ message: agentErrorMessage("workspacePatch.pathCannotBeRoot"), pointer });
  }
  return { input: value, relativePath };
}

function ensureNotWorkspaceRoot(target: WorkspacePatchTarget, pointer: string, message: string): void {
  if (!target.relativePath || target.relativePath === ".") throw new WorkspaceApplyPatchError({ message, pointer });
}

function ensurePathUnused(
  plan: WorkspacePatchPlan,
  target: WorkspacePatchTarget,
  pointer: string,
  options: { readonly allowExistingDirectoryCreate?: boolean } = {},
): void {
  if (options.allowExistingDirectoryCreate && plan.createDirectories.has(target.relativePath)) return;
  const used =
    plan.writes.has(target.relativePath) ||
    plan.deletes.has(target.relativePath) ||
    plan.createDirectories.has(target.relativePath) ||
    plan.deleteDirectories.has(target.relativePath);
  if (used) {
    throw new WorkspaceApplyPatchError({
      message: agentErrorMessage("workspacePatch.duplicateOperation", { path: target.relativePath }),
      pointer,
      suggestion: agentErrorMessage("workspacePatch.duplicateOperationSuggestion"),
    });
  }
}

function addWrite(
  plan: WorkspacePatchPlan,
  pendingFiles: Map<string, PendingFileState>,
  write: PlannedFileWrite,
  pointer: string,
): void {
  if (pendingFiles.has(write.target.relativePath)) {
    throw new WorkspaceApplyPatchError({
      message: agentErrorMessage("workspacePatch.duplicateWrite", { path: write.target.relativePath }),
      pointer,
    });
  }
  plan.writes.set(write.target.relativePath, write);
  pendingFiles.set(write.target.relativePath, write);
}

function rejectDirectoryDeleteConflicts(plan: WorkspacePatchPlan): void {
  for (const deletion of plan.deleteDirectories.values()) {
    for (const changedPath of collectWorkspacePatchChangedPaths(plan)) {
      if (
        changedPath === deletion.target.relativePath ||
        !isInsideDirectory(changedPath, deletion.target.relativePath)
      ) {
        continue;
      }
      throw new WorkspaceApplyPatchError({
        message: agentErrorMessage("workspacePatch.directoryDeleteConflict", {
          directoryPath: deletion.target.relativePath,
          changedPath,
        }),
        pointer: "/operations",
        suggestion: agentErrorMessage("workspacePatch.directoryDeleteConflictSuggestion"),
      });
    }
  }
}

function isInsideDirectory(filePath: string, directoryPath: string): boolean {
  return filePath === directoryPath || filePath.startsWith(`${directoryPath}/`);
}
