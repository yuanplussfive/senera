import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import Database from "better-sqlite3";

const packageRoots = findInstalledPackageRoots(process.cwd(), "better-sqlite3");
assert.ok(packageRoots.length > 0, "At least one better-sqlite3 installation must be present.");
let installedVersion: string | undefined;

for (const packageRoot of packageRoots) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
    readonly name?: unknown;
    readonly version?: unknown;
  };
  assert.equal(packageJson.name, "better-sqlite3");
  if (typeof packageJson.version !== "string") throw new Error(`Invalid better-sqlite3 version at ${packageRoot}.`);
  installedVersion ??= packageJson.version;
  assert.equal(
    packageJson.version,
    installedVersion,
    `All better-sqlite3 installations must share one native version; found ${packageJson.version} at ${packageRoot}.`,
  );
  const packageRequire = createRequire(path.join(packageRoot, "package.json"));
  const PackageDatabase = packageRequire(packageRoot) as typeof Database;
  const database = new PackageDatabase(":memory:");
  try {
    database.exec("CREATE TABLE smoke_check (value TEXT NOT NULL); INSERT INTO smoke_check VALUES ('ok');");
    const row = database.prepare("SELECT value FROM smoke_check LIMIT 1").get() as { value?: unknown } | undefined;
    assert.equal(row?.value, "ok");
  } finally {
    database.close();
  }
  console.log(`Docker native SQLite verification passed: ${packageRoot} (${packageJson.version}).`);
}

function findInstalledPackageRoots(root: string, packageName: string): string[] {
  const roots: string[] = [];
  const visited = new Set<string>();
  const visitNodeModules = (nodeModulesRoot: string): void => {
    const resolvedRoot = path.resolve(nodeModulesRoot);
    if (visited.has(resolvedRoot) || !fs.existsSync(resolvedRoot)) return;
    visited.add(resolvedRoot);
    for (const entry of fs.readdirSync(resolvedRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const packageRoot = path.join(resolvedRoot, entry.name);
      if (entry.name.startsWith("@")) {
        visitScope(packageRoot);
        continue;
      }
      inspectPackage(packageRoot);
    }
  };
  const visitScope = (scopeRoot: string): void => {
    if (!fs.existsSync(scopeRoot)) return;
    for (const entry of fs.readdirSync(scopeRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) inspectPackage(path.join(scopeRoot, entry.name));
    }
  };
  const inspectPackage = (packageRoot: string): void => {
    const packagePath = path.join(packageRoot, "package.json");
    if (fs.existsSync(packagePath)) {
      const metadata = JSON.parse(fs.readFileSync(packagePath, "utf8")) as { readonly name?: unknown };
      if (metadata.name === packageName) roots.push(packageRoot);
    }
    visitNodeModules(path.join(packageRoot, "node_modules"));
  };
  visitNodeModules(path.join(root, "node_modules"));
  return roots.sort();
}
