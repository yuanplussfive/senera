import fs from "node:fs/promises";
import path from "node:path";
import { applyPatch } from "diff";
import { z } from "zod";
import {
  resolveWorkspacePath,
  validateWorkspaceMutationPath,
  workspaceRelativePath,
} from "../Execution/SeneraWorkspacePath.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import type { AgentSourceDiagnostic } from "../Diagnostics/AgentSourceDiagnostic.js";
import { AgentExecutionErrorCodes, AgentToolProcessErrorPhases } from "../Xml/AgentXmlStatus.js";
import type { AgentHostToolHandler } from "./AgentToolHostCapabilityRegistry.js";
import type { AgentToolProcessRunResult } from "./AgentToolProcessRunner.js";
import { toolProcessFailureResult, toolProcessSuccessResult } from "./AgentToolProcessEnvelope.js";

const MaxOperations = 64;
const MaxFuzzFactor = 3;
const DeleteFile = Symbol("delete-file");

const WorkspacePathSchema = z.string().trim().min(1);
const HunkPatchSchema = z.string().trim().min(1);

const WorkspacePatchOperationSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("add"),
      path: WorkspacePathSchema,
      content: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("update"),
      path: WorkspacePathSchema,
      patch: HunkPatchSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("delete"),
      path: WorkspacePathSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("move"),
      source: WorkspacePathSchema,
      destination: WorkspacePathSchema,
      patch: HunkPatchSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("createDirectory"),
      path: WorkspacePathSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("deleteDirectory"),
      path: WorkspacePathSchema,
      recursive: z.boolean().optional(),
    })
    .strict(),
]);

const WorkspaceApplyPatchArgumentsSchema = z
  .object({
    operations: z.array(WorkspacePatchOperationSchema).min(1).max(MaxOperations),
    dryRun: z.boolean().optional(),
    fuzzFactor: z.number().int().min(0).max(MaxFuzzFactor).optional(),
  })
  .strict();

type WorkspaceApplyPatchArguments = z.infer<typeof WorkspaceApplyPatchArgumentsSchema>;
type WorkspacePatchOperation = z.infer<typeof WorkspacePatchOperationSchema>;

interface ResolvedWorkspaceTarget {
  input: string;
  relativePath: string;
  absolutePath: string;
}

interface PatchPlan {
  workspaceRoot: string;
  dryRun: boolean;
  fuzzFactor: number;
  operations: WorkspacePatchOperationSummary[];
  writes: Map<string, PlannedFileWrite>;
  deletes: Map<string, PlannedFileDelete>;
  createDirectories: Map<string, PlannedDirectoryCreate>;
  deleteDirectories: Map<string, PlannedDirectoryDelete>;
}

interface PlannedFileWrite {
  target: ResolvedWorkspaceTarget;
  content: string;
}

interface PlannedFileDelete {
  target: ResolvedWorkspaceTarget;
}

interface PlannedDirectoryCreate {
  target: ResolvedWorkspaceTarget;
}

interface PlannedDirectoryDelete {
  target: ResolvedWorkspaceTarget;
  recursive: boolean;
}

interface WorkspacePatchOperationSummary {
  kind: WorkspacePatchOperation["kind"];
  path?: string;
  source?: string;
  destination?: string;
  changedPaths: string[];
}

type PendingFileState = PlannedFileWrite | typeof DeleteFile;

export const applyWorkspacePatchHostTool: AgentHostToolHandler = async (args, context) => {
  const parsed = WorkspaceApplyPatchArgumentsSchema.safeParse(args);
  if (!parsed.success) {
    return workspacePatchFailure({
      code: AgentExecutionErrorCodes.InvalidToolArguments,
      message: agentErrorMessage("workspacePatch.argumentsInvalid"),
      diagnostics: parsed.error.issues.map((issue) => ({
        message: issue.message,
        pointer: `/${issue.path.join("/")}`,
        path: issue.path.map((entry) => (typeof entry === "number" ? entry : String(entry))),
      })),
      details: {
        phase: AgentToolProcessErrorPhases.RuntimeExecution,
        issues: parsed.error.issues,
        toolName: context.tool.name,
      },
    });
  }

  try {
    const plan = await buildPatchPlan(parsed.data, context.workspaceRoot);
    if (!plan.dryRun) {
      await applyPatchPlan(plan);
    }

    const changedPaths = collectChangedPaths(plan);
    return toolProcessSuccessResult({
      text: plan.dryRun
        ? `Workspace patch dry run validated ${plan.operations.length} operation(s) over ${changedPaths.length} path(s).`
        : `Workspace patch applied ${plan.operations.length} operation(s) over ${changedPaths.length} path(s).`,
      applied: !plan.dryRun,
      dryRun: plan.dryRun,
      fuzzFactor: plan.fuzzFactor,
      operationCount: plan.operations.length,
      changedPaths,
      operations: plan.operations,
    });
  } catch (error) {
    return error instanceof WorkspaceApplyPatchError
      ? workspacePatchFailure(error.toFailureInput(context.tool.name))
      : workspacePatchFailure({
          code: AgentExecutionErrorCodes.PluginExecutionError,
          message: error instanceof Error ? error.message : String(error),
          details: {
            phase: AgentToolProcessErrorPhases.RuntimeExecution,
            toolName: context.tool.name,
          },
        });
  }
};

async function buildPatchPlan(args: WorkspaceApplyPatchArguments, workspaceRoot: string): Promise<PatchPlan> {
  const plan: PatchPlan = {
    workspaceRoot: path.resolve(workspaceRoot),
    dryRun: args.dryRun === true,
    fuzzFactor: args.fuzzFactor ?? 0,
    operations: [],
    writes: new Map(),
    deletes: new Map(),
    createDirectories: new Map(),
    deleteDirectories: new Map(),
  };
  const pendingFiles = new Map<string, PendingFileState>();

  for (const [index, operation] of args.operations.entries()) {
    await planOperation({
      operation,
      index,
      workspaceRoot,
      plan,
      pendingFiles,
    });
  }

  rejectDirectoryDeleteConflicts(plan);
  return plan;
}

async function planOperation(input: {
  operation: WorkspacePatchOperation;
  index: number;
  workspaceRoot: string;
  plan: PatchPlan;
  pendingFiles: Map<string, PendingFileState>;
}): Promise<void> {
  const pointer = `/operations/${input.index}`;
  switch (input.operation.kind) {
    case "add":
      await planAddOperation({ ...input, operation: input.operation }, pointer);
      return;
    case "update":
      await planUpdateOperation({ ...input, operation: input.operation }, pointer);
      return;
    case "delete":
      await planDeleteOperation({ ...input, operation: input.operation }, pointer);
      return;
    case "move":
      await planMoveOperation({ ...input, operation: input.operation }, pointer);
      return;
    case "createDirectory":
      await planCreateDirectoryOperation({ ...input, operation: input.operation }, pointer);
      return;
    case "deleteDirectory":
      await planDeleteDirectoryOperation({ ...input, operation: input.operation }, pointer);
      return;
  }
}

async function planAddOperation(
  input: {
    operation: Extract<WorkspacePatchOperation, { kind: "add" }>;
    workspaceRoot: string;
    plan: PatchPlan;
    pendingFiles: Map<string, PendingFileState>;
  },
  pointer: string,
): Promise<void> {
  const target = await resolveTarget(input.workspaceRoot, input.operation.path, `${pointer}/path`);
  ensurePathUnused(input.plan, target, `${pointer}/path`);
  const existing = await lstatOrUndefined(target.absolutePath);
  if (existing) {
    throw new WorkspaceApplyPatchError({
      message: agentErrorMessage("workspacePatch.addFileExists", { path: target.relativePath }),
      pointer: `${pointer}/path`,
      suggestion: agentErrorMessage("workspacePatch.addFileExistsSuggestion"),
    });
  }

  addWrite(
    input.plan,
    input.pendingFiles,
    {
      target,
      content: input.operation.content,
    },
    `${pointer}/path`,
  );
  input.plan.operations.push({
    kind: "add",
    path: target.relativePath,
    changedPaths: [target.relativePath],
  });
}

async function planUpdateOperation(
  input: {
    operation: Extract<WorkspacePatchOperation, { kind: "update" }>;
    workspaceRoot: string;
    plan: PatchPlan;
    pendingFiles: Map<string, PendingFileState>;
  },
  pointer: string,
): Promise<void> {
  const target = await resolveTarget(input.workspaceRoot, input.operation.path, `${pointer}/path`);
  ensurePathUnused(input.plan, target, `${pointer}/path`);
  const content = await readExistingFile(target, `${pointer}/path`);
  const patched = applyHunkPatch({
    oldPath: target.relativePath,
    newPath: target.relativePath,
    source: content,
    hunkPatch: input.operation.patch,
    fuzzFactor: input.plan.fuzzFactor,
    pointer: `${pointer}/patch`,
  });

  addWrite(
    input.plan,
    input.pendingFiles,
    {
      target,
      content: patched,
    },
    `${pointer}/path`,
  );
  input.plan.operations.push({
    kind: "update",
    path: target.relativePath,
    changedPaths: [target.relativePath],
  });
}

async function planDeleteOperation(
  input: {
    operation: Extract<WorkspacePatchOperation, { kind: "delete" }>;
    workspaceRoot: string;
    plan: PatchPlan;
    pendingFiles: Map<string, PendingFileState>;
  },
  pointer: string,
): Promise<void> {
  const target = await resolveTarget(input.workspaceRoot, input.operation.path, `${pointer}/path`);
  ensurePathUnused(input.plan, target, `${pointer}/path`);
  const stat = await requiredStat(target, `${pointer}/path`);
  if (!stat.isFile()) {
    throw new WorkspaceApplyPatchError({
      message: agentErrorMessage("workspacePatch.deleteFileOnly", { path: target.relativePath }),
      pointer: `${pointer}/path`,
      suggestion: agentErrorMessage("workspacePatch.deleteFileOnlySuggestion"),
    });
  }

  input.plan.deletes.set(target.relativePath, { target });
  input.pendingFiles.set(target.relativePath, DeleteFile);
  input.plan.operations.push({
    kind: "delete",
    path: target.relativePath,
    changedPaths: [target.relativePath],
  });
}

async function planMoveOperation(
  input: {
    operation: Extract<WorkspacePatchOperation, { kind: "move" }>;
    workspaceRoot: string;
    plan: PatchPlan;
    pendingFiles: Map<string, PendingFileState>;
  },
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
  const content = await readExistingFile(source, `${pointer}/source`);
  const destinationExisting = await lstatOrUndefined(destination.absolutePath);
  if (destinationExisting) {
    throw new WorkspaceApplyPatchError({
      message: agentErrorMessage("workspacePatch.moveDestinationExists", { path: destination.relativePath }),
      pointer: `${pointer}/destination`,
    });
  }

  const nextContent = input.operation.patch
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
    {
      target: destination,
      content: nextContent,
    },
    `${pointer}/destination`,
  );
  input.plan.operations.push({
    kind: "move",
    source: source.relativePath,
    destination: destination.relativePath,
    changedPaths: [source.relativePath, destination.relativePath],
  });
}

async function planCreateDirectoryOperation(
  input: {
    operation: Extract<WorkspacePatchOperation, { kind: "createDirectory" }>;
    workspaceRoot: string;
    plan: PatchPlan;
  },
  pointer: string,
): Promise<void> {
  const target = await resolveTarget(input.workspaceRoot, input.operation.path, `${pointer}/path`);
  ensureNotWorkspaceRoot(target, `${pointer}/path`, agentErrorMessage("workspacePatch.createDirectoryRoot"));
  const existing = await lstatOrUndefined(target.absolutePath);
  if (existing && !existing.isDirectory()) {
    throw new WorkspaceApplyPatchError({
      message: agentErrorMessage("workspacePatch.directoryTargetNotDirectory", { path: target.relativePath }),
      pointer: `${pointer}/path`,
    });
  }

  ensurePathUnused(input.plan, target, `${pointer}/path`, {
    allowExistingDirectoryCreate: existing?.isDirectory() === true,
  });
  input.plan.createDirectories.set(target.relativePath, { target });
  input.plan.operations.push({
    kind: "createDirectory",
    path: target.relativePath,
    changedPaths: [target.relativePath],
  });
}

async function planDeleteDirectoryOperation(
  input: {
    operation: Extract<WorkspacePatchOperation, { kind: "deleteDirectory" }>;
    workspaceRoot: string;
    plan: PatchPlan;
  },
  pointer: string,
): Promise<void> {
  const target = await resolveTarget(input.workspaceRoot, input.operation.path, `${pointer}/path`);
  ensureNotWorkspaceRoot(target, `${pointer}/path`, agentErrorMessage("workspacePatch.deleteDirectoryRoot"));
  ensurePathUnused(input.plan, target, `${pointer}/path`);
  const stat = await requiredStat(target, `${pointer}/path`);
  if (!stat.isDirectory()) {
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

async function applyPatchPlan(plan: PatchPlan): Promise<void> {
  for (const directory of plan.createDirectories.values()) {
    await requireSafeMutationTarget(plan.workspaceRoot, directory.target);
    await fs.mkdir(directory.target.absolutePath, { recursive: true });
  }

  for (const write of plan.writes.values()) {
    await requireSafeMutationTarget(plan.workspaceRoot, write.target);
    await atomicWriteFile(write.target.absolutePath, write.content);
  }

  for (const deletion of plan.deletes.values()) {
    await requireSafeMutationTarget(plan.workspaceRoot, deletion.target);
    await fs.rm(deletion.target.absolutePath, { force: false });
  }

  for (const deletion of plan.deleteDirectories.values()) {
    await requireSafeMutationTarget(plan.workspaceRoot, deletion.target);
    if (deletion.recursive) {
      await fs.rm(deletion.target.absolutePath, {
        force: false,
        recursive: true,
      });
    } else {
      await fs.rmdir(deletion.target.absolutePath);
    }
  }
}

function applyHunkPatch(input: {
  oldPath: string;
  newPath: string;
  source: string;
  hunkPatch: string;
  fuzzFactor: number;
  pointer: string;
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
    if (error instanceof WorkspaceApplyPatchError) {
      throw error;
    }
    throw new WorkspaceApplyPatchError({
      message: error instanceof Error ? error.message : String(error),
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

  const prefix = normalized.slice(0, hunkStart.index);
  if (prefix.trim().length > 0) {
    throw new WorkspaceApplyPatchError({
      message: agentErrorMessage("workspacePatch.patchNonEmptyBeforeHeader"),
      pointer,
      suggestion: agentErrorMessage("workspacePatch.patchNonEmptyBeforeHeaderSuggestion"),
    });
  }

  const hunkPatch = normalized.slice(hunkStart.index);
  return hunkPatch.endsWith("\n") ? hunkPatch : `${hunkPatch}\n`;
}

async function readExistingFile(target: ResolvedWorkspaceTarget, pointer: string): Promise<string> {
  const stat = await requiredStat(target, pointer);
  if (!stat.isFile()) {
    throw new WorkspaceApplyPatchError({
      message: agentErrorMessage("workspacePatch.targetNotFile", { path: target.relativePath }),
      pointer,
    });
  }
  return fs.readFile(target.absolutePath, "utf8");
}

async function requiredStat(
  target: ResolvedWorkspaceTarget,
  pointer: string,
): Promise<Awaited<ReturnType<typeof fs.lstat>>> {
  const stat = await lstatOrUndefined(target.absolutePath);
  if (!stat) {
    throw new WorkspaceApplyPatchError({
      message: agentErrorMessage("workspacePatch.pathMissing", { path: target.relativePath }),
      pointer,
    });
  }
  return stat;
}

async function lstatOrUndefined(filePath: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | undefined> {
  try {
    return await fs.lstat(filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function resolveTarget(workspaceRoot: string, value: string, pointer: string): Promise<ResolvedWorkspaceTarget> {
  if (value.includes("\0")) {
    throw new WorkspaceApplyPatchError({
      message: agentErrorMessage("workspacePatch.pathContainsNul"),
      pointer,
    });
  }

  const resolved = resolveWorkspacePath(workspaceRoot, value);
  if (!resolved.ok) {
    throw new WorkspaceApplyPatchError({
      message: resolved.message,
      pointer,
    });
  }

  const mutationPath = await validateWorkspaceMutationPath(workspaceRoot, resolved.absolutePath);
  if (!mutationPath.ok) {
    throw new WorkspaceApplyPatchError({
      message: mutationPath.message,
      pointer,
    });
  }

  const relativePath = workspaceRelativePath(workspaceRoot, resolved.absolutePath);
  if (!relativePath || relativePath === ".") {
    throw new WorkspaceApplyPatchError({
      message: agentErrorMessage("workspacePatch.pathCannotBeRoot"),
      pointer,
    });
  }

  return {
    input: value,
    absolutePath: resolved.absolutePath,
    relativePath,
  };
}

async function requireSafeMutationTarget(workspaceRoot: string, target: ResolvedWorkspaceTarget): Promise<void> {
  const validation = await validateWorkspaceMutationPath(workspaceRoot, target.absolutePath);
  if (!validation.ok) {
    throw new WorkspaceApplyPatchError({
      message: validation.message,
      pointer: "/operations",
    });
  }
}

function ensureNotWorkspaceRoot(target: ResolvedWorkspaceTarget, pointer: string, message: string): void {
  if (!target.relativePath || target.relativePath === ".") {
    throw new WorkspaceApplyPatchError({
      message,
      pointer,
    });
  }
}

function ensurePathUnused(
  plan: PatchPlan,
  target: ResolvedWorkspaceTarget,
  pointer: string,
  options: {
    allowExistingDirectoryCreate?: boolean;
  } = {},
): void {
  if (options.allowExistingDirectoryCreate && plan.createDirectories.has(target.relativePath)) {
    return;
  }
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
  plan: PatchPlan,
  pendingFiles: Map<string, PendingFileState>,
  write: PlannedFileWrite,
  pointer: string,
): void {
  const pending = pendingFiles.get(write.target.relativePath);
  if (pending) {
    throw new WorkspaceApplyPatchError({
      message: agentErrorMessage("workspacePatch.duplicateWrite", { path: write.target.relativePath }),
      pointer,
    });
  }
  plan.writes.set(write.target.relativePath, write);
  pendingFiles.set(write.target.relativePath, write);
}

function rejectDirectoryDeleteConflicts(plan: PatchPlan): void {
  for (const deletion of plan.deleteDirectories.values()) {
    for (const changedPath of collectChangedPaths(plan)) {
      if (
        changedPath !== deletion.target.relativePath &&
        isInsideDirectory(changedPath, deletion.target.relativePath)
      ) {
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
}

function collectChangedPaths(plan: PatchPlan): string[] {
  const paths = new Set<string>();
  for (const operation of plan.operations) {
    for (const changedPath of operation.changedPaths) {
      paths.add(changedPath);
    }
  }
  return [...paths].sort();
}

function isInsideDirectory(filePath: string, directoryPath: string): boolean {
  return filePath === directoryPath || filePath.startsWith(`${directoryPath}/`);
}

async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tempPath, content, "utf8");
  await fs.rename(tempPath, filePath);
}

function workspacePatchFailure(input: {
  code: (typeof AgentExecutionErrorCodes)[keyof typeof AgentExecutionErrorCodes];
  message: string;
  diagnostics?: AgentSourceDiagnostic[];
  details?: NonNullable<AgentToolProcessRunResult["response"]["error"]>["details"];
}): AgentToolProcessRunResult {
  return toolProcessFailureResult({
    code: input.code,
    message: input.message,
    diagnostics: input.diagnostics,
    details: input.details,
  });
}

class WorkspaceApplyPatchError extends Error {
  readonly pointer: string;
  readonly suggestion?: string;

  constructor(input: { message: string; pointer: string; suggestion?: string }) {
    super(input.message);
    this.name = "WorkspaceApplyPatchError";
    this.pointer = input.pointer;
    this.suggestion = input.suggestion;
  }

  toFailureInput(toolName: string): Parameters<typeof workspacePatchFailure>[0] {
    return {
      code: AgentExecutionErrorCodes.InvalidToolArguments,
      message: this.message,
      diagnostics: [
        {
          message: this.message,
          pointer: this.pointer,
          suggestion: this.suggestion,
        },
      ],
      details: {
        phase: AgentToolProcessErrorPhases.RuntimeExecution,
        toolName,
      },
    };
  }
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
