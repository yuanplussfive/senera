import type { FileError, FileInfo, Result } from "@earendil-works/pi-agent-core";
import type { SeneraExecutionEnv } from "../Execution/SeneraExecutionTypes.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import { WorkspaceApplyPatchError } from "./AgentWorkspacePatchError.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { sha256Hex } from "../Core/AgentHash.js";

export interface WorkspacePatchTarget {
  input: string;
  relativePath: string;
}

export type WorkspacePatchPrecondition =
  { target: WorkspacePatchTarget; state: "missing" } | { target: WorkspacePatchTarget; state: "file"; sha256: string };

export interface WorkspacePatchTransactionPlan {
  writes: ReadonlyMap<string, { target: WorkspacePatchTarget; content: string | Uint8Array }>;
  deletes: ReadonlyMap<string, { target: WorkspacePatchTarget }>;
  preconditions: Map<string, WorkspacePatchPrecondition>;
}

type RollbackFile =
  | { target: WorkspacePatchTarget; state: "missing" }
  | { target: WorkspacePatchTarget; state: "file"; content: Uint8Array };

export async function applyWorkspacePatchTransaction(
  plan: WorkspacePatchTransactionPlan,
  files: SeneraExecutionEnv,
): Promise<void> {
  const rollback = await captureRollbackSnapshot(plan, files);
  try {
    for (const parent of parentDirectories(plan.writes)) {
      await requireFileResult(files.createDir(parent, { recursive: true }), { input: parent, relativePath: parent });
    }
    for (const write of plan.writes.values()) {
      await requireFileResult(files.writeFile(write.target.relativePath, write.content), write.target);
    }
    for (const deletion of plan.deletes.values()) {
      await requireFileResult(files.remove(deletion.target.relativePath), deletion.target);
    }
  } catch (error) {
    const rollbackErrors = await restoreRollbackSnapshot(rollback, files);
    if (rollbackErrors.length > 0) {
      throw new WorkspaceApplyPatchError({
        message: agentErrorMessage("workspacePatch.rollbackIncomplete", {
          count: rollbackErrors.length,
          cause: errorMessage(error),
        }),
        pointer: "/operations",
        suggestion: rollbackErrors.join("; "),
      });
    }
    throw error;
  }
}

export async function validateWorkspacePatchPreconditions(
  plan: Pick<WorkspacePatchTransactionPlan, "preconditions">,
  files: SeneraExecutionEnv,
): Promise<void> {
  for (const precondition of plan.preconditions.values()) {
    if (precondition.state === "missing") {
      const current = await fileInfoOrUndefined(files, precondition.target.relativePath, "/operations");
      if (current) throw concurrentWorkspaceChange(precondition.target.relativePath);
      continue;
    }
    const current = await readBinaryFile(files, precondition.target, "/operations");
    if (sha256Hex(current) !== precondition.sha256) throw concurrentWorkspaceChange(precondition.target.relativePath);
  }
}

export async function readWorkspaceTextFileWithPrecondition(
  files: SeneraExecutionEnv,
  target: WorkspacePatchTarget,
  pointer: string,
  plan: Pick<WorkspacePatchTransactionPlan, "preconditions">,
): Promise<string> {
  const stat = await requiredFileInfo(files, target, pointer);
  if (stat.kind !== "file") throw targetNotFile(target, pointer);
  const content = await requireFileResult(files.readTextFile(target.relativePath), target, pointer);
  addFilePrecondition(plan, target, sha256Hex(Buffer.from(content, "utf8")));
  return content;
}

export async function captureWorkspaceFilePrecondition(
  files: SeneraExecutionEnv,
  target: WorkspacePatchTarget,
  pointer: string,
  plan: Pick<WorkspacePatchTransactionPlan, "preconditions">,
): Promise<void> {
  const stat = await requiredFileInfo(files, target, pointer);
  if (stat.kind !== "file") throw targetNotFile(target, pointer);
  const content = await readBinaryFile(files, target, pointer);
  addFilePrecondition(plan, target, sha256Hex(content));
}

export function addWorkspaceMissingPrecondition(
  plan: Pick<WorkspacePatchTransactionPlan, "preconditions">,
  target: WorkspacePatchTarget,
  pointer: string,
): void {
  const existing = plan.preconditions.get(target.relativePath);
  if (existing && existing.state !== "missing") {
    throw new WorkspaceApplyPatchError({
      message: agentErrorMessage("workspacePatch.duplicateOperation", { path: target.relativePath }),
      pointer,
    });
  }
  plan.preconditions.set(target.relativePath, { target, state: "missing" });
}

async function captureRollbackSnapshot(
  plan: WorkspacePatchTransactionPlan,
  files: SeneraExecutionEnv,
): Promise<RollbackFile[]> {
  const targets = new Map<string, WorkspacePatchTarget>();
  for (const write of plan.writes.values()) targets.set(write.target.relativePath, write.target);
  for (const deletion of plan.deletes.values()) targets.set(deletion.target.relativePath, deletion.target);

  const snapshots: RollbackFile[] = [];
  for (const target of targets.values()) {
    const info = await fileInfoOrUndefined(files, target.relativePath, "/operations");
    const precondition = plan.preconditions.get(target.relativePath);
    if (!info) {
      if (precondition?.state === "file") throw concurrentWorkspaceChange(target.relativePath);
      snapshots.push({ target, state: "missing" });
      continue;
    }
    if (info.kind !== "file" || precondition?.state === "missing") {
      throw concurrentWorkspaceChange(target.relativePath);
    }
    const content = await readBinaryFile(files, target, "/operations");
    if (precondition?.state === "file" && sha256Hex(content) !== precondition.sha256) {
      throw concurrentWorkspaceChange(target.relativePath);
    }
    snapshots.push({ target, state: "file", content });
  }
  return snapshots;
}

async function restoreRollbackSnapshot(snapshot: RollbackFile[], files: SeneraExecutionEnv): Promise<string[]> {
  const errors: string[] = [];
  for (const file of [...snapshot].reverse()) {
    try {
      if (file.state === "file") {
        await requireFileResult(files.writeFile(file.target.relativePath, file.content), file.target);
      } else if (await fileInfoOrUndefined(files, file.target.relativePath, "/operations")) {
        await requireFileResult(files.remove(file.target.relativePath), file.target);
      }
    } catch (error) {
      errors.push(`${file.target.relativePath}: ${errorMessage(error)}`);
    }
  }
  return errors;
}

function parentDirectories(writes: ReadonlyMap<string, unknown>): string[] {
  const parents = new Set<string>();
  for (const relativePath of writes.keys()) {
    const index = relativePath.lastIndexOf("/");
    if (index > 0) parents.add(relativePath.slice(0, index));
  }
  return [...parents].sort((left, right) => left.length - right.length);
}

function addFilePrecondition(
  plan: Pick<WorkspacePatchTransactionPlan, "preconditions">,
  target: WorkspacePatchTarget,
  actualSha256: string,
): void {
  plan.preconditions.set(target.relativePath, { target, state: "file", sha256: actualSha256 });
}

function concurrentWorkspaceChange(path: string): WorkspaceApplyPatchError {
  return new WorkspaceApplyPatchError({
    message: agentErrorMessage("workspacePatch.concurrentChange", { path }),
    pointer: "/operations",
    suggestion: agentErrorMessage("workspacePatch.concurrentChangeSuggestion"),
  });
}

function targetNotFile(target: WorkspacePatchTarget, pointer: string): WorkspaceApplyPatchError {
  return new WorkspaceApplyPatchError({
    message: agentErrorMessage("workspacePatch.targetNotFile", { path: target.relativePath }),
    pointer,
  });
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
  throw fileResultError(result.error, filePath, pointer);
}

async function readBinaryFile(
  files: SeneraExecutionEnv,
  target: WorkspacePatchTarget,
  pointer: string,
): Promise<Uint8Array> {
  return requireFileResult(files.readBinaryFile(target.relativePath), target, pointer);
}

async function requireFileResult<TValue>(
  operation: Result<TValue, FileError> | Promise<Result<TValue, FileError>>,
  target: WorkspacePatchTarget,
  pointer = "/operations",
): Promise<TValue> {
  const result = await operation;
  if (result.ok) return result.value;
  throw fileResultError(result.error, target.relativePath, pointer);
}

function fileResultError(error: Error, filePath: string, pointer: string): WorkspaceApplyPatchError {
  return new WorkspaceApplyPatchError({
    message: error.message,
    pointer,
    suggestion: agentErrorMessage("workspacePatch.fileOperationSuggestion", { path: filePath }),
  });
}
