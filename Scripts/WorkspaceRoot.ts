import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type WorkspaceRootAnchor = string | URL;

export function resolveWorkspaceRoot(anchor: WorkspaceRootAnchor = import.meta.url): string {
  const startPath = canonicalPath(resolveAnchorPath(anchor));
  let current = fs.statSync(startPath).isDirectory() ? startPath : path.dirname(startPath);

  for (;;) {
    if (isWorkspaceRoot(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error(`Unable to resolve Senera workspace root from ${startPath}.`);
}

function resolveAnchorPath(anchor: WorkspaceRootAnchor): string {
  if (anchor instanceof URL) return fileURLToPath(anchor);
  return anchor.startsWith("file:") ? fileURLToPath(anchor) : path.resolve(anchor);
}

function canonicalPath(candidate: string): string {
  return fs.realpathSync.native(candidate);
}

function isWorkspaceRoot(candidate: string): boolean {
  return (
    fs.existsSync(path.join(candidate, "package.json")) &&
    fs.existsSync(path.join(candidate, "Frontend", "src")) &&
    fs.existsSync(path.join(candidate, "Source", "AgentSystem"))
  );
}
