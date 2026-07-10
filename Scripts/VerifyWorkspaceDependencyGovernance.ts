import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import { E2eTestPolicy, ProjectTestCoveragePolicies } from "./TestCoveragePolicy.js";

interface PackageJson {
  name?: string;
  type?: string;
  workspaces?: string[] | {
    packages?: string[];
  };
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  exports?: Record<string, PackageExportConditions>;
  build?: ElectronBuilderConfig;
}

interface PackageLockJson {
  name?: string;
  lockfileVersion?: number;
  packages?: Record<string, {
    name?: string;
    version?: string;
    resolved?: string;
    link?: boolean;
    workspaces?: unknown;
    optionalDependencies?: Record<string, string>;
  }>;
}

interface PackageExportConditions {
  types?: string;
  import?: string;
  require?: string;
  default?: string;
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

const workspaceRoot = process.cwd();
const rootPackage = readPackageJson(path.join(workspaceRoot, "package.json"));
const rootLockfilePath = path.join(workspaceRoot, "package-lock.json");
const rootLockfile = fs.existsSync(rootLockfilePath)
  ? readPackageLockJson(rootLockfilePath)
  : undefined;
const workspacePatterns = readWorkspacePatterns(rootPackage);
const expectedWorkspaces = discoverWorkspacePackages(workspacePatterns);
const verifyWorkflow = readTextFile(path.join(workspaceRoot, ".github", "workflows", "verify.yml"));
const securityScanWorkflow = readTextFile(path.join(workspaceRoot, ".github", "workflows", "security-scan.yml"));
const containerReleaseWorkflow = readTextFile(path.join(workspaceRoot, ".github", "workflows", "container-release.yml"));
const desktopReleaseWorkflow = readTextFile(path.join(workspaceRoot, ".github", "workflows", "desktop-release.yml"));
const violations = [
  ...inspectWorkspaceCoverage(),
  ...inspectLockfileWorkspaceState(),
  ...inspectBamlNativeBindingClosure(),
  ...inspectRootNpmPolicy(),
  ...inspectVerifyWorkflow(),
  ...inspectSecurityScanWorkflow(),
  ...inspectReleaseWorkflowGates(),
  ...inspectRootScripts(),
  ...inspectModuleSystemBoundary(),
  ...inspectRootRuntimeDependencies(),
  ...inspectRetiredRootScripts(),
  ...inspectApplicationEntrypoints(),
  ...inspectTestGovernanceEntrypoints(),
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

function inspectLockfileWorkspaceState(): string[] {
  if (!rootLockfile) {
    return [];
  }
  const packages = rootLockfile.packages ?? {};
  return expectedWorkspaces.flatMap((workspace) => {
    const workspaceEntry = packages[workspace.location];
    const linkEntry = packages[path.posix.join("node_modules", workspace.name)];
    const issues: string[] = [];
    if (!workspaceEntry) {
      issues.push(`${workspace.location} is declared as a workspace but is missing from package-lock.json.`);
    }
    if (!linkEntry || linkEntry.resolved !== workspace.location || linkEntry.link !== true) {
      issues.push(`package-lock.json must link workspace ${workspace.name} to ${workspace.location}.`);
    }
    return issues;
  });
}

function inspectBamlNativeBindingClosure(): string[] {
  const packages = rootLockfile?.packages;
  if (!packages) return [];

  const bamlPackage = packages["node_modules/@boundaryml/baml"];
  const platformBindings = bamlPackage?.optionalDependencies;
  if (!platformBindings) {
    return ["package-lock.json must retain @boundaryml/baml platform binding metadata."];
  }

  const declaredBindings = rootPackage.optionalDependencies ?? {};
  return Object.entries(platformBindings).flatMap(([packageName, version]) => {
    const issues: string[] = [];
    if (!(packageName in declaredBindings)) {
      issues.push(`package.json optionalDependencies must declare BAML platform binding ${packageName}.`);
    }
    if (packages[`node_modules/${packageName}`]?.version !== version) {
      issues.push(`package-lock.json must resolve BAML platform binding ${packageName}@${version}.`);
    }
    return issues;
  });
}

function inspectRootScripts(): string[] {
  const expectedScripts = {
    "clean": "rimraf Dist",
    "bamlcheck": "baml check --from baml_src",
    "bamlgenerate": "baml generate --from baml_src",
    "compileopapolicy": "tsx Build/CompileOpaPolicy.ts",
    "sandboxprepare": "tsx Build/PrepareSandboxRuntime.ts --strict",
    "securitycheck": "npm audit --audit-level=high",
    "build": "npm run clean && tsc && tsx Build/CopyRuntimeAssets.ts",
    "dev": "concurrently -k -n server,frontend -c blue,green \"npm run serverwatch\" \"npm run frontend\"",
    "dockerup": "docker compose pull && docker compose up -d",
    "dockerdown": "docker compose down",
    "dockerlogs": "docker compose logs -f senera",
    "frontend": "npm --workspace senera-frontend run dev",
    "frontendcheck": "npm --workspace senera-frontend run check",
    "frontendtest": "npm --workspace senera-frontend run test",
    "frontendcoverage": "npm --workspace senera-frontend run coverage",
    "frontendverify": "npm --workspace senera-frontend run verify",
    "backendtest": vitestRunCommand(ProjectTestCoveragePolicies.backend.vitestConfig),
    "backendcoverage": vitestRunCommand(ProjectTestCoveragePolicies.backend.vitestConfig, "--coverage"),
    "e2etest": vitestRunCommand(E2eTestPolicy.vitestConfig),
    "coverage": "npm run frontendcoverage && npm run backendcoverage",
    "server": "npm run build && node Dist/Apps/Server.js",
    "serverwatch": "tsx Apps/ServerWatch.ts",
    "serverwatchdry": "tsx Apps/ServerWatch.ts --dry-run",
    "desktop": "npm run build && npm --workspace senera-frontend run build && electron Dist/Apps/Desktop/Main.js",
    "desktoppack": "tsx Apps/Desktop/PackageDesktop.ts",
    "desktoprestore": "npm rebuild better-sqlite3",
    "verifysuite": "node Dist/Scripts/VerifySuite.js",
    "verifysuites": "node Dist/Scripts/VerifySuite.js --list",
    "verifyworkspace": "npm run build && npm run verifysuite -- workspace",
    "verifycontracts": "npm run build && npm run verifysuite -- contracts",
    "verify": "npm run build && npm run verifysuite -- core",
    "verifyall": "npm run build && npm run verifysuite -- all-local",
    "ci": "npm run securitycheck && npm run bamlcheck && npm run check && npm run backendtest && npm run e2etest && npm run build && npm run verifysuite -- workspace core && npm run frontendverify && npm run frontendcoverage && npm run backendcoverage",
  };

  return [
    ...inspectScripts(rootPackage, "package.json", expectedScripts),
    ...inspectScriptSequence(rootPackage, "package.json", "ci", [
      "securitycheck",
      "bamlcheck",
      "check",
      "backendtest",
      "e2etest",
      "build",
      "frontendverify",
      "frontendcoverage",
      "backendcoverage",
    ]),
  ];
}

function inspectRootRuntimeDependencies(): string[] {
  return inspectDependencies(rootPackage, "package.json", {
    "@senera/tool-plugin-sdk": "file:Packages/ToolPluginSdk",
  });
}

function inspectModuleSystemBoundary(): string[] {
  return [
    ...inspectPackageType(rootPackage, "package.json", "module"),
    ...inspectRootPackageExports(),
    ...inspectWorkspacePackageTypes({
      "Frontend": "module",
      "Packages/ToolPluginSdk": "commonjs",
    }),
    ...inspectWorkspacePackageTypeByPrefix([
      "Plugins/",
      "System/Plugins/",
    ], "commonjs"),
  ];
}

function inspectRootPackageExports(): string[] {
  return Object.entries(rootPackage.exports ?? {})
    .filter(([, conditions]) => Boolean(conditions.require))
    .map(([exportPath]) => `package.json export ${exportPath} must not expose a CommonJS require condition.`);
}

function inspectWorkspacePackageTypes(expectedTypes: Record<string, string>): string[] {
  return Object.entries(expectedTypes).flatMap(([location, expectedType]) => {
    const packageJsonPath = path.join(workspaceRoot, location, "package.json");
    return fs.existsSync(packageJsonPath)
      ? inspectPackageType(readPackageJson(packageJsonPath), `${location}/package.json`, expectedType)
      : [];
  });
}

function inspectWorkspacePackageTypeByPrefix(prefixes: readonly string[], expectedType: string): string[] {
  return expectedWorkspaces
    .filter((workspace) => prefixes.some((prefix) => workspace.location.startsWith(prefix)))
    .flatMap((workspace) => inspectPackageType(
      readPackageJson(path.join(workspaceRoot, workspace.location, "package.json")),
      `${workspace.location}/package.json`,
      expectedType,
    ));
}

function inspectPackageType(packageJson: PackageJson, packagePath: string, expectedType: string): string[] {
  return packageJson.type === expectedType
    ? []
    : [`${packagePath} type must be: ${expectedType}`];
}

function inspectRetiredRootScripts(): string[] {
  return Object.keys(rootPackage.scripts ?? {})
    .filter((scriptName) => scriptName.includes(":"))
    .map((scriptName) => `package.json script ${scriptName} uses a retired colon-style command name.`);
}

function inspectApplicationEntrypoints(): string[] {
  const expectedFiles = [
    "Apps/Server.ts",
    "Apps/ServerRuntime.ts",
    "Apps/Desktop/Main.ts",
    "Apps/Desktop/DesktopRuntime.ts",
    "Apps/Desktop/PackageDesktop.ts",
    "Build/CopyRuntimeAssets.ts",
  ];
  const retiredFiles = [
    "Scripts/SeneraServer.ts",
    "Scripts/CopyRuntimeAssets.ts",
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

function inspectTestGovernanceEntrypoints(): string[] {
  const expectedFiles = [
    "Scripts/TestCoveragePolicy.ts",
    "Scripts/TestGovernance.ts",
    ...Object.values(ProjectTestCoveragePolicies).flatMap((policy) => [
      policy.verifyEntrypoint,
      policy.runnerEntrypoint,
      policy.vitestConfig,
    ].filter((file): file is string => Boolean(file))),
  ].filter(uniqueString);
  return expectedFiles
    .filter((file) => !fs.existsSync(path.join(workspaceRoot, file)))
    .map((file) => `${file} must exist as a test governance entrypoint.`);
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
    ...inspectDesktopAsarUnpack([
      "senera.config.example.json",
      "System/Plugins/**",
      "Plugins/**",
      "**/*.node",
      "**/*.dll",
      "**/*.so",
      "**/*.dylib",
      "**/ffi-rs/**",
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
    "arch:check": "node --import tsx ../Scripts/VerifyFrontendArchitecture.ts",
    "check": "tsc --noEmit",
    "test": `node --import tsx ../${ProjectTestCoveragePolicies.frontend.runnerEntrypoint}`,
    "coverage": vitestRunCommand(`../${ProjectTestCoveragePolicies.frontend.vitestConfig}`, "--coverage"),
    "verify": `npm run arch:check && npm run check && node --import tsx ../${ProjectTestCoveragePolicies.frontend.verifyEntrypoint} && npm run test`,
  });
}

function inspectRootNpmPolicy(): string[] {
  const violations: string[] = [];
  const npmrcPath = path.join(workspaceRoot, ".npmrc");
  if (!fs.existsSync(npmrcPath)) {
    violations.push("Root .npmrc must enable package-lock generation for reproducible npm ci installs.");
  } else {
    const settings = readNpmrcSettings(npmrcPath);
    if (settings.get("package-lock") !== "true") {
      violations.push(".npmrc must contain package-lock=true so npm ci uses the committed root lockfile.");
    }
  }

  if (!rootLockfile) {
    violations.push("Root package-lock.json must be committed for reproducible workspace installs.");
    return violations;
  }

  if (rootLockfile.name !== rootPackage.name) {
    violations.push(`package-lock.json name must match package.json name ${rootPackage.name}.`);
  }
  if (rootLockfile.lockfileVersion !== 3) {
    violations.push("package-lock.json must use npm lockfileVersion 3.");
  }

  const lockedWorkspacePatterns = readLockfileWorkspacePatterns(rootLockfile);
  if (!sameStringSet(lockedWorkspacePatterns, workspacePatterns)) {
    violations.push("package-lock.json root workspaces must match package.json workspaces.");
  }

  return violations;
}

function inspectVerifyWorkflow(): string[] {
  const expectedScripts = [
    "backendtest",
    "backendcoverage",
    "e2etest",
    "frontendverify",
    "frontendcoverage",
  ].map((script) => `npm run ${script}`);
  const coverageArtifactNames = Object.values(ProjectTestCoveragePolicies)
    .map((policy) => policy.coverageDirectory.split("/").at(-1))
    .filter((name): name is string => Boolean(name))
    .map((name) => `${name}-coverage`);

  return [
    ...inspectTextIncludes(verifyWorkflow, ".github/workflows/verify.yml", [
      "npm ci",
      ...expectedScripts,
      ...coverageArtifactNames,
    ]),
  ];
}

function inspectSecurityScanWorkflow(): string[] {
  return inspectTextIncludes(securityScanWorkflow, ".github/workflows/security-scan.yml", [
    "name: Security Scan",
    "github/codeql-action/init@v3",
    "queries: security-extended,security-and-quality",
    "actions/dependency-review-action@v4",
    "aquasecurity/trivy-action@0.35.0",
    "exit-code: \"1\"",
    "github/codeql-action/upload-sarif@v3",
  ]);
}

function inspectReleaseWorkflowGates(): string[] {
  return [
    ...inspectTextIncludes(containerReleaseWorkflow, ".github/workflows/container-release.yml", [
      "- Security Scan",
      "github.event.workflow_run.name == 'Security Scan'",
      "Require Verify success",
      "gh run list --workflow \"Verify\"",
    ]),
    ...inspectTextIncludes(desktopReleaseWorkflow, ".github/workflows/desktop-release.yml", [
      "- Security Scan",
      "github.event.workflow_run.name == 'Security Scan'",
      "Require Verify success",
      "gh run list --workflow \"Verify\"",
    ]),
  ];
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
      "Keep dependency resolution in the root package-lock.json; do not commit workspace-local package-lock.json files.",
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

function inspectScriptSequence(
  packageJson: PackageJson,
  packagePath: string,
  scriptName: string,
  expectedSteps: readonly string[],
): string[] {
  const script = packageJson.scripts?.[scriptName];
  if (!script) {
    return [`${packagePath} script ${scriptName} must exist.`];
  }

  const commands = script
    .split("&&")
    .map((command) => command.trim())
    .filter(Boolean);
  const missingSteps = expectedSteps
    .map((step) => `npm run ${step}`)
    .filter((command) => !commands.includes(command));

  return missingSteps.length === 0
    ? []
    : [`${packagePath} script ${scriptName} must include steps: ${missingSteps.join(", ")}.`];
}

function vitestRunCommand(configPath: string, ...args: readonly string[]): string {
  return [
    "vitest",
    "run",
    "--config",
    configPath,
    ...args,
  ].join(" ");
}

function uniqueString(value: string, index: number, values: readonly string[]): boolean {
  return values.indexOf(value) === index;
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

function readTextFile(file: string): string {
  return fs.readFileSync(file, "utf8");
}

function readPackageLockJson(file: string): PackageLockJson {
  return JSON.parse(fs.readFileSync(file, "utf8")) as PackageLockJson;
}

function readNpmrcSettings(file: string): Map<string, string> {
  return new Map(
    fs.readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separatorIndex = line.indexOf("=");
        return separatorIndex === -1
          ? [line, ""]
          : [line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim()];
      }),
  );
}

function readLockfileWorkspacePatterns(lockfile: PackageLockJson): string[] {
  const workspaces = lockfile.packages?.[""]?.workspaces;
  return Array.isArray(workspaces)
    ? workspaces.flatMap((workspace) => typeof workspace === "string" ? [workspace] : [])
    : [];
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightValues = new Set(right);
  return left.every((value) => rightValues.has(value));
}

function inspectTextIncludes(source: string, label: string, expectedTerms: readonly string[]): string[] {
  return expectedTerms
    .filter((term) => !source.includes(term))
    .map((term) => `${label} must include ${term}.`);
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
