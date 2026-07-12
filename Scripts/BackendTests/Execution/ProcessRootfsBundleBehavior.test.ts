import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createSeneraProcessRootfsBundle } from "../../../Source/AgentSystem/Execution/SeneraProcessRootfsBundle.js";
import { SeneraExecutionErrorCodes } from "../../../Source/AgentSystem/Execution/SeneraExecutionTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    removeDirectory(temporaryDirectories.pop()!);
  }
});

describe("Process rootfs bundle behavior", () => {
  test("copies package sources and recursive local dependencies into portable bundle locations", async () => {
    const fixture = createBundleFixture();
    const bundle = await createSeneraProcessRootfsBundle({
      workspaceRoot: fixture.workspaceRoot,
      packageRoot: fixture.packageRoot,
    });

    const bundledPackage = inBundle(bundle.rootPath, fixture.workspaceRoot, fixture.packageRoot);
    const bundledLocalDependency = inBundle(bundle.rootPath, fixture.workspaceRoot, fixture.localDependencyRoot);
    const bundledNestedDependency = inBundle(bundle.rootPath, fixture.workspaceRoot, fixture.nestedDependencyRoot);

    expect(readBundledFile(bundledPackage, "src", "index.js")).toBe("application source");
    expect(readBundledFile(bundledLocalDependency, "index.js")).toBe("local dependency");
    expect(readBundledFile(bundledNestedDependency, "index.js")).toBe("nested dependency");
    expect(readBundledFile(bundle.rootPath, "node_modules", "local-dependency", "index.js")).toBe("local dependency");
    expect(readBundledFile(bundle.rootPath, "node_modules", "nested-dependency", "index.js")).toBe("nested dependency");

    bundle.cleanup();
  });

  test("copies workspace-installed scoped dependencies and excludes runtime-owned directories", async () => {
    const fixture = createBundleFixture();
    const packageNodeModules = path.join(fixture.packageRoot, "node_modules");
    const packageState = path.join(fixture.packageRoot, ".state");
    writeFile(path.join(packageNodeModules, "ignored.txt"), "not bundled");
    writeFile(path.join(packageState, "ignored.txt"), "not bundled");

    const bundle = await createSeneraProcessRootfsBundle({
      workspaceRoot: fixture.workspaceRoot,
      packageRoot: fixture.packageRoot,
    });
    const bundledPackage = inBundle(bundle.rootPath, fixture.workspaceRoot, fixture.packageRoot);

    expect(readBundledFile(bundle.rootPath, "node_modules", "@scope", "workspace-dependency", "index.js")).toBe(
      "workspace dependency",
    );
    expect(fs.existsSync(path.join(bundledPackage, "node_modules"))).toBe(false);
    expect(fs.existsSync(path.join(bundledPackage, ".state"))).toBe(false);

    bundle.cleanup();
  });

  test("ignores missing and out-of-workspace dependencies", async () => {
    const fixture = createBundleFixture({ includeUnresolvableDependencies: true });
    const bundle = await createSeneraProcessRootfsBundle({
      workspaceRoot: fixture.workspaceRoot,
      packageRoot: fixture.packageRoot,
    });

    expect(fs.existsSync(path.join(bundle.rootPath, "node_modules", "missing-dependency"))).toBe(false);
    expect(fs.existsSync(path.join(bundle.rootPath, "node_modules", "external-dependency"))).toBe(false);

    bundle.cleanup();
  });

  test("removes the complete bundle during idempotent cleanup", async () => {
    const fixture = createBundleFixture();
    const bundle = await createSeneraProcessRootfsBundle({
      workspaceRoot: fixture.workspaceRoot,
      packageRoot: fixture.packageRoot,
    });

    expect(fs.existsSync(bundle.rootPath)).toBe(true);
    bundle.cleanup();
    bundle.cleanup();
    expect(fs.existsSync(bundle.rootPath)).toBe(false);
  });

  test("rejects package roots outside the declared workspace before creating a bundle", async () => {
    const fixtureRoot = createFixtureRoot();
    const workspaceRoot = path.join(fixtureRoot, "workspace");
    const packageRoot = path.join(fixtureRoot, "external-package");
    writePackage(packageRoot, "external-package");

    await expect(createSeneraProcessRootfsBundle({ workspaceRoot, packageRoot })).rejects.toMatchObject({
      code: SeneraExecutionErrorCodes.InvalidWorkspacePath,
      details: {
        workspaceRoot: path.resolve(workspaceRoot),
        packageRoot: path.resolve(packageRoot),
      },
    });
  });
});

function createBundleFixture(options: { includeUnresolvableDependencies?: boolean } = {}) {
  const fixtureRoot = createFixtureRoot();
  const workspaceRoot = path.join(fixtureRoot, "workspace");
  const packageRoot = path.join(workspaceRoot, "plugins", "application");
  const localDependencyRoot = path.join(workspaceRoot, "packages", "local-dependency");
  const nestedDependencyRoot = path.join(workspaceRoot, "packages", "nested-dependency");
  const workspaceDependencyRoot = path.join(workspaceRoot, "node_modules", "@scope", "workspace-dependency");
  const dependencies: Record<string, string> = {
    "local-dependency": "file:../../packages/local-dependency",
    "nested-dependency": "file:../../packages/nested-dependency",
    "@scope/workspace-dependency": "workspace:*",
  };

  if (options.includeUnresolvableDependencies) {
    dependencies["missing-dependency"] = "file:../../packages/missing-dependency";
    dependencies["external-dependency"] = "file:../../../external-dependency";
    writePackage(path.join(fixtureRoot, "external-dependency"), "external-dependency", {}, "external dependency");
  }

  writePackage(packageRoot, "application", dependencies);
  writeFile(path.join(packageRoot, "src", "index.js"), "application source");
  writePackage(
    localDependencyRoot,
    "local-dependency",
    { "nested-dependency": "file:../nested-dependency" },
    "local dependency",
  );
  writePackage(nestedDependencyRoot, "nested-dependency", {}, "nested dependency");
  writePackage(workspaceDependencyRoot, "@scope/workspace-dependency", {}, "workspace dependency");

  return {
    workspaceRoot,
    packageRoot,
    localDependencyRoot,
    nestedDependencyRoot,
  };
}

function writePackage(
  packageRoot: string,
  name: string,
  dependencies: Record<string, string> = {},
  source?: string,
): void {
  writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name, dependencies }, null, 2));
  if (source !== undefined) {
    writeFile(path.join(packageRoot, "index.js"), source);
  }
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function readBundledFile(root: string, ...segments: string[]): string {
  return fs.readFileSync(path.join(root, ...segments), "utf8");
}

function inBundle(bundleRoot: string, workspaceRoot: string, sourceRoot: string): string {
  return path.join(bundleRoot, path.relative(workspaceRoot, sourceRoot));
}

function createFixtureRoot(): string {
  const fixtureRoot = createTemporaryDirectory("senera-rootfs");
  temporaryDirectories.push(fixtureRoot);
  return fixtureRoot;
}
