import fs from "node:fs/promises";
import {
  applyLineEdit,
  countDeletedLines,
} from "./AgentPatchLineEdit.js";
import {
  contentToLines,
  ensureTrailingNewline,
  linesToContent,
} from "./AgentPatchText.js";
import {
  PatchApplyError,
  type EditAction,
  type EditOperation,
  type FileChangeSummary,
  type TargetFile,
  type WritePlan,
} from "./AgentPatchApplyTypes.js";
import { resolvePatchPath } from "./AgentPatchPathResolver.js";

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
} as const satisfies Record<EditAction, {
  status: FileChangeSummary["status"];
  requiresContent: boolean;
  requiresRange: false | "start" | "range";
}>;

export async function buildWritePlan(
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

  const currentLines = contentToLines(currentContent);
  const insertedLines = contentToLines(operation.content ?? "");
  const nextLines = applyLineEdit(operation, {
    currentLines,
    lineCount: currentLines.length,
  }, insertedLines);

  return {
    ...target,
    status: "modified",
    additions: insertedLines.length,
    deletions: countDeletedLines(operation),
    nextContent: linesToContent(nextLines),
  };
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

function isNodeErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

type StringKey<T> = `${Extract<T, string | number | boolean>}`;
