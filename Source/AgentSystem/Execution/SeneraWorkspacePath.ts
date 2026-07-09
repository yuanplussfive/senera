import path from "node:path";

export function resolveWorkspacePath(
  workspaceRoot: string,
  value: string | undefined,
): { ok: true; absolutePath: string } | { ok: false; message: string } {
  const root = path.resolve(workspaceRoot);
  const absolutePath = path.resolve(root, value ?? ".");
  const relative = path.relative(root, absolutePath);
  const inside = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));

  return inside
    ? { ok: true, absolutePath }
    : { ok: false, message: `路径超出工作区：${value ?? "."}` };
}

export function workspaceRelativePath(workspaceRoot: string, absolutePath: string): string {
  return path.relative(path.resolve(workspaceRoot), path.resolve(absolutePath)).split(path.sep).join("/");
}
