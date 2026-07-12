import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import { SeneraExecutionError, SeneraExecutionErrorCodes } from "./SeneraExecutionTypes.js";

const RootfsBundleDefaults = {
  tempPrefix: "senera-rootfs-bundle-",
  excludedEntries: new Set(["node_modules", ".state"]),
  packageJsonFileName: "package.json",
} as const;

export interface SeneraProcessRootfsBundle {
  rootPath: string;
  cleanup(): void;
}

export async function createSeneraProcessRootfsBundle(input: {
  workspaceRoot: string;
  packageRoot: string;
}): Promise<SeneraProcessRootfsBundle> {
  assertPackageRootInsideWorkspace(input);
  const bundleRoot = mkdtempSync(path.join(tmpdir(), RootfsBundleDefaults.tempPrefix));
  try {
    copySourceTree({
      source: input.packageRoot,
      target: path.join(bundleRoot, relativeFromWorkspace(input.workspaceRoot, input.packageRoot)),
    });

    const dependencies = await resolveDependencies({
      workspaceRoot: input.workspaceRoot,
      packageRoot: input.packageRoot,
    });
    for (const dependency of dependencies) {
      copySourceTree({
        source: dependency.rootPath,
        target: path.join(bundleRoot, relativeFromWorkspace(input.workspaceRoot, dependency.rootPath)),
      });
      copySourceTree({
        source: dependency.rootPath,
        target: path.join(bundleRoot, "node_modules", ...dependency.name.split("/")),
      });
    }

    return {
      rootPath: bundleRoot,
      cleanup: () => cleanupBundle(bundleRoot),
    };
  } catch (error) {
    cleanupBundle(bundleRoot);
    throw error;
  }
}

function assertPackageRootInsideWorkspace(input: { workspaceRoot: string; packageRoot: string }): void {
  if (isPathInside(input.workspaceRoot, input.packageRoot)) return;

  throw new SeneraExecutionError(
    SeneraExecutionErrorCodes.InvalidWorkspacePath,
    agentErrorMessage("execution.packageRootOutsideWorkspace"),
    {
      workspaceRoot: path.resolve(input.workspaceRoot),
      packageRoot: path.resolve(input.packageRoot),
    },
  );
}

interface SeneraDependencyPackage {
  name: string;
  rootPath: string;
}

async function resolveDependencies(input: {
  workspaceRoot: string;
  packageRoot: string;
}): Promise<SeneraDependencyPackage[]> {
  const visited = new Set<string>();
  const visit = async (packageRoot: string): Promise<SeneraDependencyPackage[]> => {
    const normalizedRoot = path.resolve(packageRoot);
    if (visited.has(normalizedRoot)) return [];
    visited.add(normalizedRoot);

    const dependencies = await readPackageDependencies(normalizedRoot);
    const roots = await Promise.all(
      Object.entries(dependencies).map(async ([name, spec]) => {
        const resolved = resolveDependencyRoot({
          workspaceRoot: input.workspaceRoot,
          packageRoot: normalizedRoot,
          name,
          spec,
        });
        return resolved ? [resolved, ...(await visit(resolved.rootPath))] : [];
      }),
    );
    return roots.flat();
  };

  return uniqueDependencies(await visit(input.packageRoot));
}

async function readPackageDependencies(packageRoot: string): Promise<Record<string, string>> {
  const packageJson = JSON.parse(
    await readFile(path.join(packageRoot, RootfsBundleDefaults.packageJsonFileName), "utf8"),
  ) as {
    dependencies?: Record<string, string>;
  };
  return packageJson.dependencies ?? {};
}

function resolveDependencyRoot(input: {
  workspaceRoot: string;
  packageRoot: string;
  name: string;
  spec: string;
}): SeneraDependencyPackage | undefined {
  const resolved = input.spec.startsWith("file:")
    ? path.resolve(input.packageRoot, input.spec.slice("file:".length))
    : path.resolve(input.workspaceRoot, "node_modules", ...input.name.split("/"));
  return isPathInside(input.workspaceRoot, resolved) &&
    existsSync(path.join(resolved, RootfsBundleDefaults.packageJsonFileName))
    ? {
        name: input.name,
        rootPath: resolved,
      }
    : undefined;
}

function uniqueDependencies(dependencies: readonly SeneraDependencyPackage[]): SeneraDependencyPackage[] {
  return [
    ...new Map(
      dependencies.map((dependency) => [`${dependency.name}\u0000${path.resolve(dependency.rootPath)}`, dependency]),
    ).values(),
  ];
}

function copySourceTree(input: { source: string; target: string }): void {
  cpSync(input.source, input.target, {
    recursive: true,
    force: true,
    filter: (source) => !shouldExcludeSource(input.source, source),
  });
}

function shouldExcludeSource(root: string, source: string): boolean {
  const relativeParts = path.relative(root, source).split(path.sep).filter(Boolean);
  return relativeParts.some((part) => RootfsBundleDefaults.excludedEntries.has(part));
}

function relativeFromWorkspace(workspaceRoot: string, value: string): string {
  const relative = path.relative(path.resolve(workspaceRoot), path.resolve(value));
  return relative === "" ? "." : relative;
}

function cleanupBundle(bundleRoot: string): void {
  rmSync(bundleRoot, { recursive: true, force: true });
}

function isPathInside(root: string, value: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(value));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
