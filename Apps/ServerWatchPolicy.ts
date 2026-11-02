import path from "node:path";

export const DevServerWatchedEntries = Object.freeze([
  "Apps",
  "Source",
  "System",
  "Packages",
  "Build",
  "Native",
  "baml_src",
  "package.json",
  "tsconfig.json",
] as const);

const IgnoredPathSegments = new Set([
  ".git",
  ".agents",
  ".claude",
  ".codex",
  ".senera",
  ".uploads",
  ".trae-html-share-packages",
  ".vite",
  ".cache",
  "coverage",
  "Dist",
  "dist",
  "node_modules",
  "Release",
  "tmp",
  "temp",
]);

const IndependentlyManagedPaths = [
  path.join("System", "Skills"),
  // Gradle owns the native client and generated web assets; these never restart Node.
  path.join("Apps", "Mobile", "android"),
] as const;

export function isDevServerWatchPathIgnored(workspaceRoot: string, absolutePath: string): boolean {
  const relative = path.relative(workspaceRoot, absolutePath);
  if (!relative || relative.startsWith("..")) {
    return false;
  }
  return (
    IndependentlyManagedPaths.some((managedPath) => isSamePathOrDescendant(relative, managedPath)) ||
    relative.split(path.sep).some((segment) => IgnoredPathSegments.has(segment))
  );
}

function isSamePathOrDescendant(candidate: string, parent: string): boolean {
  return candidate === parent || candidate.startsWith(`${parent}${path.sep}`);
}
