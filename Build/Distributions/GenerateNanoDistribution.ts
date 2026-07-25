import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyAgentSandboxBundle } from "../../Source/AgentSystem/Sandbox/AgentSandboxArchiveInstaller.js";
import {
  AgentSandboxDistributionContractSchema,
  resolveAgentSandboxBundleLocation,
} from "../../Source/AgentSystem/Sandbox/AgentSandboxDistributionContract.js";

interface DependencyProjection {
  readonly mode: "all" | "include" | "exclude";
  readonly names?: readonly string[];
}

interface PackageProjection {
  readonly copyFields: readonly string[];
  readonly setFields: Readonly<Record<string, unknown>>;
  readonly scripts: readonly string[];
  readonly dependencies: DependencyProjection;
  readonly devDependencies: DependencyProjection;
  readonly optionalDependencies: DependencyProjection;
}

interface FileProjection {
  readonly source: string;
  readonly target: string;
}

interface SandboxBundleProjection {
  readonly distributionContract: string;
  readonly sourceRoot: string;
  readonly targetRoot: string;
  readonly target: string;
}

interface SandboxBundleMetadata {
  readonly distributionId: string;
  readonly archiveVersion: string;
  readonly microsandboxVersion: string;
  readonly target: string;
  readonly runtimeImage: string;
  readonly configDigest: string;
  readonly asset: {
    readonly fileName: string;
    readonly sizeBytes: number;
    readonly sha256: string;
  };
}

interface NanoDistributionContract {
  readonly schemaVersion: number;
  readonly id: string;
  readonly source: {
    readonly branch: string;
    readonly outputBranch: string;
    readonly repositoryUrl: string;
  };
  readonly files: {
    readonly gitPathspecs: readonly string[];
    readonly projections: readonly FileProjection[];
  };
  readonly runtime: {
    readonly sandbox: {
      readonly provider: "microsandbox";
      readonly bundle: SandboxBundleProjection;
    };
  };
  readonly rootPackage: PackageProjection;
  readonly workspacePackages: Readonly<Record<string, { readonly scripts: readonly string[] }>>;
  readonly typescript: {
    readonly include: readonly string[];
  };
  readonly generatedFiles: {
    readonly readmeTemplate: string;
    readonly metadataFile: string;
  };
}

interface PackageJson extends Record<string, unknown> {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface Invocation {
  readonly output: string;
  readonly contractPath: string;
  readonly sourceSha?: string;
  readonly repositoryUrl?: string;
  readonly sandboxBundleRoot?: string;
}

const GeneratorDirectory = path.dirname(fileURLToPath(import.meta.url));
const DefaultContractPath = path.join(GeneratorDirectory, "NanoDistribution.json");

await main();

async function main(): Promise<void> {
  const invocation = parseInvocation(process.argv.slice(2));
  const sourceRoot = runGit(process.cwd(), ["rev-parse", "--show-toplevel"]);
  const headSha = runGit(sourceRoot, ["rev-parse", "HEAD"]);
  const sourceSha = invocation.sourceSha ?? headSha;
  assertCommitSha(sourceSha);
  if (sourceSha !== headSha) {
    throw new Error(`Nano source SHA must match the checked-out commit: ${sourceSha} !== ${headSha}`);
  }

  const contract = readContract(path.resolve(sourceRoot, invocation.contractPath));
  const repositoryUrl = normalizeRepositoryUrl(invocation.repositoryUrl ?? contract.source.repositoryUrl);
  const outputRoot = prepareOutputRoot(sourceRoot, invocation.output);

  copySelectedFiles(sourceRoot, outputRoot, contract.files.gitPathspecs);
  projectFiles(sourceRoot, outputRoot, contract.files.projections);
  projectRootPackage(sourceRoot, outputRoot, contract.rootPackage);
  projectWorkspacePackages(outputRoot, contract.workspacePackages);
  projectTypescriptConfig(sourceRoot, outputRoot, contract.typescript.include);
  const sandboxBundle = await projectSandboxBundle(
    sourceRoot,
    outputRoot,
    contract.runtime.sandbox.bundle,
    invocation.sandboxBundleRoot,
  );
  writeGeneratedFiles(sourceRoot, outputRoot, contract, sourceSha, repositoryUrl, sandboxBundle);

  process.stdout.write(`Generated ${contract.id} distribution at ${outputRoot}\n`);
  process.stdout.write(`Source: ${contract.source.branch}@${sourceSha}\n`);
}

function parseInvocation(args: readonly string[]): Invocation {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(
        "Usage: GenerateNanoDistribution.ts --output <directory> [--contract <file>] [--source-sha <sha>] [--repository-url <url>] [--sandbox-bundle-root <directory>]",
      );
    }
    if (values.has(name)) throw new Error(`Duplicate argument: ${name}`);
    values.set(name, value);
  }

  const supported = new Set(["--output", "--contract", "--source-sha", "--repository-url", "--sandbox-bundle-root"]);
  for (const name of values.keys()) {
    if (!supported.has(name)) throw new Error(`Unknown argument: ${name}`);
  }

  const output = values.get("--output")?.trim();
  if (!output) throw new Error("--output must be a non-empty directory path.");
  return {
    output,
    contractPath: values.get("--contract")?.trim() || DefaultContractPath,
    sourceSha: values.get("--source-sha")?.trim(),
    repositoryUrl: values.get("--repository-url")?.trim(),
    sandboxBundleRoot: values.get("--sandbox-bundle-root")?.trim(),
  };
}

function readContract(contractPath: string): NanoDistributionContract {
  const value = readJsonFile(contractPath);
  if (!isRecord(value)) throw new Error(`Nano distribution contract must be an object: ${contractPath}`);
  if (value.schemaVersion !== 3 || value.id !== "nano") {
    throw new Error(`Unsupported Nano distribution contract version or id: ${contractPath}`);
  }
  if (!isRecord(value.source) || !isRecord(value.files) || !isRecord(value.runtime) || !isRecord(value.rootPackage)) {
    throw new Error(`Nano distribution contract is missing required projections: ${contractPath}`);
  }
  if (!isRecord(value.workspacePackages) || !isRecord(value.typescript) || !isRecord(value.generatedFiles)) {
    throw new Error(`Nano distribution contract is missing generated output declarations: ${contractPath}`);
  }
  assertString(value.source.branch, "source.branch");
  assertString(value.source.outputBranch, "source.outputBranch");
  assertString(value.source.repositoryUrl, "source.repositoryUrl");
  assertStringArray(value.files.gitPathspecs, "files.gitPathspecs");
  assertFileProjections(value.files.projections);
  assertSandboxRuntime(value.runtime);
  assertPackageProjection(value.rootPackage, "rootPackage");
  assertStringArray(value.typescript.include, "typescript.include");
  assertString(value.generatedFiles.readmeTemplate, "generatedFiles.readmeTemplate");
  assertString(value.generatedFiles.metadataFile, "generatedFiles.metadataFile");
  for (const [packagePath, projection] of Object.entries(value.workspacePackages)) {
    if (!isRecord(projection)) throw new Error(`workspacePackages.${packagePath} must be an object.`);
    assertStringArray(projection.scripts, `workspacePackages.${packagePath}.scripts`);
  }
  return value as unknown as NanoDistributionContract;
}

function assertSandboxRuntime(value: Record<string, unknown>): void {
  if (!isRecord(value.sandbox) || value.sandbox.provider !== "microsandbox" || !isRecord(value.sandbox.bundle)) {
    throw new Error("runtime.sandbox must declare a microsandbox Bundle projection.");
  }
  for (const field of ["distributionContract", "sourceRoot", "targetRoot", "target"] as const) {
    assertString(value.sandbox.bundle[field], `runtime.sandbox.bundle.${field}`);
  }
}

function assertFileProjections(value: unknown): void {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("files.projections must be a non-empty array.");
  }
  const targets = new Set<string>();
  for (const [index, projection] of value.entries()) {
    if (!isRecord(projection)) throw new Error(`files.projections.${index} must be an object.`);
    assertString(projection.source, `files.projections.${index}.source`);
    assertString(projection.target, `files.projections.${index}.target`);
    if (targets.has(projection.target)) {
      throw new Error(`files.projections declares duplicate target: ${projection.target}`);
    }
    targets.add(projection.target);
  }
}

function assertPackageProjection(value: Record<string, unknown>, label: string): void {
  assertStringArray(value.copyFields, `${label}.copyFields`);
  if (!isRecord(value.setFields)) throw new Error(`${label}.setFields must be an object.`);
  assertStringArray(value.scripts, `${label}.scripts`);
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"] as const) {
    const projection = value[field];
    if (!isRecord(projection) || !["all", "include", "exclude"].includes(String(projection.mode))) {
      throw new Error(`${label}.${field} must define a supported projection mode.`);
    }
    if (projection.mode !== "all") assertStringArray(projection.names, `${label}.${field}.names`);
  }
}

function prepareOutputRoot(sourceRoot: string, requestedOutput: string): string {
  const outputRoot = path.resolve(requestedOutput);
  const relativeToSource = path.relative(sourceRoot, outputRoot);
  if (!relativeToSource || (!relativeToSource.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeToSource))) {
    throw new Error("Nano output must be outside the source repository.");
  }
  if (existsSync(outputRoot) && readdirSync(outputRoot).length > 0) {
    throw new Error(`Nano output directory must be empty: ${outputRoot}`);
  }
  mkdirSync(outputRoot, { recursive: true });
  return realpathSync(outputRoot);
}

function copySelectedFiles(sourceRoot: string, outputRoot: string, pathspecs: readonly string[]): void {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...pathspecs],
    { cwd: sourceRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const files = output
    .split("\0")
    .filter(Boolean)
    // `git ls-files --cached` retains paths deleted in the working tree. Nano
    // projects the actual source tree, so those paths must not be copied.
    .filter((relativePath) => existsSync(resolveContainedPath(sourceRoot, relativePath)))
    .sort((left, right) => left.localeCompare(right));
  if (files.length === 0) throw new Error("Nano file projection selected no files.");

  for (const relativePath of files) {
    const sourcePath = resolveContainedPath(sourceRoot, relativePath);
    const destinationPath = resolveContainedPath(outputRoot, relativePath);
    const stats = lstatSync(sourcePath);
    if (!stats.isFile()) throw new Error(`Nano distributions only support regular files: ${relativePath}`);
    mkdirSync(path.dirname(destinationPath), { recursive: true });
    copyFileSync(sourcePath, destinationPath);
    chmodSync(destinationPath, stats.mode & 0o777);
  }
}

function projectFiles(sourceRoot: string, outputRoot: string, projections: readonly FileProjection[]): void {
  for (const projection of projections) {
    const sourcePath = resolveContainedPath(sourceRoot, projection.source);
    const targetPath = resolveContainedPath(outputRoot, projection.target);
    if (existsSync(targetPath)) throw new Error(`Nano projected file target already exists: ${projection.target}`);
    const stats = lstatSync(sourcePath);
    if (!stats.isFile()) throw new Error(`Nano projected source must be a regular file: ${projection.source}`);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    copyFileSync(sourcePath, targetPath);
    chmodSync(targetPath, stats.mode & 0o777);
  }
}

function projectRootPackage(sourceRoot: string, outputRoot: string, projection: PackageProjection): void {
  const sourcePackage = readPackageJson(path.join(sourceRoot, "package.json"));
  const outputPackage: Record<string, unknown> = {};
  for (const field of projection.copyFields) {
    if (!(field in sourcePackage)) throw new Error(`Root package field declared for Nano is missing: ${field}`);
    outputPackage[field] = sourcePackage[field];
  }
  Object.assign(outputPackage, projection.setFields);
  outputPackage.scripts = selectNamedEntries(sourcePackage.scripts, projection.scripts, "root package scripts");
  outputPackage.dependencies = projectDependencies(
    sourcePackage.dependencies,
    projection.dependencies,
    "root package dependencies",
  );
  outputPackage.devDependencies = projectDependencies(
    sourcePackage.devDependencies,
    projection.devDependencies,
    "root package devDependencies",
  );
  outputPackage.optionalDependencies = projectDependencies(
    sourcePackage.optionalDependencies,
    projection.optionalDependencies,
    "root package optionalDependencies",
  );
  writeJsonFile(path.join(outputRoot, "package.json"), outputPackage);
}

function projectWorkspacePackages(
  outputRoot: string,
  projections: NanoDistributionContract["workspacePackages"],
): void {
  for (const [relativePath, projection] of Object.entries(projections)) {
    const packagePath = resolveContainedPath(outputRoot, relativePath);
    const packageJson = readPackageJson(packagePath);
    packageJson.scripts = selectNamedEntries(packageJson.scripts, projection.scripts, `${relativePath} scripts`);
    writeJsonFile(packagePath, packageJson);
  }
}

function projectTypescriptConfig(sourceRoot: string, outputRoot: string, include: readonly string[]): void {
  const sourceConfig = readJsonFile(path.join(sourceRoot, "tsconfig.json"));
  if (!isRecord(sourceConfig) || !isRecord(sourceConfig.compilerOptions)) {
    throw new Error("Root tsconfig.json must define compilerOptions.");
  }
  writeJsonFile(path.join(outputRoot, "tsconfig.json"), {
    compilerOptions: sourceConfig.compilerOptions,
    include,
  });
}

async function projectSandboxBundle(
  sourceRoot: string,
  outputRoot: string,
  projection: SandboxBundleProjection,
  sourceOverride: string | undefined,
): Promise<SandboxBundleMetadata> {
  const distributionContract = AgentSandboxDistributionContractSchema.parse(
    readJsonFile(resolveContainedPath(sourceRoot, projection.distributionContract)),
  );
  const location = resolveAgentSandboxBundleLocation(distributionContract, projection.target);
  const bundleRoot = sourceOverride
    ? path.resolve(sourceOverride)
    : resolveContainedPath(sourceRoot, projection.sourceRoot);
  const { manifest, archivePath } = await verifyAgentSandboxBundle({
    bundleRoot,
    architecture: projection.target,
    contract: distributionContract,
  });

  const targetRoot = resolveContainedPath(outputRoot, projection.targetRoot);
  copyRegularFile(
    resolveContainedPath(bundleRoot, location.manifestFileName),
    resolveContainedPath(targetRoot, location.manifestFileName),
  );
  copyRegularFile(archivePath, resolveContainedPath(targetRoot, location.archiveFileName));
  return {
    distributionId: manifest.distributionId,
    archiveVersion: manifest.archiveVersion,
    microsandboxVersion: manifest.microsandboxVersion,
    target: manifest.target,
    runtimeImage: manifest.runtimeImage,
    configDigest: manifest.configDigest,
    asset: {
      fileName: manifest.asset.fileName,
      sizeBytes: manifest.asset.sizeBytes,
      sha256: manifest.asset.sha256,
    },
  };
}

function copyRegularFile(sourcePath: string, targetPath: string): void {
  const stats = lstatSync(sourcePath);
  if (!stats.isFile()) throw new Error(`Nano runtime asset must be a regular file: ${sourcePath}`);
  if (existsSync(targetPath)) throw new Error(`Nano runtime asset target already exists: ${targetPath}`);
  mkdirSync(path.dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);
  chmodSync(targetPath, stats.mode & 0o777);
}

function writeGeneratedFiles(
  sourceRoot: string,
  outputRoot: string,
  contract: NanoDistributionContract,
  sourceSha: string,
  repositoryUrl: string,
  sandboxBundle: SandboxBundleMetadata,
): void {
  const templatePath = resolveContainedPath(sourceRoot, contract.generatedFiles.readmeTemplate);
  const replacements: Readonly<Record<string, string>> = {
    sourceBranch: contract.source.branch,
    outputBranch: contract.source.outputBranch,
    repositoryUrl,
    sourceCommit: sourceSha,
    sourceCommitShort: sourceSha.slice(0, 12),
  };
  let readme = readFileSync(templatePath, "utf8");
  for (const [name, value] of Object.entries(replacements)) {
    readme = readme.replaceAll(`{{${name}}}`, value);
  }
  const unresolved = readme.match(/\{\{[a-zA-Z][a-zA-Z0-9]*\}\}/g);
  if (unresolved) throw new Error(`Nano README has unresolved template values: ${unresolved.join(", ")}`);
  writeFileSync(path.join(outputRoot, "README.md"), readme, "utf8");

  writeJsonFile(resolveContainedPath(outputRoot, contract.generatedFiles.metadataFile), {
    schemaVersion: 2,
    distribution: contract.id,
    source: {
      repository: repositoryUrl,
      branch: contract.source.branch,
      commit: sourceSha,
    },
    runtime: {
      sandbox: {
        provider: contract.runtime.sandbox.provider,
        bundle: sandboxBundle,
      },
    },
  });
}

function projectDependencies(
  source: Record<string, string> | undefined,
  projection: DependencyProjection,
  label: string,
): Record<string, string> {
  const entries = source ?? {};
  if (projection.mode === "all") return sortRecord(entries);
  const names = projection.names ?? [];
  for (const name of names) {
    if (!(name in entries)) throw new Error(`${label} projection references a missing entry: ${name}`);
  }
  if (projection.mode === "include") return selectNamedEntries(entries, names, label);
  return sortRecord(Object.fromEntries(Object.entries(entries).filter(([name]) => !names.includes(name))));
}

function selectNamedEntries(
  source: Record<string, string> | undefined,
  names: readonly string[],
  label: string,
): Record<string, string> {
  const entries = source ?? {};
  return Object.fromEntries(
    names.map((name) => {
      const value = entries[name];
      if (value === undefined) throw new Error(`${label} projection references a missing entry: ${name}`);
      return [name, value];
    }),
  );
}

function sortRecord(source: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(source).sort(([left], [right]) => left.localeCompare(right)));
}

function resolveContainedPath(root: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error(`Expected a relative path: ${relativePath}`);
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Path escapes its declared root: ${relativePath}`);
  }
  return resolved;
}

function normalizeRepositoryUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Nano repository URL must be a credential-free HTTPS URL.");
  }
  return url
    .toString()
    .replace(/\/$/, "")
    .replace(/\.git$/, "");
}

function assertCommitSha(value: string): void {
  if (!/^[0-9a-f]{40,64}$/u.test(value)) throw new Error(`Invalid source commit SHA: ${value}`);
}

function runGit(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8" }).trim();
}

function readPackageJson(filePath: string): PackageJson {
  const value = readJsonFile(filePath);
  if (!isRecord(value)) throw new Error(`Package manifest must be an object: ${filePath}`);
  return value as PackageJson;
}

function readJsonFile(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
}

function writeJsonFile(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
}

function assertStringArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== "string" || !entry)) {
    throw new Error(`${label} must be a non-empty string array.`);
  }
  if (new Set(value).size !== value.length) throw new Error(`${label} must not contain duplicates.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
