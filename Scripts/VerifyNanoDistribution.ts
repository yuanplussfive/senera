import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";

interface NanoContract {
  readonly source: {
    readonly branch: string;
    readonly outputBranch: string;
    readonly repositoryUrl: string;
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
const ForbiddenPackages = [
  "@commitlint/cli",
  "@ladle/react",
  "@testing-library/jest-dom",
  "@testing-library/react",
  "@testing-library/user-event",
  "@vitest/coverage-v8",
  "electron",
  "electron-builder",
  "eslint",
  "jsdom",
  "prettier",
  "rimraf",
  "semver",
  "ts-json-schema-generator",
  "vitest",
] as const;

const contract = readJson<NanoContract>(ContractPath);
verifyContractSchema(contract);
verifyPublicationWorkflow(contract);

const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-nano-verification-"));
try {
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: WorkspaceRoot,
    encoding: "utf8",
  }).trim();
  const generation = spawnSync(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      "--experimental-strip-types",
      GeneratorPath,
      "--output",
      outputRoot,
      "--source-sha",
      sourceSha,
    ],
    { cwd: WorkspaceRoot, encoding: "utf8" },
  );
  assert.equal(
    generation.status,
    0,
    `Nano generator failed.\nstdout:\n${generation.stdout}\nstderr:\n${generation.stderr}`,
  );

  verifyGeneratedFiles(outputRoot);
  verifyRootPackage(outputRoot, contract);
  verifyWorkspacePackages(outputRoot, contract);
  verifySourceMetadata(outputRoot, contract, sourceSha);
} finally {
  fs.rmSync(outputRoot, { recursive: true, force: true });
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
  const requiredFragments = [
    'workflows: ["Verify"]',
    "github.event.workflow_run.conclusion == 'success'",
    "github.event.workflow_run.head_sha",
    "contents: write",
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
}

function verifyGeneratedFiles(outputRoot: string): void {
  const files = listFiles(outputRoot);
  const forbidden = files.filter(
    (file) =>
      file.startsWith(".github/") ||
      file.startsWith("Build/") ||
      file.startsWith("Scripts/") ||
      file.startsWith("Apps/Desktop/") ||
      file === "Apps/DockerServer.ts" ||
      file === "Apps/DockerAdminAccountSync.ts" ||
      file === "Dockerfile" ||
      file === "compose.yaml" ||
      /\.(?:stories|test|spec)\.[^/]+$/u.test(file),
  );
  assert.deepEqual(forbidden, [], `Nano generated forbidden files: ${forbidden.join(", ")}`);

  assert.deepEqual(
    files.filter((file) => file.startsWith("Apps/")),
    ["Apps/DevServer.ts", "Apps/ServerRuntime.ts", "Apps/ServerWatch.ts"],
  );
  for (const required of [
    "README.md",
    "SENERA_NANO.json",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "Frontend/package.json",
    "Source/AgentSystem/AgentDefaults.ts",
  ]) {
    assert.ok(files.includes(required), `Nano generated distribution is missing ${required}.`);
  }
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

function verifySourceMetadata(outputRoot: string, contractValue: NanoContract, sourceSha: string): void {
  const metadata = readJson<{
    schemaVersion: number;
    distribution: string;
    source: { repository: string; branch: string; commit: string };
  }>(path.join(outputRoot, contractValue.generatedFiles.metadataFile));
  assert.deepEqual(metadata, {
    schemaVersion: 1,
    distribution: "nano",
    source: {
      repository: contractValue.source.repositoryUrl,
      branch: contractValue.source.branch,
      commit: sourceSha,
    },
  });
  const readme = fs.readFileSync(path.join(outputRoot, "README.md"), "utf8");
  assert.ok(readme.includes(sourceSha));
  assert.ok(!/\{\{[a-zA-Z][a-zA-Z0-9]*\}\}/u.test(readme), "Nano README contains unresolved template values.");
}

function listFiles(root: string, relative = ""): string[] {
  return fs
    .readdirSync(path.join(root, relative), { withFileTypes: true })
    .flatMap((entry) => {
      const child = path.posix.join(relative.replaceAll("\\", "/"), entry.name);
      return entry.isDirectory() ? listFiles(root, child) : [child];
    })
    .sort((left, right) => left.localeCompare(right));
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}
