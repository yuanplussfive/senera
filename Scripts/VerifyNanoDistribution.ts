import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import ts from "typescript";
import { toPosixRelative, walkFiles } from "./Support/FileWalk.js";
import {
  readAgentSandboxDistributionContract,
  resolveAgentSandboxDistributionTarget,
} from "../Source/AgentSystem/Sandbox/AgentSandboxDistributionContract.js";

interface NanoContract {
  readonly schemaVersion: number;
  readonly source: { readonly outputBranch: string; readonly repositoryUrl: string };
  readonly runtime: {
    readonly sandbox: { readonly provider: "auto"; readonly distributionContract: string; readonly target: string };
  };
  readonly rootPackage: {
    readonly scripts: readonly string[];
    readonly dependencies: { readonly mode: string; readonly names?: readonly string[] };
    readonly devDependencies: { readonly mode: string; readonly names?: readonly string[] };
  };
  readonly workspacePackages: Readonly<Record<string, { readonly scripts: readonly string[] }>>;
  readonly generatedFiles: { readonly metadataFile: string };
}

interface PackageJson {
  readonly private?: boolean;
  readonly build?: unknown;
  readonly scripts?: Record<string, string>;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
}

interface NanoMetadata {
  readonly schemaVersion: number;
  readonly distribution: string;
  readonly source: { readonly repository: string; readonly commit: string };
  readonly runtime: {
    readonly sandbox: {
      readonly provider: "auto";
      readonly contract: string;
      readonly distribution: { readonly id: string; readonly version: string; readonly target: string };
      readonly image: { readonly source: string; readonly runtime: string; readonly registry: string };
      readonly probes: readonly {
        readonly id: string;
        readonly command: string;
        readonly arguments: readonly string[];
      }[];
    };
  };
}

const WorkspaceRoot = process.cwd();
const ContractPath = path.join(WorkspaceRoot, "Build", "Distributions", "NanoDistribution.json");
const ContractSchemaPath = path.join(WorkspaceRoot, "Build", "Distributions", "NanoDistribution.schema.json");
const GeneratorPath = path.join(WorkspaceRoot, "Build", "Distributions", "GenerateNanoDistribution.ts");
const WorkflowPath = path.join(WorkspaceRoot, ".github", "workflows", "sync-nano.yml");
const contract = readJson<NanoContract>(ContractPath);

verifyContractSchema(contract);
verifyPublicationWorkflow(contract);

const verificationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-nano-verification-"));
const outputRoot = path.join(verificationRoot, "output");
try {
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: WorkspaceRoot, encoding: "utf8" }).trim();
  const generation = spawnSync(
    process.execPath,
    ["--import", "tsx", GeneratorPath, "--output", outputRoot, "--source-sha", sourceSha],
    { cwd: WorkspaceRoot, encoding: "utf8" },
  );
  assert.equal(
    generation.status,
    0,
    `Nano generator failed.\nstdout:\n${generation.stdout}\nstderr:\n${generation.stderr}`,
  );

  verifyGeneratedFiles(outputRoot);
  verifyRelativeImportClosure(outputRoot);
  verifyRootPackage(outputRoot, contract);
  verifyWorkspacePackages(outputRoot, contract);
  verifyMetadata(outputRoot, contract, sourceSha);
  verifyRepositoryProjection(outputRoot);
} finally {
  fs.rmSync(verificationRoot, { recursive: true, force: true });
}

console.log("Nano distribution contract verified.");

function verifyContractSchema(value: unknown): void {
  const schema = readJson<Record<string, unknown>>(ContractSchemaPath);
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });
  assert.equal(ajv.validateSchema(schema), true, `Nano JSON Schema is invalid: ${ajv.errorsText(ajv.errors)}`);
  const validate = ajv.compile(schema);
  assert.equal(validate(value), true, `Nano distribution contract is invalid: ${ajv.errorsText(validate.errors)}`);
}

function verifyPublicationWorkflow(value: NanoContract): void {
  const workflow = fs.readFileSync(WorkflowPath, "utf8");
  assert.equal(
    workflow.includes("npm run sandbox.prepare"),
    false,
    "Nano publication must rely on the runtime image contract instead of building a local sandbox image.",
  );
  for (const fragment of [
    'workflows: ["Verify"]',
    "github.event.workflow_run.conclusion == 'success'",
    "github.event.workflow_run.head_sha",
    "npm install --package-lock-only",
    "npm ci",
    "npm run check.types",
    "npm run check.frontend-types",
    "npm run dev.server.dry-run",
    "npm run dev",
    "--force-with-lease",
    `refs/heads/${value.source.outputBranch}`,
  ]) {
    assert.ok(workflow.includes(fragment), `Nano publication workflow is missing: ${fragment}`);
  }
}

function verifyGeneratedFiles(outputRoot: string): void {
  const files = listFiles(outputRoot);
  const forbidden = files.filter(
    (file) =>
      file.startsWith(".github/") ||
      file.startsWith("Build/") ||
      file.startsWith("Scripts/") ||
      file.startsWith("Release/") ||
      file.startsWith("Apps/Desktop/") ||
      file.endsWith(".stories.tsx"),
  );
  assert.deepEqual(forbidden, [], `Nano generated forbidden files: ${forbidden.join(", ")}`);
  for (const required of [
    "Apps/DevServer.ts",
    "Apps/SandboxWorker.ts",
    "Apps/SandboxWorkerProcess.ts",
    "Source/AgentSystem/Sandbox/DockerEngine/AgentDockerEngineRuntime.ts",
    "Source/AgentSystem/Sandbox/Worker/AgentSandboxWorkerServer.ts",
    "Source/AgentSystem/Sandbox/Distribution/contract.json",
    "SENERA_NANO.json",
  ]) {
    assert.ok(files.includes(required), `Nano generated distribution is missing ${required}.`);
  }
  const devServer = fs.readFileSync(path.join(outputRoot, "Apps", "DevServer.ts"), "utf8");
  assert.ok(devServer.includes("startSeneraSandboxWorkerProcess"));
  assert.ok(devServer.includes("sandboxRuntimeAvailability: sandbox.availability"));
  assert.ok(devServer.includes("dockerEngineWorker: sandbox.client"));
}

function verifyRelativeImportClosure(outputRoot: string): void {
  const sourceFiles = walkFiles(outputRoot, {
    extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
  });
  const missing: string[] = [];
  for (const sourceFile of sourceFiles) {
    const source = fs.readFileSync(sourceFile, "utf8");
    for (const specifier of runtimeRelativeImports(sourceFile, source)) {
      if (!resolveRelativeImport(outputRoot, sourceFile, specifier)) {
        missing.push(`${toPosixRelative(outputRoot, sourceFile)} -> ${specifier}`);
      }
    }
  }
  assert.deepEqual(missing, [], `Nano generated distribution has unresolved relative imports: ${missing.join(", ")}`);
}

function runtimeRelativeImports(filePath: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const imports = new Set<string>();
  const addSpecifier = (node: ts.Expression | undefined): void => {
    if (node && ts.isStringLiteralLike(node) && node.text.startsWith(".")) imports.add(node.text);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const runtimeBinding =
        !clause ||
        (!clause.isTypeOnly &&
          (Boolean(clause.name) ||
            Boolean(clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) ||
            Boolean(
              clause.namedBindings &&
              ts.isNamedImports(clause.namedBindings) &&
              clause.namedBindings.elements.some((element) => !element.isTypeOnly),
            )));
      if (runtimeBinding) addSpecifier(node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node)) {
      const runtimeBinding =
        !node.isTypeOnly &&
        (!node.exportClause ||
          ts.isNamespaceExport(node.exportClause) ||
          node.exportClause.elements.some((element) => !element.isTypeOnly));
      if (runtimeBinding) addSpecifier(node.moduleSpecifier);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      addSpecifier(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...imports];
}

function resolveRelativeImport(outputRoot: string, sourceFile: string, specifier: string): string | undefined {
  const unresolved = path.resolve(path.dirname(sourceFile), specifier);
  const relative = path.relative(outputRoot, unresolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return undefined;
  const candidates = new Set<string>([unresolved]);
  const extension = path.extname(unresolved);
  const replacements = new Map([
    [".js", [".ts", ".tsx"]],
    [".jsx", [".tsx", ".ts"]],
    [".mjs", [".mts"]],
    [".cjs", [".cts"]],
  ]).get(extension);
  if (replacements) {
    const stem = unresolved.slice(0, -extension.length);
    for (const replacement of replacements) candidates.add(`${stem}${replacement}`);
  } else if (!extension) {
    for (const suffix of [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json"]) {
      candidates.add(`${unresolved}${suffix}`);
      candidates.add(path.join(unresolved, `index${suffix}`));
    }
  }
  return [...candidates].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

function verifyRootPackage(outputRoot: string, value: NanoContract): void {
  const sourcePackage = readJson<PackageJson>(path.join(WorkspaceRoot, "package.json"));
  const nanoPackage = readJson<PackageJson>(path.join(outputRoot, "package.json"));
  assert.equal(nanoPackage.private, true);
  assert.equal(nanoPackage.build, undefined);
  assert.deepEqual(
    nanoPackage.scripts,
    Object.fromEntries(value.rootPackage.scripts.map((name) => [name, requireEntry(sourcePackage.scripts, name)])),
  );
  assert.ok(nanoPackage.dependencies?.dockerode);
  assert.ok(nanoPackage.dependencies?.["tar-fs"]);
  assert.equal(nanoPackage.dependencies?.["fast-glob"], undefined);
  assert.deepEqual(Object.keys(nanoPackage.devDependencies ?? {}), value.rootPackage.devDependencies.names);
  for (const forbidden of ["electron", "electron-builder", "eslint", "vitest", "@vitest/coverage-v8"]) {
    assert.equal(nanoPackage.dependencies?.[forbidden], undefined);
    assert.equal(nanoPackage.devDependencies?.[forbidden], undefined);
  }
}

function verifyWorkspacePackages(outputRoot: string, value: NanoContract): void {
  for (const [packagePath, projection] of Object.entries(value.workspacePackages)) {
    const sourcePackage = readJson<PackageJson>(path.join(WorkspaceRoot, packagePath));
    const nanoPackage = readJson<PackageJson>(path.join(outputRoot, packagePath));
    assert.deepEqual(
      nanoPackage.scripts,
      Object.fromEntries(projection.scripts.map((name) => [name, requireEntry(sourcePackage.scripts, name)])),
    );
  }
}

function verifyMetadata(outputRoot: string, value: NanoContract, sourceSha: string): void {
  const metadata = readJson<NanoMetadata>(path.join(outputRoot, value.generatedFiles.metadataFile));
  const distribution = readAgentSandboxDistributionContract();
  const target = resolveAgentSandboxDistributionTarget(distribution, value.runtime.sandbox.target);
  assert.deepEqual(metadata, {
    schemaVersion: 3,
    distribution: "nano",
    source: {
      repository: value.source.repositoryUrl,
      branch: "main",
      commit: sourceSha,
    },
    runtime: {
      sandbox: {
        provider: "auto",
        contract: value.runtime.sandbox.distributionContract,
        distribution: { id: distribution.id, version: distribution.version, target: value.runtime.sandbox.target },
        image: { source: target.sourceImage, runtime: target.runtimeImage, registry: target.registryImage },
        probes: target.probes,
      },
    },
  });
}

function verifyRepositoryProjection(outputRoot: string): void {
  const initialize = spawnSync("git", ["init", "--initial-branch=nano"], { cwd: outputRoot, encoding: "utf8" });
  assert.equal(initialize.status, 0, initialize.stderr);
  const add = spawnSync("git", ["add", "--all"], { cwd: outputRoot, encoding: "utf8" });
  assert.equal(add.status, 0, add.stderr);
  const staged = execFileSync("git", ["ls-files"], { cwd: outputRoot, encoding: "utf8" })
    .split(/\r?\n/u)
    .filter(Boolean);
  assert.equal(staged.length, listFiles(outputRoot).filter((file) => !file.startsWith(".git/")).length);
}

function requireEntry(entries: Record<string, string> | undefined, name: string): string {
  const value = entries?.[name];
  assert.ok(value, `Package projection references missing script ${name}.`);
  return value;
}

function listFiles(root: string): string[] {
  return walkFiles(root)
    .map((file) => toPosixRelative(root, file))
    .sort();
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}
