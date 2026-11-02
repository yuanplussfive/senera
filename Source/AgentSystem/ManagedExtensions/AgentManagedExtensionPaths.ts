import fs from "node:fs";
import path from "node:path";
import { assertAgentExtensionName } from "../Extensions/AgentExtensionIdentity.js";
import { resolveAgentWorkspaceLayout } from "../Core/AgentWorkspaceLayout.js";
import { relativePathWithin } from "../Core/AgentPath.js";

export interface AgentManagedExtensionPaths {
  readonly skillRoot: string;
}

export function resolveAgentManagedExtensionPaths(workspaceRoot: string): AgentManagedExtensionPaths {
  const root = path.resolve(workspaceRoot);
  const resolved = {
    skillRoot: resolveAgentWorkspaceLayout(root).skillRoot,
  };
  for (const managedPath of Object.values(resolved)) assertNoSymbolicLinkAncestors(root, managedPath);
  return resolved;
}

export function resolveManagedExtensionDirectory(root: string, name: string): string {
  assertAgentExtensionName(name);
  assertExtensionDirectoryName(name);
  const resolvedRoot = path.resolve(root);
  const target = path.join(resolvedRoot, name);
  assertPathInside(resolvedRoot, target, "Managed extension path");
  return target;
}

export function assertExtensionDirectoryName(name: string): void {
  const parsed = path.parse(name);
  if (!name || name === "." || name === ".." || parsed.dir || parsed.base !== name || path.isAbsolute(name)) {
    throw new Error(`Extension directory name must be a single relative path segment: ${name}`);
  }
}

export function assertPathInside(root: string, target: string, label: string): void {
  const relative = relativePathWithin(root, target);
  if (relative) return;
  throw new Error(`${label} must stay inside ${path.resolve(root)}.`);
}

function assertNoSymbolicLinkAncestors(root: string, target: string): void {
  const relative = path.relative(root, target);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw new Error(`Managed extension paths cannot traverse symbolic links: ${current}`);
      }
    } catch (error) {
      if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}
