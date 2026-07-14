import fs from "node:fs/promises";
import path from "node:path";

export function resolveWorkspacePath(
  workspaceRoot: string,
  value: string | undefined,
): { ok: true; absolutePath: string } | { ok: false; message: string } {
  const root = path.resolve(workspaceRoot);
  const absolutePath = path.resolve(root, value ?? ".");
  const relative = path.relative(root, absolutePath);
  const inside = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));

  return inside ? { ok: true, absolutePath } : { ok: false, message: `路径超出工作区：${value ?? "."}` };
}

export function workspaceRelativePath(workspaceRoot: string, absolutePath: string): string {
  return path.relative(path.resolve(workspaceRoot), path.resolve(absolutePath)).split(path.sep).join("/");
}

export async function validateWorkspaceMutationPath(
  workspaceRoot: string,
  absolutePath: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(absolutePath);
  if (!isPathInside(root, target)) {
    return { ok: false, message: `路径超出工作区：${absolutePath}` };
  }

  const canonicalRoot = await fs.realpath(root);
  let cursor = root;
  const relative = path.relative(root, target);
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    let stat: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      stat = await fs.lstat(cursor);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        break;
      }
      throw error;
    }

    if (stat.isSymbolicLink()) {
      return { ok: false, message: `工作区写入路径不能经过符号链接或目录联接：${absolutePath}` };
    }
    const canonical = await fs.realpath(cursor);
    if (!isPathInside(canonicalRoot, canonical)) {
      return { ok: false, message: `工作区写入路径解析后超出工作区：${absolutePath}` };
    }
  }

  return { ok: true };
}

function isPathInside(root: string, value: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(value));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
