import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { Ajv2020 } from "ajv/dist/2020.js";
import ts from "typescript";
import { toPosixPath, toPosixRelative, walkFiles } from "./Support/FileWalk.js";
import { sha256Hex } from "../Source/AgentSystem/Core/AgentHash.js";

interface NanoContract {
  readonly schemaVersion: number;
  readonly source: {
    readonly branch: string;
    readonly outputBranch: string;
    readonly repositoryUrl: string;
  };
  readonly files: {
    readonly projections: readonly { readonly source: string; readonly target: string }[];
  };
  readonly runtime: {
    readonly sandbox: {
      readonly provider: "microsandbox";
      readonly bundle: {
        readonly distributionContract: string;
        readonly sourceRoot: string;
        readonly targetRoot: string;
        readonly target: string;
      };
    };
  };
  readonly rootPackage: {
    readonly scripts: readonly string[];
    readonly dependencies: { readonly mode: string; readonly names?: readonly string[] };
    readonly devDependencies: { readonly mode: string; readonly names?: readonly string[] };
  };
  readonly workspacePackages: Readonly<Record<string, { readonly scripts: readonly string[] }>>;
  readonly generatedFiles: {
    readonly metadataFile: string;
  };
}

interface SandboxDistributionContract {
  readonly formatVersion: number;
  readonly id: string;
  readonly archiveVersion: string;
  readonly microsandboxVersion: string;
  readonly targets: Readonly<
    Record<
      string,
      {
        readonly sourceImage: string;
        readonly runtimeImage: string;
        readonly configDigest: string;
        readonly archive: {
          readonly format: string;
          readonly mediaType: string;
          readonly compression: string;
          readonly compressedMediaType: string;
          readonly assetName: string;
        };
      }
    >
  >;
  readonly bundle: { readonly manifestFileName: string };
}

interface SandboxBundleFixture {
  readonly manifest: {
    readonly distributionId: string;
    readonly archiveVersion: string;
    readonly microsandboxVersion: string;
    readonly target: string;
    readonly runtimeImage: string;
    readonly configDigest: string;
    readonly asset: { readonly fileName: string; readonly sizeBytes: number; readonly sha256: string };
  };
  readonly archivePath: string;
}

interface PackageJson {
  readonly private?: boolean;
  readonly build?: unknown;
  readonly scripts?: Record<string, string>;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
}

const WorkspaceRoot = process.cwd();
const ContractPath = path.join(WorkspaceRoot, "Build", "Distributions", "NanoDistribution.json");
const ContractSchemaPath = path.join(WorkspaceRoot, "Build", "Distributions", "NanoDistribution.schema.json");
const GeneratorPath = path.join(WorkspaceRoot, "Build", "Distributions", "GenerateNanoDistribution.ts");
const WorkflowPath = path.join(WorkspaceRoot, ".github", "workflows", "sync-nano.yml");
const BundleActionPath = path.join(WorkspaceRoot, ".github", "actions", "build-sandbox-bundle", "action.yml");
const ForbiddenPackages = [
  "@commitlint/cli",
  "@ladle/react",
  "@testing-library/jest-dom",
  "@testing-library/react",
  "@testing-library/user-event",
  "@vitest/coverage-v8",
  "@types/dockerode",
  "@types/tar-fs",
  "dockerode",
  "electron",
  "electron-builder",
  "eslint",
  "jsdom",
  "prettier",
  "rimraf",
  "semver",
  "ts-json-schema-generator",
  "tar-fs",
  "vitest",
] as const;

const contract = readJson<NanoContract>(ContractPath);
verifyContractSchema(contract);
verifyPublicationWorkflow(contract);

const verificationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-nano-verification-"));
const outputRoot = path.join(verificationRoot, "output");
const bundleRoot = path.join(verificationRoot, "bundle");
try {
  const fixture = writeSandboxBundleFixture(bundleRoot, contract);
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: WorkspaceRoot,
    encoding: "utf8",
  }).trim();
  const generation = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      GeneratorPath,
      "--output",
      outputRoot,
      "--source-sha",
      sourceSha,
      "--sandbox-bundle-root",
      bundleRoot,
    ],
    { cwd: WorkspaceRoot, encoding: "utf8" },
  );
  assert.equal(
    generation.status,
    0,
    `Nano generator failed.\nstdout:\n${generation.stdout}\nstderr:\n${generation.stderr}`,
  );

  verifyGeneratedFiles(outputRoot, contract, fixture);
  verifyRelativeImportClosure(outputRoot);
  verifyRootPackage(outputRoot, contract);
  verifyWorkspacePackages(outputRoot, contract);
  verifySourceMetadata(outputRoot, contract, sourceSha, fixture);
  verifyBundlePublication(outputRoot, contract, fixture);
  verifyCorruptBundleRejection(verificationRoot, bundleRoot, fixture, sourceSha);
} finally {
  fs.rmSync(verificationRoot, { recursive: true, force: true });
}

console.log("Nano distribution contract verified.");

function verifyContractSchema(contractValue: unknown): void {
  const schema = readJson<Record<string, unknown>>(ContractSchemaPath);
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });
  assert.equal(ajv.validateSchema(schema), true, `Nano JSON Schema is invalid: ${ajv.errorsText(ajv.errors)}`);
  const validate = ajv.compile(schema);
  assert.equal(
    validate(contractValue),
    true,
    `Nano distribution contract is invalid: ${ajv.errorsText(validate.errors)}`,
  );
}

function verifyPublicationWorkflow(contractValue: NanoContract): void {
  const workflow = fs.readFileSync(WorkflowPath, "utf8");
  const bundleAction = fs.readFileSync(BundleActionPath, "utf8");
  const requiredFragments = [
    'workflows: ["Verify"]',
    "github.event.workflow_run.conclusion == 'success'",
    "github.event.workflow_run.head_sha",
    "contents: write",
    "timeout-minutes: 45",
    "./.github/actions/setup-node",
    "./.github/actions/build-sandbox-bundle",
    "--sandbox-bundle-root",
    "npm install --package-lock-only",
    "npm ci",
    "npm run check.types",
    "npm run check.frontend-types",
    "npm run dev",
    'echo "root=$RUNNER_TEMP/senera-nano" >> "$GITHUB_OUTPUT"',
    "steps.paths.outputs.root",
    "--force-with-lease",
    `refs/heads/${contractValue.source.outputBranch}`,
  ];
  for (const fragment of requiredFragments) {
    assert.ok(workflow.includes(fragment), `Nano publication workflow is missing: ${fragment}`);
  }
  assert.ok(!workflow.includes("${{ runner.temp }}"), "Nano workflow must resolve runner.temp inside a job step.");
  assert.ok(!workflow.includes("gh release download"), "Nano publication must build its Bundle from verified source.");
  for (const fragment of [
    "test -c /dev/kvm",
    "npm run build",
    "BuildSandboxImageArchive.js",
    "SENERA_SANDBOX_BUNDLE_OUTPUT",
  ]) {
    assert.ok(bundleAction.includes(fragment), `Sandbox Bundle action is missing: ${fragment}`);
  }
}

function verifyGeneratedFiles(outputRoot: string, contractValue: NanoContract, fixture: SandboxBundleFixture): void {
  const files = listFiles(outputRoot);
  const forbidden = files.filter(
    (file) =>
      file.startsWith(".github/") ||
      file.startsWith("Build/") ||
      file.startsWith("Scripts/") ||
      file.startsWith("Apps/Desktop/") ||
      file === "Source/AgentSystem/Sandbox/Gvisor/AgentGvisorDockerRuntime.ts" ||
      file === "Source/AgentSystem/Sandbox/Gvisor/AgentGvisorWorkerServer.ts" ||
      file === "Apps/DockerServer.ts" ||
      file === "Apps/DockerAdminAccountSync.ts" ||
      file === "Dockerfile" ||
      file === "compose.yaml" ||
      /\.(?:stories|test|spec)\.[^/]+$/u.test(file),
  );
  assert.deepEqual(forbidden, [], `Nano generated forbidden files: ${forbidden.join(", ")}`);

  assert.deepEqual(
    files.filter((file) => file.startsWith("Apps/")),
    [
      "Apps/DevServer.ts",
      "Apps/RuntimeConfigBootstrap.ts",
      "Apps/ServerRuntime.ts",
      "Apps/ServerWatch.ts",
      "Apps/ServerWatchPolicy.ts",
    ],
  );
  const projectedDevServer = fs.readFileSync(path.join(outputRoot, "Apps", "DevServer.ts"), "utf8");
  assert.ok(projectedDevServer.includes("AgentSandboxRuntimeProviders.Microsandbox"));
  assert.ok(projectedDevServer.includes("ensureSeneraDevelopmentConfig"));
  assert.ok(!projectedDevServer.includes("GvisorWorker"));
  assert.deepEqual(contract.files.projections, [
    { source: "Build/Distributions/NanoGitignore.template", target: ".gitignore" },
    { source: "Build/Distributions/NanoDevServer.ts.template", target: "Apps/DevServer.ts" },
  ]);
  const bundleTargetRoot = contractValue.runtime.sandbox.bundle.targetRoot;
  const distributionContract = readSandboxDistributionContract(contractValue);
  for (const required of [
    "README.md",
    "SENERA_NANO.json",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "Frontend/package.json",
    "Source/AgentSystem/AgentDefaults.ts",
    path.posix.join(bundleTargetRoot, distributionContract.bundle.manifestFileName),
    path.posix.join(bundleTargetRoot, fixture.manifest.asset.fileName),
  ]) {
    assert.ok(files.includes(required), `Nano generated distribution is missing ${required}.`);
  }
  assert.deepEqual(
    fs.readFileSync(path.join(outputRoot, bundleTargetRoot, fixture.manifest.asset.fileName)),
    fs.readFileSync(fixture.archivePath),
  );
  const gitignore = fs.readFileSync(path.join(outputRoot, ".gitignore"), "utf8");
  assert.ok(gitignore.includes("!Release/SandboxImage/**"));
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
  const sourceExtension = new Map([
    [".js", [".ts", ".tsx"]],
    [".jsx", [".tsx", ".ts"]],
    [".mjs", [".mts"]],
    [".cjs", [".cts"]],
  ]).get(extension);
  if (sourceExtension) {
    const stem = unresolved.slice(0, -extension.length);
    for (const replacement of sourceExtension) candidates.add(`${stem}${replacement}`);
  } else if (!extension) {
    for (const suffix of [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json"]) {
      candidates.add(`${unresolved}${suffix}`);
      candidates.add(path.join(unresolved, `index${suffix}`));
    }
  }
  return [...candidates].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

function verifyRootPackage(outputRoot: string, contractValue: NanoContract): void {
  const sourcePackage = readJson<PackageJson>(path.join(WorkspaceRoot, "package.json"));
  const nanoPackage = readJson<PackageJson>(path.join(outputRoot, "package.json"));
  assert.equal(nanoPackage.private, true);
  assert.equal(nanoPackage.build, undefined, "Nano root package must not retain Electron Builder configuration.");

  const expectedScripts = Object.fromEntries(
    contractValue.rootPackage.scripts.map((name) => {
      const command = sourcePackage.scripts?.[name];
      assert.ok(command, `Nano contract references missing root script ${name}.`);
      return [name, command];
    }),
  );
  assert.deepEqual(nanoPackage.scripts, expectedScripts);
  assert.deepEqual(Object.keys(nanoPackage.devDependencies ?? {}), contractValue.rootPackage.devDependencies.names);
  for (const dependency of contractValue.rootPackage.dependencies.names ?? []) {
    assert.equal(nanoPackage.dependencies?.[dependency], undefined, `Nano retained excluded dependency ${dependency}.`);
  }
  for (const dependency of ForbiddenPackages) {
    assert.equal(nanoPackage.dependencies?.[dependency], undefined, `Nano retained runtime dependency ${dependency}.`);
    assert.equal(
      nanoPackage.devDependencies?.[dependency],
      undefined,
      `Nano retained development dependency ${dependency}.`,
    );
    assert.equal(
      nanoPackage.optionalDependencies?.[dependency],
      undefined,
      `Nano retained optional dependency ${dependency}.`,
    );
  }
}

function verifyWorkspacePackages(outputRoot: string, contractValue: NanoContract): void {
  for (const [packagePath, projection] of Object.entries(contractValue.workspacePackages)) {
    const sourcePackage = readJson<PackageJson>(path.join(WorkspaceRoot, packagePath));
    const nanoPackage = readJson<PackageJson>(path.join(outputRoot, packagePath));
    const expectedScripts = Object.fromEntries(
      projection.scripts.map((name) => {
        const command = sourcePackage.scripts?.[name];
        assert.ok(command, `Nano contract references missing ${packagePath} script ${name}.`);
        return [name, command];
      }),
    );
    assert.deepEqual(nanoPackage.scripts, expectedScripts);
  }
}

function verifySourceMetadata(
  outputRoot: string,
  contractValue: NanoContract,
  sourceSha: string,
  fixture: SandboxBundleFixture,
): void {
  const metadata = readJson<{
    schemaVersion: number;
    distribution: string;
    source: { repository: string; branch: string; commit: string };
    runtime: {
      sandbox: { provider: string; bundle: SandboxBundleFixture["manifest"] };
    };
  }>(path.join(outputRoot, contractValue.generatedFiles.metadataFile));
  assert.deepEqual(metadata, {
    schemaVersion: 2,
    distribution: "nano",
    source: {
      repository: contractValue.source.repositoryUrl,
      branch: contractValue.source.branch,
      commit: sourceSha,
    },
    runtime: {
      sandbox: {
        provider: "microsandbox",
        bundle: fixture.manifest,
      },
    },
  });
  assert.equal(contractValue.schemaVersion, 3);
  const readme = fs.readFileSync(path.join(outputRoot, "README.md"), "utf8");
  assert.ok(readme.includes(sourceSha));
  assert.ok(readme.includes("git clone --depth 1"));
  assert.ok(readme.includes("不会再访问 GitHub Releases"));
  assert.ok(!/\{\{[a-zA-Z][a-zA-Z0-9]*\}\}/u.test(readme), "Nano README contains unresolved template values.");
}

function writeSandboxBundleFixture(bundleRoot: string, contractValue: NanoContract): SandboxBundleFixture {
  const distribution = readSandboxDistributionContract(contractValue);
  const targetId = contractValue.runtime.sandbox.bundle.target;
  const target = distribution.targets[targetId];
  assert.ok(target, `Sandbox distribution does not declare Nano target ${targetId}.`);
  const archive = gzipSync(Buffer.from("verified Nano Sandbox Bundle fixture"));
  const sha256 = sha256Hex(archive);
  const manifest = {
    formatVersion: distribution.formatVersion,
    distributionId: distribution.id,
    archiveVersion: distribution.archiveVersion,
    microsandboxVersion: distribution.microsandboxVersion,
    target: targetId,
    sourceImage: target.sourceImage,
    runtimeImage: target.runtimeImage,
    configDigest: target.configDigest,
    asset: {
      format: target.archive.format,
      mediaType: target.archive.mediaType,
      compression: target.archive.compression,
      compressedMediaType: target.archive.compressedMediaType,
      fileName: target.archive.assetName,
      sizeBytes: archive.byteLength,
      uncompressedSizeBytes: Buffer.byteLength("verified Nano Sandbox Bundle fixture"),
      sha256,
    },
  };
  fs.mkdirSync(bundleRoot, { recursive: true });
  const archivePath = path.join(bundleRoot, target.archive.assetName);
  fs.writeFileSync(archivePath, archive);
  fs.writeFileSync(
    path.join(bundleRoot, distribution.bundle.manifestFileName),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return {
    manifest: {
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
    },
    archivePath,
  };
}

function verifyCorruptBundleRejection(
  verificationRoot: string,
  bundleRoot: string,
  fixture: SandboxBundleFixture,
  sourceSha: string,
): void {
  fs.appendFileSync(fixture.archivePath, "corrupt");
  const generation = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      GeneratorPath,
      "--output",
      path.join(verificationRoot, "corrupt-output"),
      "--source-sha",
      sourceSha,
      "--sandbox-bundle-root",
      bundleRoot,
    ],
    { cwd: WorkspaceRoot, encoding: "utf8" },
  );
  assert.notEqual(generation.status, 0, "Nano generator accepted a corrupt Sandbox Bundle.");
  assert.match(`${generation.stdout}\n${generation.stderr}`, /archive size does not match|SHA-256 verification/u);
}

function verifyBundlePublication(outputRoot: string, contractValue: NanoContract, fixture: SandboxBundleFixture): void {
  const initialize = spawnSync("git", ["init", "--initial-branch=nano"], { cwd: outputRoot, encoding: "utf8" });
  assert.equal(initialize.status, 0, `Could not initialize generated Nano repository: ${initialize.stderr}`);
  const add = spawnSync("git", ["add", "--all"], { cwd: outputRoot, encoding: "utf8" });
  assert.equal(add.status, 0, `Could not stage generated Nano repository: ${add.stderr}`);
  const staged = execFileSync("git", ["ls-files"], { cwd: outputRoot, encoding: "utf8" })
    .split(/\r?\n/u)
    .filter(Boolean)
    .map(toPosixPath);
  const bundleRoot = contractValue.runtime.sandbox.bundle.targetRoot;
  const distribution = readSandboxDistributionContract(contractValue);
  for (const expected of [
    path.posix.join(bundleRoot, distribution.bundle.manifestFileName),
    path.posix.join(bundleRoot, fixture.manifest.asset.fileName),
  ]) {
    assert.ok(staged.includes(expected), `Nano publication would omit embedded runtime asset ${expected}.`);
  }
}

function readSandboxDistributionContract(contractValue: NanoContract): SandboxDistributionContract {
  return readJson<SandboxDistributionContract>(
    path.join(WorkspaceRoot, contractValue.runtime.sandbox.bundle.distributionContract),
  );
}

function listFiles(root: string): string[] {
  return walkFiles(root)
    .map((file) => toPosixRelative(root, file))
    .sort((left, right) => left.localeCompare(right));
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}
