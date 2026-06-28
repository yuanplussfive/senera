import path from "node:path";
import { PatchApplyError, type TargetFile } from "./AgentPatchApplyTypes.js";

const ForbiddenPathSegments = new Set([
  ".git",
  ".senera",
  ".state",
  "node_modules",
  "Dist",
  "dist",
]);

export function resolveWorkspaceCwd(workspaceRoot: string, cwd: string | undefined): string {
  const resolved = path.resolve(workspaceRoot, cwd ?? ".");
  assertInsideWorkspace(workspaceRoot, resolved, `cwd 超出工作区：${cwd ?? "."}`);
  return resolved;
}

export function resolvePatchPath(workspaceRoot: string, cwd: string, value: string): TargetFile {
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

function toWorkspacePath(workspaceRoot: string, filePath: string): string {
  return path.relative(workspaceRoot, filePath).split(path.sep).join("/");
}
