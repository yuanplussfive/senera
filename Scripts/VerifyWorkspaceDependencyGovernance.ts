import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import { E2eTestPolicy, ProjectTestCoveragePolicies } from "./TestCoveragePolicy.js";

interface PackageJson {
  name?: string;
  type?: string;
  workspaces?:
    | string[]
    | {
        packages?: string[];
      };
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  exports?: Record<string, PackageExportConditions>;
  build?: ElectronBuilderConfig;
}

interface PackageLockJson {
  name?: string;
  lockfileVersion?: number;
  packages?: Record<
    string,
    {
      name?: string;
      version?: string;
      resolved?: string;
      link?: boolean;
      workspaces?: unknown;
      optionalDependencies?: Record<string, string>;
    }
  >;
}

interface PackageExportConditions {
  types?: string;
  import?: string;
  require?: string;
  default?: string;
}

interface ElectronBuilderConfig {
  files?: Array<string | ElectronBuilderFileSet>;
  extraResources?: ElectronBuilderFileSet[];
  asarUnpack?: string[];
  npmRebuild?: boolean;
  afterPack?: string;
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
const rootLockfile = fs.existsSync(rootLockfilePath) ? readPackageLockJson(rootLockfilePath) : undefined;
const workspacePatterns = readWorkspacePatterns(rootPackage);
const expectedWorkspaces = discoverWorkspacePackages(workspacePatterns);
const rootOwnedToolchainDependencies = new Map(
  Object.entries({
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@testing-library/user-event": "^14.6.1",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.7.0",
    "@vitest/coverage-v8": "^4.1.10",
    autoprefixer: "^10.4.20",
    jsdom: "^29.1.1",
    postcss: "^8.4.49",
    prettier: "^3.9.5",
    tailwindcss: "^3.4.17",
    "ts-json-schema-generator": "^2.9.0",
    typescript: "^6.0.3",
    tsx: "^4.22.4",
    vite: "^7.3.6",
    vitest: "^4.1.10",
  }),
);
const verifyWorkflow = readTextFile(path.join(workspaceRoot, ".github", "workflows", "verify.yml"));
const securityScanWorkflow = readTextFile(path.join(workspaceRoot, ".github", "workflows", "security-scan.yml"));
const productReleaseWorkflow = readTextFile(path.join(workspaceRoot, ".github", "workflows", "release.yml"));
const violations = [
  ...inspectWorkspaceCoverage(),
  ...inspectLockfileWorkspaceState(),
  ...inspectNativeOptionalDependencyClosure(),
  ...inspectRootNpmPolicy(),
  ...inspectVerifyWorkflow(),
  ...inspectSecurityScanWorkflow(),
  ...inspectReleaseWorkflowGates(),
  ...inspectRootScripts(),
  ...inspectModuleSystemBoundary(),
  ...inspectRootRuntimeDependencies(),
  ...inspectRootToolchainDependencies(),
  ...inspectWorkspaceToolchainDependencyBoundaries(),
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
  ["Workspace dependency governance failed.", ...violations.map((violation) => `- ${violation}`)].join("\n"),
);

console.log(`Workspace dependency governance verified (${expectedWorkspaces.length} workspaces).`);

function inspectWorkspaceCoverage(): string[] {
  const locations = new Set(expectedWorkspaces.map((workspace) => workspace.location));
  return locations.has("Frontend") ? [] : ["Frontend/package.json is not covered by the root package.json workspaces."];
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

function inspectNativeOptionalDependencyClosure(): string[] {
  const packages = rootLockfile?.packages;
  if (!packages) return [];

  const declaredBindings = rootPackage.optionalDependencies ?? {};
  const declaredBindingNames = new Set(Object.keys(declaredBindings));
  const nativeEntrypoints = Object.keys(rootPackage.dependencies ?? {})
    .map((dependencyName) => ({
      dependencyName,
      bindings: packages[`node_modules/${dependencyName}`]?.optionalDependencies ?? {},
    }))
    .filter(({ bindings }) => Object.keys(bindings).some((packageName) => declaredBindingNames.has(packageName)));

  return nativeEntrypoints.flatMap(({ dependencyName, bindings }) => {
    const bindingEntries = Object.entries(bindings);
    const issues: string[] = [];
    if (bindingEntries.length === 0) {
      issues.push(`package-lock.json must retain ${dependencyName} native optional binding metadata.`);
    }

    for (const [packageName, version] of bindingEntries) {
      if (!(packageName in declaredBindings)) {
        issues.push(`package.json optionalDependencies must declare ${dependencyName} native binding ${packageName}.`);
      }
      if (packages[`node_modules/${packageName}`]?.version !== version) {
        issues.push(`package-lock.json must resolve ${dependencyName} native binding ${packageName}@${version}.`);
      }
    }

    return issues;
  });
}

function inspectRootScripts(): string[] {
  const expectedScripts = {
    clean: "rimraf Dist",
    "quality.baml": "baml check --from baml_src",
    "quality.baml.generate": "baml generate --from baml_src",
    "quality.security": "npm audit --audit-level=high",
    "quality.format": "tsx Scripts/VerifyChangedFormatting.ts",
    "quality.format.fix": "tsx Scripts/VerifyChangedFormatting.ts --write",
    "quality.format.full": 'prettier "**/*" --check --ignore-unknown',
    "quality.format.full.fix": 'prettier "**/*" --write --ignore-unknown',
    "quality.coverage": "npm run test.coverage.frontend && npm run test.coverage.backend",
    "policy.compile": "tsx Build/CompileOpaPolicy.ts",
    "policy.verify": "tsx Build/CompileOpaPolicy.ts --check",
    "generate.frontend-events": "tsx Build/GenerateFrontendEventCatalog.ts",
    "generate.tool-contracts": "tsx Build/GenerateToolContractBundles.ts",
    "verify.tool-contracts": "tsx Build/GenerateToolContractBundles.ts --check",
    "terminal.prepare": "tsx Build/PrepareTerminalSidecarGuestRuntime.ts",
    "sandbox.prepare": "tsx Build/PrepareSandboxRuntime.ts --strict",
    "check.types": "tsc --noEmit",
    build: "npm run verify.tool-contracts && npm run clean && tsc && tsx Build/CopyRuntimeAssets.ts",
    dev: 'concurrently -k -n server,frontend -c blue,green "npm run dev.server" "npm run dev.frontend"',
    "docker.up": "docker compose pull && docker compose up -d",
    "docker.down": "docker compose down",
    "docker.logs": "docker compose logs -f senera",
    "dev.frontend": "npm --workspace senera-frontend run dev",
    "check.frontend-types": "npm --workspace senera-frontend run check.types",
    "test.frontend": "npm --workspace senera-frontend run test",
    "test.coverage.frontend": "npm --workspace senera-frontend run test.coverage",
    "test.backend": vitestRunCommand(ProjectTestCoveragePolicies.backend.vitestConfig),
    "test.coverage.backend": vitestRunCommand(ProjectTestCoveragePolicies.backend.vitestConfig, "--coverage"),
    "test.e2e": vitestRunCommand(E2eTestPolicy.vitestConfig),
    "test.all": "npm test && npm run test.e2e",
    server: "npm run build && node Dist/Apps/Server.js",
    "dev.server": "tsx Apps/ServerWatch.ts",
    "dev.server.dry-run": "tsx Apps/ServerWatch.ts --dry-run",
    desktop: "npm run build && npm --workspace senera-frontend run build && electron Dist/Apps/Desktop/Main.js",
    "desktop.prepare-native": "tsx Build/PrepareElectronNativeModules.ts",
    "desktop.pack": "tsx Apps/Desktop/PackageDesktop.ts",
    "verify.suite": "node Dist/Scripts/VerifySuite.js",
    "verify.suites": "node Dist/Scripts/VerifySuite.js --list",
    "verify.workspace": "npm run build && npm run verify.suite -- workspace",
    "verify.contracts": "npm run build && npm run verify.suite -- contracts",
    "verify.core": "npm run build && npm run verify.suite -- core",
    "verify.platform": "npm run build && npm run verify.suite -- platform",
    "verify.release": "npm run build && npm run verify.suite -- release",
    "verify.all": "npm run build && npm run verify.suite -- all-local",
  };

  return [
    ...inspectScripts(rootPackage, "package.json", expectedScripts),
    ...inspectScriptSequence(rootPackage, "package.json", "ci", [
      "quality.security",
      "quality.baml",
      "policy.verify",
      "check.types",
      "test.backend",
      "test.frontend",
      "test.e2e",
      "build",
      "quality.coverage",
    ]),
  ];
}

function inspectRootRuntimeDependencies(): string[] {
  return inspectDependencies(
    rootPackage,
    "package.json",
    {
      "@senera/tool-plugin-sdk": "file:Packages/ToolPluginSdk",
    },
    "dependencies",
  );
}

function inspectRootToolchainDependencies(): string[] {
  return inspectDependencies(
    rootPackage,
    "package.json",
    Object.fromEntries(rootOwnedToolchainDependencies),
    "devDependencies",
  );
}

function inspectWorkspaceToolchainDependencyBoundaries(): string[] {
  const toolchainNames = new Set(rootOwnedToolchainDependencies.keys());
  return expectedWorkspaces.flatMap((workspace) => {
    const packagePath = path.join(workspaceRoot, workspace.location, "package.json");
    const packageJson = readPackageJson(packagePath);
    return [...Object.keys(packageJson.dependencies ?? {}), ...Object.keys(packageJson.devDependencies ?? {})]
      .filter((dependencyName) => toolchainNames.has(dependencyName))
      .map(
        (dependencyName) =>
          `${workspace.location}/package.json must not declare root-owned toolchain dependency ${dependencyName}.`,
      );
  });
}

function inspectModuleSystemBoundary(): string[] {
  return [
    ...inspectPackageType(rootPackage, "package.json", "module"),
    ...inspectRootPackageExports(),
    ...inspectWorkspacePackageTypes({
      Frontend: "module",
      "Packages/ToolPluginSdk": "commonjs",
    }),
    ...inspectWorkspacePackageTypeByPrefix(["Plugins/", "System/Plugins/"], "commonjs"),
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
    .flatMap((workspace) =>
      inspectPackageType(
        readPackageJson(path.join(workspaceRoot, workspace.location, "package.json")),
        `${workspace.location}/package.json`,
        expectedType,
      ),
    );
}

function inspectPackageType(packageJson: PackageJson, packagePath: string, expectedType: string): string[] {
  return packageJson.type === expectedType ? [] : [`${packagePath} type must be: ${expectedType}`];
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
    "Apps/Desktop/DesktopFrontendSource.ts",
    "Apps/Desktop/RunDesktopLive.ts",
    "Apps/Desktop/PackageDesktop.ts",
    "Build/CopyRuntimeAssets.ts",
  ];
  const retiredFiles = ["Scripts/SeneraServer.ts", "Scripts/CopyRuntimeAssets.ts"];

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
    ...Object.values(ProjectTestCoveragePolicies).flatMap((policy) =>
      [policy.verifyEntrypoint, policy.runnerEntrypoint, policy.vitestConfig].filter((file): file is string =>
        Boolean(file),
      ),
    ),
  ].filter(uniqueString);
  return expectedFiles
    .filter((file) => !fs.existsSync(path.join(workspaceRoot, file)))
    .map((file) => `${file} must exist as a test governance entrypoint.`);
}

function inspectDesktopPackageConfig(): string[] {
  return [
    ...(rootPackage.build?.extraMetadata?.main === "Dist/Apps/Desktop/Main.js"
      ? []
      : ["package.json build.extraMetadata.main must point to Dist/Apps/Desktop/Main.js."]),
    ...inspectDesktopPackageScript(),
    ...inspectDesktopFileSet("Packages/ToolPluginSdk", "node_modules/@senera/tool-plugin-sdk"),
    ...inspectDesktopFileSet("Packages/TerminalSidecar", "node_modules/@senera/terminal-sidecar"),
    ...inspectDesktopExtraResource(".senera/sandbox-runtime/terminal-sidecar", "TerminalSidecarRuntime"),
    ...(rootPackage.build?.npmRebuild === false
      ? []
      : ["package.json build.npmRebuild must be false so Sidecar Node binaries are not rebuilt for Electron."]),
    ...(rootPackage.build?.afterPack === "Build/ElectronAfterPack.cjs"
      ? []
      : ["package.json build.afterPack must inject isolated Electron native module builds."]),
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
  return inspectTextIncludes(source, "Apps/Desktop/PackageDesktop.ts", [
    'command("npm", ["run", "terminal.prepare"])',
    'command("npm", ["run", "desktop.prepare-native"])',
    'command("electron-builder")',
  ]);
}

function inspectDesktopFileSet(from: string, to: string): string[] {
  const fileSets = rootPackage.build?.files?.filter(isElectronBuilderFileSet) ?? [];
  return fileSets.some((fileSet) => fileSet.from === from && fileSet.to === to)
    ? []
    : [`package.json build.files must package ${from} to ${to}.`];
}

function inspectDesktopExtraResource(from: string, to: string): string[] {
  const resources = rootPackage.build?.extraResources ?? [];
  return resources.some((resource) => resource.from === from && resource.to === to)
    ? []
    : [`package.json build.extraResources must package ${from} to ${to}.`];
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
    "check.types": "tsc --noEmit",
    "check.governance": `node --import tsx ../${ProjectTestCoveragePolicies.frontend.verifyEntrypoint}`,
    "check.ladle": "node --import tsx ../Scripts/VerifyFrontendLadleContracts.ts",
    "test.behavior": `node --import tsx ../${ProjectTestCoveragePolicies.frontend.runnerEntrypoint}`,
    "test.coverage": vitestRunCommand(`../${ProjectTestCoveragePolicies.frontend.vitestConfig}`, "--coverage"),
    test: "npm run check.types && npm run check.governance && npm run check.ladle && npm run test.behavior",
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
  return [
    ...inspectTextIncludes(verifyWorkflow, ".github/workflows/verify.yml", [
      "name: Fast Gate",
      "name: Windows Platform Smoke",
      "name: Coverage Gate",
      "./.github/actions/setup-node",
      "fetch-depth: 0",
      "types:\n      - opened\n      - synchronize\n      - reopened\n      - edited",
      "id: range",
      'from="$(git merge-base "$PR_BASE_SHA" "$PR_HEAD_SHA")"',
      "GITHUB_PR_TITLE: ${{ github.event.pull_request.title }}",
      "node --import tsx Scripts/VerifyPullRequestTitle.ts",
      "npm run quality.format -- ${{ steps.range.outputs.arguments }}",
      "npm run test.backend",
      "npm run test.frontend",
      "npm run test.e2e",
      "npm run verify.suite -- workspace core e2e release",
      "npm run verify.suite -- platform",
      "github.ref == 'refs/heads/main' || github.event_name == 'workflow_dispatch'",
      "npm run test.coverage.frontend",
      "npm run test.coverage.backend",
      "inputs.full_suite",
    ]),
    ...inspectPullRequestJobGate(verifyWorkflow, ".github/workflows/verify.yml", "coverage"),
  ];
}

function inspectSecurityScanWorkflow(): string[] {
  const label = ".github/workflows/security-scan.yml";
  const violations = inspectTextIncludes(securityScanWorkflow, label, [
    "name: Security Scan",
    "pull_request:",
    "github/codeql-action/init@v3",
    "queries: security-extended,security-and-quality",
    "actions/dependency-review-action@v4",
    "aquasecurity/trivy-action@0.35.0",
    'exit-code: "1"',
    "github/codeql-action/upload-sarif@v3",
    "npm run quality.security",
  ]);
  for (const jobName of ["dependency-audit", "codeql", "trivy-filesystem"]) {
    const block = workflowJobBlock(securityScanWorkflow, jobName);
    if (!block) {
      violations.push(`${label} must define ${jobName}.`);
    } else if (block.includes("\n    if: github.event_name != 'pull_request'")) {
      violations.push(`${label} job ${jobName} must run for pull requests.`);
    }
  }
  return violations;
}

function inspectPullRequestJobGate(workflow: string, file: string, jobName: string): string[] {
  const block = workflowJobBlock(workflow, jobName);
  if (!block) return [`${file} must define the ${jobName} job.`];
  return block.includes("if: github.event_name != 'pull_request'")
    ? [`${file} ${jobName} must run for pull_request events.`]
    : [];
}

function inspectReleaseWorkflowGates(): string[] {
  return inspectTextIncludes(productReleaseWorkflow, ".github/workflows/release.yml", [
    "workflow_run:",
    "workflow_dispatch:",
    "release_tag:",
    "googleapis/release-please-action@v4",
    "needs.release-please.outputs.release_created == 'true'",
    "Build/ProductReleaseInfo.ts",
    "Require release source to match triggering verification",
    "VERIFIED_SHA: ${{ github.event.workflow_run.head_sha }}",
    'test "$RELEASE_SHA" = "$VERIFIED_SHA"',
    "Require successful verification",
    "if: github.event_name == 'workflow_dispatch'",
    "gh run list --workflow verify.yml",
    "npm run desktop.pack",
    "gh release upload",
    "type=raw,value=${{ needs.metadata.outputs.container_version_tag }}",
    "type=raw,value=${{ needs.metadata.outputs.container_minor_tag }}",
    "type=raw,value=sha-${{ needs.metadata.outputs.source_sha }}",
    "type=raw,value=latest",
    "cache-from: type=gha",
    "cache-to: type=gha,mode=max",
    "container-smoke:",
    "load: true",
    'docker exec "$CONTAINER_NAME" node Dist/Scripts/VerifyDockerNativeSqlite.js',
    "- container-smoke",
    "Publish Verified Release",
    "--draft=false --latest",
  ]);
}

function inspectWorkspaceNpmrcFiles(): string[] {
  return expectedWorkspaces
    .map((workspace) => path.join(workspaceRoot, workspace.location, ".npmrc"))
    .filter((file) => fs.existsSync(file))
    .map((file) =>
      [
        `${relativePath(file)} is ignored by npm workspace execution.`,
        "Move shared npm install policy to the repository root or remove it.",
      ].join(" "),
    );
}

function inspectWorkspaceLockFiles(): string[] {
  return expectedWorkspaces
    .map((workspace) => path.join(workspaceRoot, workspace.location, "package-lock.json"))
    .filter((file) => fs.existsSync(file))
    .map((file) =>
      [
        `${relativePath(file)} creates a second npm install boundary.`,
        "Keep dependency resolution in the root package-lock.json; do not commit workspace-local package-lock.json files.",
      ].join(" "),
    );
}

function inspectDependencies(
  packageJson: PackageJson,
  packagePath: string,
  expectedDependencies: Record<string, string>,
  dependencyField: "dependencies" | "devDependencies" = "dependencies",
): string[] {
  return Object.entries(expectedDependencies)
    .filter(([name, version]) => packageJson[dependencyField]?.[name] !== version)
    .map(([name, version]) => `${packagePath} ${dependencyField} ${name} must be: ${version}`);
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
  const missingSteps = expectedSteps.map((step) => `npm run ${step}`).filter((command) => !commands.includes(command));

  return missingSteps.length === 0
    ? []
    : [`${packagePath} script ${scriptName} must include steps: ${missingSteps.join(", ")}.`];
}

function vitestRunCommand(configPath: string, ...args: readonly string[]): string {
  return ["vitest", "run", "--config", configPath, ...args].join(" ");
}

function uniqueString(value: string, index: number, values: readonly string[]): boolean {
  return values.indexOf(value) === index;
}

function discoverWorkspacePackages(patterns: readonly string[]): WorkspacePackage[] {
  const packageFiles = fg
    .sync(patterns.map(toPackageJsonPattern), {
      cwd: workspaceRoot,
      absolute: true,
      onlyFiles: true,
      unique: true,
      ignore: ["**/node_modules/**"],
    })
    .sort((left, right) => relativePath(left).localeCompare(relativePath(right)));

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
    fs
      .readFileSync(file, "utf8")
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
    ? workspaces.flatMap((workspace) => (typeof workspace === "string" ? [workspace] : []))
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
  return expectedTerms.filter((term) => !source.includes(term)).map((term) => `${label} must include ${term}.`);
}

function workflowJobBlock(source: string, jobName: string): string | undefined {
  const marker = `\n  ${jobName}:\n`;
  const start = source.indexOf(marker);
  if (start < 0) return undefined;
  const nextJob = /^ {2}[a-z0-9-]+:\s*$/gm;
  nextJob.lastIndex = start + marker.length;
  const next = nextJob.exec(source);
  return source.slice(start, next?.index ?? source.length);
}

function toPackageJsonPattern(pattern: string): string {
  return pattern.endsWith("package.json") ? pattern : path.posix.join(normalizeRelativePath(pattern), "package.json");
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join("/");
}

function relativePath(value: string): string {
  return path.relative(workspaceRoot, value).split(path.sep).join("/");
}
