import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AgentHostToolHandler } from "./AgentToolHostCapabilityRegistry.js";
import type { AgentToolProcessRunResult } from "./AgentToolProcessRunner.js";
import { AgentToolProcessProtocol } from "./AgentToolProcessProtocol.js";
import {
  AgentExecutionErrorCodes,
  AgentToolProcessErrorPhases,
} from "./AgentXmlStatus.js";
import { throwIfAborted } from "./AgentCancellation.js";

const TextSchema = z.preprocess(coerceStringLike, z.string());
const NonEmptyTextSchema = z.preprocess(coerceStringLike, z.string().trim().min(1));
const PositiveIntSchema = z.preprocess(coerceNumberLike, z.number().int().positive());
const BooleanLikeSchema = z.preprocess(coerceBooleanLike, z.boolean());

const EditOperationSchema = z
  .object({
    action: z.enum([
      "create_file",
      "replace_file",
      "delete_file",
      "insert_before",
      "insert_after",
      "replace_range",
      "delete_range",
    ]),
    path: NonEmptyTextSchema,
    startLine: PositiveIntSchema.optional(),
    endLine: PositiveIntSchema.optional(),
    content: TextSchema.optional(),
  })
  .strict();

const ApplyPatchArgumentsSchema = z
  .object({
    operations: z.object({
      item: z.array(EditOperationSchema).min(1).max(32),
    }),
    cwd: NonEmptyTextSchema.optional(),
    dryRun: BooleanLikeSchema.default(false),
    justification: NonEmptyTextSchema.optional(),
  })
  .strict();

const ActionDefinitions = {
  create_file: {
    status: "added",
    requiresContent: true,
    requiresRange: false,
  },
  replace_file: {
    status: "modified",
    requiresContent: true,
    requiresRange: false,
  },
  delete_file: {
    status: "deleted",
    requiresContent: false,
    requiresRange: false,
  },
  insert_before: {
    status: "modified",
    requiresContent: true,
    requiresRange: "start",
  },
  insert_after: {
    status: "modified",
    requiresContent: true,
    requiresRange: "start",
  },
  replace_range: {
    status: "modified",
    requiresContent: true,
    requiresRange: "range",
  },
  delete_range: {
    status: "modified",
    requiresContent: false,
    requiresRange: "range",
  },
} as const satisfies Record<string, {
  status: FileChangeSummary["status"];
  requiresContent: boolean;
  requiresRange: false | "start" | "range";
}>;

const ForbiddenPathSegments = new Set([
  ".git",
  ".senera",
  ".state",
  "node_modules",
  "Dist",
  "dist",
]);

type ApplyPatchArguments = z.infer<typeof ApplyPatchArgumentsSchema>;
type EditOperation = z.infer<typeof EditOperationSchema>;
type EditAction = keyof typeof ActionDefinitions;

interface FileChangeSummary {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
}

interface WritePlan {
  absolutePath: string;
  relativePath: string;
  status: FileChangeSummary["status"];
  additions: number;
  deletions: number;
  nextContent?: string;
}

interface TargetFile {
  absolutePath: string;
  relativePath: string;
}

interface LineEditContext {
  currentLines: string[];
  lineCount: number;
}

class PatchApplyError extends Error {
  constructor(
    message: string,
    readonly diagnostics: string[] = [message],
    readonly pointer = "/operations",
  ) {
    super(message);
  }
}

export const applyPatchHostTool: AgentHostToolHandler = async (args, context) => {
  const parsed = ApplyPatchArgumentsSchema.safeParse(args);
  if (!parsed.success) {
    return patchFailure({
      code: AgentExecutionErrorCodes.InvalidToolArguments,
      message: "ApplyPatchTool 参数无效。",
      details: {
        phase: AgentToolProcessErrorPhases.RuntimeExecution,
        issues: parsed.error.issues,
        toolName: context.tool.name,
      },
      diagnostics: parsed.error.issues.map((issue) => ({
        message: issue.message,
        pointer: `/${issue.path.join("/")}`,
        path: issue.path.map((entry) => typeof entry === "number" ? entry : String(entry)),
      })),
    });
  }

  try {
    throwIfAborted(context.signal);
    const result = await applyPatch(parsed.data, context.workspaceRoot, context.signal);
    return {
      response: {
        protocol: AgentToolProcessProtocol,
        ok: true,
        result,
      },
      stdout: "",
      stderr: "",
      exitCode: null,
      signal: null,
    };
  } catch (error) {
    const normalized = normalizePatchError(error);
    return patchFailure({
      code: AgentExecutionErrorCodes.PluginExecutionError,
      message: normalized.message,
      details: {
        phase: AgentToolProcessErrorPhases.RuntimeExecution,
        toolName: context.tool.name,
      },
      diagnostics: normalized.diagnostics.map((message) => ({
        message,
        pointer: normalized.pointer,
        path: [],
      })),
    });
  }
};

async function applyPatch(args: ApplyPatchArguments, workspaceRoot: string, signal?: AbortSignal) {
  const root = path.resolve(workspaceRoot);
  const cwd = resolveWorkspaceCwd(root, args.cwd);
  const plan = await buildWritePlan(root, cwd, args.operations.item);
  throwIfAborted(signal);

  if (!args.dryRun) {
    await commitWritePlan(plan, signal);
  }

  return {
    dryRun: args.dryRun,
    changedFiles: {
      item: plan.map((entry) => ({
        path: entry.relativePath,
        status: entry.status,
        additions: entry.additions,
        deletions: entry.deletions,
      })),
    },
    diagnostics: {
      item: [
        args.dryRun
          ? `编辑计划校验通过，dryRun 未写入文件，共 ${plan.length} 个文件。`
          : `编辑已应用，共 ${plan.length} 个文件。`,
      ],
    },
  };
}

async function buildWritePlan(
  workspaceRoot: string,
  cwd: string,
  operations: EditOperation[],
): Promise<WritePlan[]> {
  const plan = new Map<string, WritePlan>();

  for (const operation of operations) {
    assertOperationShape(operation);
    const target = resolvePatchPath(workspaceRoot, cwd, operation.path);
    const currentPlan = plan.get(target.absolutePath);
    const currentContent = currentPlan?.nextContent ?? await readExistingContent(target.absolutePath);
    const nextPlan = planOperation(operation, target, currentContent);
    plan.set(target.absolutePath, mergePlan(currentPlan, nextPlan));
  }

  return [...plan.values()];
}

function assertOperationShape(operation: EditOperation): void {
  const definition = ActionDefinitions[operation.action];
  const hasStart = operation.startLine !== undefined;
  const hasEnd = operation.endLine !== undefined;
  const hasContent = operation.content !== undefined;

  if (definition.requiresContent && !hasContent) {
    throw new PatchApplyError(`${operation.action} 需要 content：${operation.path}`);
  }
  if (!definition.requiresContent && hasContent) {
    throw new PatchApplyError(`${operation.action} 不需要 content：${operation.path}`);
  }

  const validators = {
    false: () => {
      if (hasStart || hasEnd) {
        throw new PatchApplyError(`${operation.action} 不需要 startLine/endLine：${operation.path}`);
      }
    },
    start: () => {
      if (!hasStart || hasEnd) {
        throw new PatchApplyError(`${operation.action} 需要 startLine，且不能提供 endLine：${operation.path}`);
      }
    },
    range: () => {
      if (!hasStart || !hasEnd) {
        throw new PatchApplyError(`${operation.action} 需要 startLine 和 endLine：${operation.path}`);
      }
      if (operation.endLine !== undefined
        && operation.startLine !== undefined
        && operation.endLine < operation.startLine) {
        throw new PatchApplyError(`endLine 不能小于 startLine：${operation.path}`);
      }
    },
  } satisfies Record<StringKey<typeof definition.requiresRange>, () => void>;

  validators[String(definition.requiresRange) as StringKey<typeof definition.requiresRange>]();
}

function planOperation(
  operation: EditOperation,
  target: TargetFile,
  currentContent: string | undefined,
): WritePlan {
  const planners = {
    create_file: planCreateFile,
    replace_file: planReplaceFile,
    delete_file: planDeleteFile,
    insert_before: planLineEdit,
    insert_after: planLineEdit,
    replace_range: planLineEdit,
    delete_range: planLineEdit,
  } satisfies Record<EditAction, (
    operation: EditOperation,
    target: TargetFile,
    currentContent: string | undefined,
  ) => WritePlan>;

  return planners[operation.action](operation, target, currentContent);
}

function planCreateFile(
  operation: EditOperation,
  target: TargetFile,
  currentContent: string | undefined,
): WritePlan {
  if (currentContent !== undefined) {
    throw new PatchApplyError(`新增文件已存在：${operation.path}`);
  }

  const nextLines = contentToLines(operation.content ?? "");
  return {
    ...target,
    status: "added",
    additions: nextLines.length,
    deletions: 0,
    nextContent: ensureTrailingNewline(operation.content ?? ""),
  };
}

function planReplaceFile(
  operation: EditOperation,
  target: TargetFile,
  currentContent: string | undefined,
): WritePlan {
  if (currentContent === undefined) {
    throw new PatchApplyError(`替换文件不存在：${operation.path}`);
  }

  const currentLines = contentToLines(currentContent);
  const nextLines = contentToLines(operation.content ?? "");
  return {
    ...target,
    status: "modified",
    additions: nextLines.length,
    deletions: currentLines.length,
    nextContent: ensureTrailingNewline(operation.content ?? ""),
  };
}

function planDeleteFile(
  operation: EditOperation,
  target: TargetFile,
  currentContent: string | undefined,
): WritePlan {
  if (currentContent === undefined) {
    throw new PatchApplyError(`删除文件不存在：${operation.path}`);
  }

  return {
    ...target,
    status: "deleted",
    additions: 0,
    deletions: contentToLines(currentContent).length,
  };
}

function planLineEdit(
  operation: EditOperation,
  target: TargetFile,
  currentContent: string | undefined,
): WritePlan {
  if (currentContent === undefined) {
    throw new PatchApplyError(`编辑文件不存在：${operation.path}`);
  }

  const context = {
    currentLines: contentToLines(currentContent),
    lineCount: contentToLines(currentContent).length,
  };
  const currentLines = context.currentLines;
  const insertedLines = contentToLines(operation.content ?? "");
  const nextLines = applyLineEdit(operation, context, insertedLines);

  return {
    ...target,
    status: "modified",
    additions: insertedLines.length,
    deletions: countDeletedLines(operation),
    nextContent: linesToContent(nextLines),
  };
}

function applyLineEdit(
  operation: EditOperation,
  context: LineEditContext,
  insertedLines: string[],
): string[] {
  const handlers = {
    insert_before: () => insertAt(context.currentLines, assertLineInFile(operation, context), insertedLines),
    insert_after: () => insertAt(context.currentLines, assertLineInFile(operation, context) + 1, insertedLines),
    replace_range: () => replaceRange(operation, context, insertedLines),
    delete_range: () => replaceRange(operation, context, []),
  } satisfies Partial<Record<EditAction, () => string[]>>;

  const handler = operation.action in handlers
    ? handlers[operation.action as keyof typeof handlers]
    : undefined;
  if (!handler) {
    throw new PatchApplyError(`不支持的行编辑动作：${operation.action}`);
  }

  return handler();
}

function replaceRange(
  operation: EditOperation,
  context: LineEditContext,
  insertedLines: string[],
): string[] {
  const startIndex = assertLineInFile(operation, context);
  const endIndex = assertEndLineInFile(operation, context);
  return [
    ...context.currentLines.slice(0, startIndex),
    ...insertedLines,
    ...context.currentLines.slice(endIndex + 1),
  ];
}

function insertAt(lines: string[], index: number, insertedLines: string[]): string[] {
  return [
    ...lines.slice(0, index),
    ...insertedLines,
    ...lines.slice(index),
  ];
}

function assertLineInFile(operation: EditOperation, context: LineEditContext): number {
  const line = operation.startLine ?? 0;
  if (line < 1 || line > context.lineCount) {
    throw new PatchApplyError(`startLine 超出文件范围：${operation.path}，当前 ${context.lineCount} 行。`);
  }
  return line - 1;
}

function assertEndLineInFile(operation: EditOperation, context: LineEditContext): number {
  const line = operation.endLine ?? 0;
  if (line < 1 || line > context.lineCount) {
    throw new PatchApplyError(`endLine 超出文件范围：${operation.path}，当前 ${context.lineCount} 行。`);
  }
  return line - 1;
}

function countDeletedLines(operation: EditOperation): number {
  return operation.action === "replace_range" || operation.action === "delete_range"
    ? (operation.endLine ?? 0) - (operation.startLine ?? 0) + 1
    : 0;
}

async function commitWritePlan(plan: WritePlan[], signal?: AbortSignal): Promise<void> {
  for (const entry of plan) {
    throwIfAborted(signal);
    if (entry.status === "deleted") {
      await fs.rm(entry.absolutePath, { force: false });
      continue;
    }

    await fs.mkdir(path.dirname(entry.absolutePath), { recursive: true });
    await fs.writeFile(entry.absolutePath, entry.nextContent ?? "", "utf8");
  }
}

function mergePlan(previous: WritePlan | undefined, next: WritePlan): WritePlan {
  if (!previous) {
    return next;
  }

  return {
    ...next,
    status: previous.status === "added" && next.status !== "deleted" ? "added" : next.status,
    additions: previous.additions + next.additions,
    deletions: previous.deletions + next.deletions,
  };
}

function resolveWorkspaceCwd(workspaceRoot: string, cwd: string | undefined): string {
  const resolved = path.resolve(workspaceRoot, cwd ?? ".");
  assertInsideWorkspace(workspaceRoot, resolved, `cwd 超出工作区：${cwd ?? "."}`);
  return resolved;
}

function resolvePatchPath(workspaceRoot: string, cwd: string, value: string): TargetFile {
  if (path.isAbsolute(value)) {
    throw new PatchApplyError(`编辑路径不能是绝对路径：${value}`);
  }

  const absolutePath = path.resolve(cwd, value);
  assertInsideWorkspace(workspaceRoot, absolutePath, `编辑路径超出工作区：${value}`);
  assertWritablePath(workspaceRoot, absolutePath, value);
  return {
    absolutePath,
    relativePath: toWorkspacePath(workspaceRoot, absolutePath),
  };
}

function assertInsideWorkspace(workspaceRoot: string, targetPath: string, message: string): void {
  const relative = path.relative(workspaceRoot, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PatchApplyError(message);
  }
}

function assertWritablePath(workspaceRoot: string, absolutePath: string, originalPath: string): void {
  const parts = toWorkspacePath(workspaceRoot, absolutePath).split("/");
  const forbidden = parts.find((part) => ForbiddenPathSegments.has(part));
  if (forbidden) {
    throw new PatchApplyError(`不允许写入受保护目录 ${forbidden}：${originalPath}`);
  }
}

async function readExistingContent(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  }
}

function contentToLines(content: string): string[] {
  const normalized = normalizeLineEndings(content);
  if (normalized.length === 0) {
    return [];
  }
  return normalized.endsWith("\n")
    ? normalized.slice(0, -1).split("\n")
    : normalized.split("\n");
}

function linesToContent(lines: string[]): string {
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

function ensureTrailingNewline(content: string): string {
  const normalized = normalizeLineEndings(content);
  return normalized.length > 0 && !normalized.endsWith("\n")
    ? `${normalized}\n`
    : normalized;
}

function normalizeLineEndings(value: string): string {
  return value.split("\r\n").join("\n").split("\r").join("\n");
}

function toWorkspacePath(workspaceRoot: string, filePath: string): string {
  return path.relative(workspaceRoot, filePath).split(path.sep).join("/");
}

function coerceStringLike(value: unknown): unknown {
  return typeof value === "number" || typeof value === "boolean" ? String(value) : value;
}

function coerceNumberLike(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? Number(trimmed) : value;
}

function coerceBooleanLike(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return value;
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

function normalizePatchError(error: unknown): { message: string; diagnostics: string[]; pointer: string } {
  if (error instanceof PatchApplyError) {
    return {
      message: error.message,
      diagnostics: error.diagnostics,
      pointer: error.pointer,
    };
  }
  return {
    message: error instanceof Error ? error.message : String(error),
    diagnostics: [error instanceof Error ? error.message : String(error)],
    pointer: "/operations",
  };
}

function patchFailure(error: NonNullable<AgentToolProcessRunResult["response"]["error"]>): AgentToolProcessRunResult {
  return {
    response: {
      protocol: AgentToolProcessProtocol,
      ok: false,
      error,
    },
    stdout: "",
    stderr: "",
    exitCode: null,
    signal: null,
  };
}

type StringKey<T> = `${Extract<T, string | number | boolean>}`;
