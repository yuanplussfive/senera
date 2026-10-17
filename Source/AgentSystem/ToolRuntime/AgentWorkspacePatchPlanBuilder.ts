import type { FileInfo } from "@earendil-works/pi-agent-core";
import path from "node:path";
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

export interface WorkspacePatchOperationSummary {
  readonly kind: WorkspacePatchOperation["kind"];
  readonly path?: string;
  readonly source?: string;
  readonly destination?: string;
  /** Number of times the replaced fragment appeared in the baseline; 1 means a unique match. */
  readonly matches?: number;
  readonly changedPaths: string[];
}

export interface WorkspacePatchPlan {
  readonly workspaceRoot: string;
  readonly operations: WorkspacePatchOperationSummary[];
  readonly writes: Map<string, PlannedFileWrite>;
  readonly deletes: Map<string, PlannedFileDelete>;
  readonly preconditions: Map<string, WorkspacePatchPrecondition>;
  readonly pendingFiles: Map<string, PendingFileState>;
}

type PendingFileState = PlannedFileWrite | typeof DeleteFile;

interface OperationPlanningInput<TOperation extends WorkspacePatchOperation = WorkspacePatchOperation> {
  readonly operation: TOperation;
  readonly workspaceRoot: string;
  readonly files: SeneraExecutionEnv;
  readonly plan: WorkspacePatchPlan;
}

export async function buildWorkspacePatchPlan(
  args: WorkspaceApplyPatchArguments,
  workspaceRoot: string,
  files: SeneraExecutionEnv,
): Promise<WorkspacePatchPlan> {
  const plan: WorkspacePatchPlan = {
    workspaceRoot: path.resolve(workspaceRoot),
    operations: [],
    writes: new Map(),
    deletes: new Map(),
    preconditions: new Map(),
    pendingFiles: new Map(),
  };
  for (const [index, operation] of args.operations.entries()) {
    await planOperation({ operation, workspaceRoot, files, plan }, index);
  }
  materializePendingFiles(plan);
  return plan;
}

export function collectWorkspacePatchChangedPaths(plan: WorkspacePatchPlan): string[] {
  const paths = new Set<string>();
  for (const operation of plan.operations) {
    for (const changedPath of operation.changedPaths) paths.add(changedPath);
  }
  return [...paths].sort();
}

function materializePendingFiles(plan: WorkspacePatchPlan): void {
  for (const [relativePath, state] of plan.pendingFiles) {
    if (state !== DeleteFile) plan.writes.set(relativePath, state);
  }
}

async function planOperation(input: OperationPlanningInput, index: number): Promise<void> {
  const pointer = `/operations/${index}`;
  switch (input.operation.kind) {
    case "add":
      return planAdd({ ...input, operation: input.operation }, pointer);
    case "update":
      return planUpdate({ ...input, operation: input.operation }, pointer);
    case "write":
      return planWrite({ ...input, operation: input.operation }, pointer);
    case "delete":
      return planDelete({ ...input, operation: input.operation }, pointer);
    case "move":
      return planMove({ ...input, operation: input.operation }, pointer);
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
  addWrite(input.plan, { target, content: input.operation.content });
  input.plan.operations.push({ kind: "add", path: target.relativePath, changedPaths: [target.relativePath] });
}

async function planUpdate(
  input: OperationPlanningInput<Extract<WorkspacePatchOperation, { kind: "update" }>>,
  pointer: string,
): Promise<void> {
  const target = await resolveTarget(input.workspaceRoot, input.operation.path, `${pointer}/path`);
  const baseline = await baselineContent(input.files, input.plan, target, `${pointer}/path`);
  const replaced = replaceFirstMatch(baseline, input.operation.oldStr, input.operation.newStr);
  if (replaced.matches === 0) {
    throw new WorkspaceApplyPatchError({
      message: agentErrorMessage("workspacePatch.oldStrNotFound", { path: target.relativePath }),
      pointer: `${pointer}/oldStr`,
      suggestion: agentErrorMessage("workspacePatch.oldStrNotFoundSuggestion"),
    });
  }
  addWrite(input.plan, { target, content: replaced.content });
  input.plan.operations.push({
    kind: "update",
    path: target.relativePath,
    matches: replaced.matches,
    changedPaths: [target.relativePath],
  });
}

async function planWrite(
  input: OperationPlanningInput<Extract<WorkspacePatchOperation, { kind: "write" }>>,
  pointer: string,
): Promise<void> {
  const target = await resolveTarget(input.workspaceRoot, input.operation.path, `${pointer}/path`);
  ensurePathUnused(input.plan, target, `${pointer}/path`);
  const existing = await fileInfoOrUndefined(input.files, target.relativePath, `${pointer}/path`);
  if (existing) {
    if (existing.kind !== "file") {
      throw new WorkspaceApplyPatchError({
        message: agentErrorMessage("workspacePatch.writeTargetNotFile", { path: target.relativePath }),
        pointer: `${pointer}/path`,
      });
    }
    await captureExistingFilePrecondition(input.files, target, `${pointer}/path`, input.plan);
  } else {
    addMissingPrecondition(input.plan, target, `${pointer}/path`);
  }
  addWrite(input.plan, { target, content: input.operation.content });
  input.plan.operations.push({ kind: "write", path: target.relativePath, changedPaths: [target.relativePath] });
}

async function planDelete(
  input: OperationPlanningInput<Extract<WorkspacePatchOperation, { kind: "delete" }>>,
  pointer: string,
): Promise<void> {
  const target = await resolveTarget(input.workspaceRoot, input.operation.path, `${pointer}/path`);
  const pending = input.plan.pendingFiles.get(target.relativePath);
  if (pending === DeleteFile) {
    throw new WorkspaceApplyPatchError({
      message: agentErrorMessage("workspacePatch.duplicateOperation", { path: target.relativePath }),
      pointer: `${pointer}/path`,
      suggestion: agentErrorMessage("workspacePatch.duplicateOperationSuggestion"),
    });
  }
  if (!pending) {
    const stat = await requiredFileInfo(input.files, target, `${pointer}/path`);
    if (stat.kind !== "file") {
      throw new WorkspaceApplyPatchError({
        message: agentErrorMessage("workspacePatch.deleteFileOnly", { path: target.relativePath }),
        pointer: `${pointer}/path`,
        suggestion: agentErrorMessage("workspacePatch.deleteFileOnlySuggestion"),
      });
    }
    await captureExistingFilePrecondition(input.files, target, `${pointer}/path`, input.plan);
  }
  input.plan.pendingFiles.set(target.relativePath, DeleteFile);
  if (input.plan.preconditions.get(target.relativePath)?.state === "missing") {
    input.plan.deletes.delete(target.relativePath);
  } else {
    input.plan.deletes.set(target.relativePath, { target });
  }
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
  const content = await baselineContent(input.files, input.plan, source, `${pointer}/source`);
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
  input.plan.pendingFiles.set(source.relativePath, DeleteFile);
  input.plan.deletes.set(source.relativePath, { target: source });
  addWrite(input.plan, { target: destination, content });
  input.plan.operations.push({
    kind: "move",
    source: source.relativePath,
    destination: destination.relativePath,
    changedPaths: [source.relativePath, destination.relativePath],
  });
}

function replaceFirstMatch(source: string, oldStr: string, newStr: string): { content: string; matches: number } {
  const first = source.indexOf(oldStr);
  if (first < 0) return { content: source, matches: 0 };
  let matches = 0;
  let from = 0;
  for (;;) {
    const found = source.indexOf(oldStr, from);
    if (found < 0) break;
    matches += 1;
    from = found + oldStr.length;
  }
  return {
    content: `${source.slice(0, first)}${newStr}${source.slice(first + oldStr.length)}`,
    matches,
  };
}

async function baselineContent(
  files: SeneraExecutionEnv,
  plan: WorkspacePatchPlan,
  target: WorkspacePatchTarget,
  pointer: string,
): Promise<string> {
  const pending = plan.pendingFiles.get(target.relativePath);
  if (pending === DeleteFile) {
    throw new WorkspaceApplyPatchError({
      message: agentErrorMessage("workspacePatch.duplicateOperation", { path: target.relativePath }),
      pointer,
      suggestion: agentErrorMessage("workspacePatch.duplicateOperationSuggestion"),
    });
  }
  if (pending) return pending.content;
  return readExistingFile(files, target, pointer, plan);
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

function ensurePathUnused(plan: WorkspacePatchPlan, target: WorkspacePatchTarget, pointer: string): void {
  if (plan.pendingFiles.has(target.relativePath)) {
    throw new WorkspaceApplyPatchError({
      message: agentErrorMessage("workspacePatch.duplicateOperation", { path: target.relativePath }),
      pointer,
      suggestion: agentErrorMessage("workspacePatch.duplicateOperationSuggestion"),
    });
  }
}

function addWrite(plan: WorkspacePatchPlan, write: PlannedFileWrite): void {
  plan.pendingFiles.set(write.target.relativePath, write);
}
