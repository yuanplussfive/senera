import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sync as spawnSync } from "cross-spawn";
import fg from "fast-glob";

interface PackageJson {
  name?: string;
  workspaces?: string[] | {
    packages?: string[];
  };
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  build?: ElectronBuilderConfig;
}

interface ElectronBuilderConfig {
  files?: Array<string | ElectronBuilderFileSet>;
  asarUnpack?: string[];
  extraMetadata?: {
    main?: string;
  };
}

interface ElectronBuilderFileSet {
  from?: string;
  to?: string;
  filter?: string[];
}

interface WorkspacePackage {
  name: string;
  location: string;
}

interface NpmWorkspaceQueryEntry {
  name?: string;
  location?: string;
  path?: string;
}

const workspaceRoot = process.cwd();
const rootPackage = readPackageJson(path.join(workspaceRoot, "package.json"));
const workspacePatterns = readWorkspacePatterns(rootPackage);
const expectedWorkspaces = discoverWorkspacePackages(workspacePatterns);
const installedWorkspaces = readInstalledWorkspacePackages();
const violations = [
  ...inspectWorkspaceCoverage(),
  ...inspectInstalledWorkspaceState(),
  ...inspectRootScripts(),
  ...inspectRootRuntimeDependencies(),
  ...inspectRetiredRootScripts(),
  ...inspectApplicationEntrypoints(),
  ...inspectDesktopPackageConfig(),
  ...inspectFrontendScripts(),
  ...inspectWorkspaceNpmrcFiles(),
  ...inspectWorkspaceLockFiles(),
];

assert.deepEqual(
  violations,
  [],
  [
    "Workspace dependency governance failed.",
    ...violations.map((violation) => `- ${violation}`),
  ].join("\n"),
);

console.log(`Workspace dependency governance verified (${expectedWorkspaces.length} workspaces).`);

function inspectWorkspaceCoverage(): string[] {
  const locations = new Set(expectedWorkspaces.map((workspace) => workspace.location));
  return locations.has("Frontend")
    ? []
    : ["Frontend/package.json is not covered by the root package.json workspaces."];
}

function inspectInstalledWorkspaceState(): string[] {
  const installedLocations = new Set(installedWorkspaces.map((workspace) => workspace.location));
  return expectedWorkspaces
    .filter((workspace) => !installedLocations.has(workspace.location))
    .map((workspace) => [
      `${workspace.location} is declared as a workspace but is not present in npm query .workspace.`,
      "Run npm install from the repository root to refresh workspace links.",
    ].join(" "));
}

function inspectRootScripts(): string[] {
  return inspectScripts(rootPackage, "package.json", {
    "clean": "rimraf Dist",
    "build": "npm run clean && tsc",
    "dev": "concurrently -k -n server,frontend -c blue,green \"npm run serverwatch\" \"npm run frontend\"",
    "frontend": "npm --workspace senera-frontend run dev",
    "frontendcheck": "npm --workspace senera-frontend run check",
    "frontendtest": "npm --workspace senera-frontend run test",
    "frontendverify": "npm --workspace senera-frontend run verify",
    "server": "npm run build && node Dist/Apps/Server.js",
    "serverwatch": "tsx watch Apps/Server.ts",
    "cli": "npm run build && node Dist/Apps/Cli.js",
    "desktop": "npm run build && npm --workspace senera-frontend run build && electron Dist/Apps/Desktop/Main.js",
    "desktoppack": "tsx Apps/Desktop/PackageDesktop.ts",
    "desktoprestore": "npm rebuild better-sqlite3",
    "verifysuite": "node Dist/Scripts/VerifySuite.js",
    "verifysuites": "node Dist/Scripts/VerifySuite.js --list",
    "verifyworkspace": "npm run build && npm run verifysuite -- workspace",
    "verifycontracts": "npm run build && npm run verifysuite -- contracts",
    "verify": "npm run build && npm run verifysuite -- core",
    "verifyall": "npm run build && npm run verifysuite -- all-local",
    "ci": "npm run check && npm run build && npm run verifysuite -- workspace core && npm run frontendverify",
  });
}

function inspectRootRuntimeDependencies(): string[] {
  return inspectDependencies(rootPackage, "package.json", {
    "@senera/tool-plugin-sdk": "file:Packages/ToolPluginSdk",
    "@senera/workspace-context-core": "file:Packages/WorkspaceContextCore",
    "@vscode/ripgrep": "^1.15.14",
  });
}

function inspectRetiredRootScripts(): string[] {
  return Object.keys(rootPackage.scripts ?? {})
    .filter((scriptName) => scriptName.includes(":"))
    .map((scriptName) => `package.json script ${scriptName} uses a retired colon-style command name.`);
}

function inspectApplicationEntrypoints(): string[] {
  const expectedFiles = [
    "Apps/Server.ts",
    "Apps/Cli.ts",
    "Apps/ServerRuntime.ts",
    "Apps/Desktop/Main.ts",
    "Apps/Desktop/DesktopRuntime.ts",
    "Apps/Desktop/PackageDesktop.ts",
  ];
  const retiredFiles = [
    "Scripts/SeneraServer.ts",
    "Scripts/SeneraCli.ts",
  ];

  return [
    ...expectedFiles
      .filter((file) => !fs.existsSync(path.join(workspaceRoot, file)))
      .map((file) => `${file} must exist as an application entrypoint.`),
    ...retiredFiles
      .filter((file) => fs.existsSync(path.join(workspaceRoot, file)))
      .map((file) => `${file} must move out of Scripts; Scripts is reserved for verification and diagnostics.`),
  ];
}

function inspectDesktopPackageConfig(): string[] {
  return [
    ...(
      rootPackage.build?.extraMetadata?.main === "Dist/Apps/Desktop/Main.js"
        ? []
        : ["package.json build.extraMetadata.main must point to Dist/Apps/Desktop/Main.js."]
    ),
    ...inspectDesktopPackageScript(),
    ...inspectDesktopFileSet("Packages/ToolPluginSdk", "node_modules/@senera/tool-plugin-sdk"),
    ...inspectDesktopFileSet("Packages/WorkspaceContextCore", "node_modules/@senera/workspace-context-core"),
    ...inspectDesktopAsarUnpack([
      "senera.config.example.json",
      "System/Plugins/**",
      "Plugins/**",
    ]),
  ];
}

function inspectDesktopPackageScript(): string[] {
  const scriptPath = path.join(workspaceRoot, "Apps", "Desktop", "PackageDesktop.ts");
  const source = fs.readFileSync(scriptPath, "utf8");
  return source.includes("clearNativeRebuildMetadata")
    ? []
    : ["Apps/Desktop/PackageDesktop.ts must clear stale Electron native rebuild metadata before packaging."];
}

function inspectDesktopFileSet(from: string, to: string): string[] {
  const fileSets = rootPackage.build?.files?.filter(isElectronBuilderFileSet) ?? [];
  return fileSets.some((fileSet) => fileSet.from === from && fileSet.to === to)
    ? []
    : [`package.json build.files must package ${from} to ${to}.`];
}

function inspectDesktopAsarUnpack(expectedEntries: readonly string[]): string[] {
  const entries = new Set(rootPackage.build?.asarUnpack ?? []);
  return expectedEntries
    .filter((entry) => !entries.has(entry))
    .map((entry) => `package.json build.asarUnpack must include ${entry}.`);
}

function inspectFrontendScripts(): string[] {
  const frontendPackage = readPackageJson(path.join(workspaceRoot, "Frontend", "package.json"));
  return inspectScripts(frontendPackage, "Frontend/package.json", {
    "check": "tsc --noEmit",
    "test": "vitest run",
    "verify": "npm run arch:check && npm run check && npm run test",
  });
}

function inspectWorkspaceNpmrcFiles(): string[] {
  return expectedWorkspaces
    .map((workspace) => path.join(workspaceRoot, workspace.location, ".npmrc"))
    .filter((file) => fs.existsSync(file))
    .map((file) => [
      `${relativePath(file)} is ignored by npm workspace execution.`,
      "Move shared npm install policy to the repository root or remove it.",
    ].join(" "));
}

function inspectWorkspaceLockFiles(): string[] {
  return expectedWorkspaces
    .map((workspace) => path.join(workspaceRoot, workspace.location, "package-lock.json"))
    .filter((file) => fs.existsSync(file))
    .map((file) => [
      `${relativePath(file)} creates a second npm install boundary.`,
      "Use npm install from the repository root so the root workspace owns dependency resolution.",
    ].join(" "));
}

function inspectDependencies(
  packageJson: PackageJson,
  packagePath: string,
  expectedDependencies: Record<string, string>,
): string[] {
  return Object.entries(expectedDependencies)
    .filter(([name, version]) => packageJson.dependencies?.[name] !== version)
    .map(([name, version]) => `${packagePath} dependency ${name} must be: ${version}`);
}

function isElectronBuilderFileSet(value: string | ElectronBuilderFileSet): value is ElectronBuilderFileSet {
  return typeof value === "object" && value !== null;
}

function inspectScripts(
  packageJson: PackageJson,
  packagePath: string,
  expectedScripts: Record<string, string>,
): string[] {
  return Object.entries(expectedScripts)
    .filter(([name, command]) => packageJson.scripts?.[name] !== command)
    .map(([name, command]) => `${packagePath} script ${name} must be: ${command}`);
}

function discoverWorkspacePackages(patterns: readonly string[]): WorkspacePackage[] {
  const packageFiles = fg.sync(patterns.map(toPackageJsonPattern), {
    cwd: workspaceRoot,
    absolute: true,
    onlyFiles: true,
    unique: true,
    ignore: [
      "**/node_modules/**",
    ],
  }).sort((left, right) => relativePath(left).localeCompare(relativePath(right)));

  assert.ok(packageFiles.length > 0, "Root package.json workspaces did not match any package.json files.");

  return packageFiles.map((file) => {
    const packageJson = readPackageJson(file);
    assert.ok(packageJson.name, `${relativePath(file)} must define package name.`);
    return {
      name: packageJson.name,
      location: relativePath(path.dirname(file)),
    };
  });
}

function readInstalledWorkspacePackages(): WorkspacePackage[] {
  const result = spawnSync("npm", ["query", ".workspace", "--json"], {
    cwd: workspaceRoot,
    encoding: "utf8",
    windowsHide: true,
  });

  assert.equal(
    result.status,
    0,
    [
      "npm query .workspace failed.",
      result.error?.message,
      result.stderr?.trim(),
    ].filter(Boolean).join("\n"),
  );

  const entries = JSON.parse(result.stdout) as NpmWorkspaceQueryEntry[];
  assert.ok(Array.isArray(entries), "npm query .workspace must return an array.");

  return entries.map((entry) => {
    assert.ok(entry.name, "npm workspace query entry must include name.");
    assert.ok(entry.location || entry.path, `npm workspace query entry ${entry.name} must include location or path.`);
    return {
      name: entry.name,
      location: entry.location
        ? normalizeRelativePath(entry.location)
        : relativePath(entry.path as string),
    };
  });
}

function readWorkspacePatterns(packageJson: PackageJson): string[] {
  if (Array.isArray(packageJson.workspaces)) {
    return packageJson.workspaces;
  }
  if (Array.isArray(packageJson.workspaces?.packages)) {
    return packageJson.workspaces.packages;
  }
  throw new Error("Root package.json must define npm workspaces.");
}

function readPackageJson(file: string): PackageJson {
  return JSON.parse(fs.readFileSync(file, "utf8")) as PackageJson;
}

function toPackageJsonPattern(pattern: string): string {
  return pattern.endsWith("package.json")
    ? pattern
    : path.posix.join(normalizeRelativePath(pattern), "package.json");
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join("/");
}

function relativePath(value: string): string {
  return path.relative(workspaceRoot, value).split(path.sep).join("/");
}
