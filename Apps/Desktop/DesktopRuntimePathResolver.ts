import fs from "node:fs";
import path from "node:path";

const DesktopProjectLayout = {
  files: ["package.json"],
  directories: ["Apps/Desktop", "Frontend", "System/Plugins"],
} as const;

export interface DesktopResourceRootResolutionInput {
  appPath: string;
  isPackaged: boolean;
  launchRoot: string;
}

/**
 * Packaged applications load resources from Electron's app path. Development
 * runs resolve the checked-in project layout rather than user-local config.
 */
export function resolveDesktopResourceRoot(input: DesktopResourceRootResolutionInput): string {
  if (input.isPackaged) {
    return path.resolve(input.appPath);
  }

  const root = findDesktopProjectRoot([input.launchRoot, input.appPath]);
  if (root) {
    return root;
  }

  throw new DesktopRuntimePathResolutionError({
    appPath: input.appPath,
    launchRoot: input.launchRoot,
  });
}

export function resolveDesktopWorkspaceRoot(input: {
  isPackaged: boolean;
  resourceRoot: string;
  userDataRoot: string;
}): string {
  return input.isPackaged ? path.resolve(input.userDataRoot) : path.resolve(input.resourceRoot);
}

export class DesktopRuntimePathResolutionError extends Error {
  readonly appPath: string;
  readonly launchRoot: string;

  constructor(input: { appPath: string; launchRoot: string }) {
    super(
      `Unable to resolve the Senera development resource root from appPath=${path.resolve(input.appPath)} launchRoot=${path.resolve(input.launchRoot)}.`,
    );
    this.name = "DesktopRuntimePathResolutionError";
    this.appPath = path.resolve(input.appPath);
    this.launchRoot = path.resolve(input.launchRoot);
  }
}

function findDesktopProjectRoot(startPaths: readonly string[]): string | undefined {
  for (const startPath of uniquePaths(startPaths)) {
    const root = findDesktopProjectRootFrom(startPath);
    if (root) {
      return root;
    }
  }
  return undefined;
}

function findDesktopProjectRootFrom(startPath: string): string | undefined {
  let current = resolveDirectoryPath(startPath);
  while (true) {
    if (matchesDesktopProjectLayout(current)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function matchesDesktopProjectLayout(root: string): boolean {
  return (
    DesktopProjectLayout.files.every((entry) => isFile(path.join(root, entry))) &&
    DesktopProjectLayout.directories.every((entry) => isDirectory(path.join(root, entry)))
  );
}

function resolveDirectoryPath(value: string): string {
  const resolved = path.resolve(value);
  return isFile(resolved) ? path.dirname(resolved) : resolved;
}

function uniquePaths(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => path.resolve(value)))];
}

function isFile(value: string): boolean {
  return statMatches(value, (stat) => stat.isFile());
}

function isDirectory(value: string): boolean {
  return statMatches(value, (stat) => stat.isDirectory());
}

function statMatches(value: string, predicate: (stat: fs.Stats) => boolean): boolean {
  try {
    return predicate(fs.statSync(value));
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }
    throw error;
  }
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
