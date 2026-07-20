import { createHash } from "node:crypto";
import type { FileError, FileInfo, Result } from "@earendil-works/pi-agent-core";
import type { SeneraExecutionEnv } from "../Execution/SeneraExecutionTypes.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import { WorkspaceApplyPatchError } from "./AgentWorkspacePatchError.js";

export interface WorkspacePatchTarget {
  input: string;
  relativePath: string;
}

export type WorkspacePatchPrecondition =
  { target: WorkspacePatchTarget; state: "missing" } | { target: WorkspacePatchTarget; state: "file"; sha256: string };

interface WorkspacePatchTransactionPlan {
  writes: ReadonlyMap<string, { target: WorkspacePatchTarget; content: string }>;
  deletes: ReadonlyMap<string, { target: WorkspacePatchTarget }>;
  createDirectories: ReadonlyMap<string, { target: WorkspacePatchTarget }>;
  deleteDirectories: ReadonlyMap<string, { target: WorkspacePatchTarget; recursive: boolean }>;
  preconditions: Map<string, WorkspacePatchPrecondition>;
}

type RollbackFile =
  | { target: WorkspacePatchTarget; state: "missing" }
  | { target: WorkspacePatchTarget; state: "file"; content: Uint8Array };

interface RollbackSnapshot {
  files: RollbackFile[];
  createdDirectories: Array<{ target: WorkspacePatchTarget; existed: boolean }>;
}

export async function applyWorkspacePatchTransaction(
  plan: WorkspacePatchTransactionPlan,
  files: SeneraExecutionEnv,
): Promise<void> {
  const rollback = await captureRollbackSnapshot(plan, files);
  try {
    for (const directory of plan.createDirectories.values()) {
      await requireFileResult(files.createDir(directory.target.relativePath, { recursive: true }), directory.target);
    }
    for (const write of plan.writes.values()) {
      await requireFileResult(files.writeFile(write.target.relativePath, write.content), write.target);
    }
    for (const deletion of plan.deletes.values()) {
      await requireFileResult(files.remove(deletion.target.relativePath), deletion.target);
    }
    for (const deletion of plan.deleteDirectories.values()) {
      await requireFileResult(
        files.remove(deletion.target.relativePath, { recursive: deletion.recursive, force: false }),
        deletion.target,
      );
    }
  } catch (error) {
    const rollbackErrors = await restoreRollbackSnapshot(rollback, files);
    if (rollbackErrors.length > 0) {
      throw new WorkspaceApplyPatchError({
        message: agentErrorMessage("workspacePatch.rollbackIncomplete", {
          count: rollbackErrors.length,
          cause: error instanceof Error ? error.message : String(error),
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
    if (sha256(current) !== precondition.sha256) throw concurrentWorkspaceChange(precondition.target.relativePath);
  }
}

export async function readWorkspaceTextFileWithPrecondition(
  files: SeneraExecutionEnv,
  target: WorkspacePatchTarget,
  pointer: string,
  plan: Pick<WorkspacePatchTransactionPlan, "preconditions">,
  expectedSha256?: string,
): Promise<string> {
  const stat = await requiredFileInfo(files, target, pointer);
  if (stat.kind !== "file") throw targetNotFile(target, pointer);
  const content = await requireFileResult(files.readTextFile(target.relativePath), target, pointer);
  addFilePrecondition(plan, target, sha256(Buffer.from(content, "utf8")), expectedSha256, pointer);
  return content;
}

export async function captureWorkspaceFilePrecondition(
  files: SeneraExecutionEnv,
  target: WorkspacePatchTarget,
  pointer: string,
  plan: Pick<WorkspacePatchTransactionPlan, "preconditions">,
  expectedSha256?: string,
): Promise<void> {
  const stat = await requiredFileInfo(files, target, pointer);
  if (stat.kind !== "file") throw targetNotFile(target, pointer);
  const content = await readBinaryFile(files, target, pointer);
  addFilePrecondition(plan, target, sha256(content), expectedSha256, pointer);
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
): Promise<RollbackSnapshot> {
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
    if (precondition?.state === "file" && sha256(content) !== precondition.sha256) {
      throw concurrentWorkspaceChange(target.relativePath);
    }
    snapshots.push({ target, state: "file", content });
  }
  const createdDirectories: RollbackSnapshot["createdDirectories"] = [];
  for (const directory of plan.createDirectories.values()) {
    createdDirectories.push({
      target: directory.target,
      existed: Boolean(await fileInfoOrUndefined(files, directory.target.relativePath, "/operations")),
    });
  }
  return { files: snapshots, createdDirectories };
}

async function restoreRollbackSnapshot(snapshot: RollbackSnapshot, files: SeneraExecutionEnv): Promise<string[]> {
  const errors: string[] = [];
  for (const file of [...snapshot.files].reverse()) {
    try {
      if (file.state === "file") {
        await requireFileResult(files.writeFile(file.target.relativePath, file.content), file.target);
      } else if (await fileInfoOrUndefined(files, file.target.relativePath, "/operations")) {
        await requireFileResult(files.remove(file.target.relativePath), file.target);
      }
    } catch (error) {
      errors.push(`${file.target.relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const directories = snapshot.createdDirectories
    .filter((directory) => !directory.existed)
    .sort((left, right) => right.target.relativePath.length - left.target.relativePath.length);
  for (const directory of directories) {
    try {
      const current = await fileInfoOrUndefined(files, directory.target.relativePath, "/operations");
      if (current?.kind === "directory") {
        await requireFileResult(
          files.remove(directory.target.relativePath, { recursive: false, force: false }),
          directory.target,
        );
      }
    } catch (error) {
      errors.push(`${directory.target.relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return errors;
}

function addFilePrecondition(
  plan: Pick<WorkspacePatchTransactionPlan, "preconditions">,
  target: WorkspacePatchTarget,
  actualSha256: string,
  expectedSha256: string | undefined,
  pointer: string,
): void {
  if (expectedSha256 && expectedSha256 !== actualSha256) {
    throw new WorkspaceApplyPatchError({
      message: agentErrorMessage("workspacePatch.expectedHashMismatch", { path: target.relativePath }),
      pointer,
      suggestion: agentErrorMessage("workspacePatch.concurrentChangeSuggestion"),
    });
  }
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

function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
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
