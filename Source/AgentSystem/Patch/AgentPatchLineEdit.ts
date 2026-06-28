import {
  PatchApplyError,
  type EditAction,
  type EditOperation,
  type LineEditContext,
} from "./AgentPatchApplyTypes.js";

export function applyLineEdit(
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

export function countDeletedLines(operation: EditOperation): number {
  return operation.action === "replace_range" || operation.action === "delete_range"
    ? (operation.endLine ?? 0) - (operation.startLine ?? 0) + 1
    : 0;
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
