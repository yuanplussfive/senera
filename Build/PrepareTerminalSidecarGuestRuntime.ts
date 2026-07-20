import { createHash } from "node:crypto";
import fs from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import crossSpawn from "cross-spawn";
import { resolveAgentDefaults } from "../Source/AgentSystem/AgentDefaults.js";
import { isMainModule } from "../Source/AgentSystem/Core/AgentPath.js";
import { resolveSeneraTerminalSidecarGuestRuntimeRoot } from "../Source/AgentSystem/Execution/SeneraTerminalSidecarGuestRuntime.js";

const { sync: spawnSync } = crossSpawn;

const RuntimeManifestFileName = ".senera-terminal-runtime.json";
const SidecarPackageRelativePath = path.join("Packages", "TerminalSidecar");
const SidecarRuntimeFiles = [
  "package.json",
  "protocol.js",
  "index.d.ts",
  path.join("bin", "senera-terminal-sidecar.js"),
] as const;

interface TerminalSidecarPackageJson {
  name: string;
  version: string;
  dependencies: Record<string, string>;
}

interface PreparedTerminalSidecarRuntimeManifest {
  fingerprint: string;
  platform: "linux";
  architecture: NodeJS.Architecture;
  packageName: string;
  packageVersion: string;
}

export interface PrepareTerminalSidecarGuestRuntimeOptions {
  workspaceRoot: string;
  sandboxRuntimeBaseDir: string;
  architecture?: NodeJS.Architecture;
  log?: (message: string) => void;
}

export interface PrepareTerminalSidecarGuestRuntimeResult {
  runtimeRoot: string;
  prepared: boolean;
  fingerprint: string;
}

if (isMainModule(import.meta.url)) {
  const workspaceRoot = process.cwd();
  const defaults = resolveAgentDefaults(undefined).SandboxRuntime;
  const sandboxRuntimeBaseDir = path.resolve(
    workspaceRoot,
    readOptionValue(process.argv.slice(2), "--base-dir") ?? defaults.BaseDir,
  );
  await prepareSeneraTerminalSidecarGuestRuntime({
    workspaceRoot,
    sandboxRuntimeBaseDir,
    log: (message) => process.stdout.write(`${message}\n`),
  });
}

export async function prepareSeneraTerminalSidecarGuestRuntime(
  options: PrepareTerminalSidecarGuestRuntimeOptions,
): Promise<PrepareTerminalSidecarGuestRuntimeResult> {
  const architecture = options.architecture ?? process.arch;
  const runtimeRoot = resolveSeneraTerminalSidecarGuestRuntimeRoot(options.sandboxRuntimeBaseDir, architecture);
  const packageRoot = path.join(options.workspaceRoot, SidecarPackageRelativePath);
  const packageJson = await readPackageJson(packageRoot);
  const fingerprint = await runtimeFingerprint(packageRoot, packageJson, architecture);
  if (await isPreparedRuntimeCurrent(runtimeRoot, fingerprint, architecture)) {
    options.log?.(`Terminal Sidecar guest runtime is current: ${runtimeRoot}`);
    return { runtimeRoot, prepared: false, fingerprint };
  }

  const runtimeParent = path.dirname(runtimeRoot);
  await mkdir(runtimeParent, { recursive: true });
  const stagingRoot = await mkdtemp(path.join(runtimeParent, ".stage-"));
  try {
    installGuestDependencies(stagingRoot, packageJson.dependencies, architecture);
    const stagedPackageRoot = path.join(stagingRoot, "node_modules", "@senera", "terminal-sidecar");
    await cp(packageRoot, stagedPackageRoot, { recursive: true, force: true });
    await assertPreparedRuntime(stagingRoot, architecture);
    await writeManifest(stagingRoot, {
      fingerprint,
      platform: "linux",
      architecture,
      packageName: packageJson.name,
      packageVersion: packageJson.version,
    });
    await rm(runtimeRoot, { recursive: true, force: true });
    await rename(stagingRoot, runtimeRoot);
    options.log?.(`Prepared Terminal Sidecar guest runtime: ${runtimeRoot}`);
    return { runtimeRoot, prepared: true, fingerprint };
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

function installGuestDependencies(
  stagingRoot: string,
  dependencies: Readonly<Record<string, string>>,
  architecture: NodeJS.Architecture,
): void {
  const packageSpecs = Object.entries(dependencies)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, version]) => `${name}@${version}`);
  const result = spawnSync(
    "npm",
    [
      "install",
      "--prefix",
      stagingRoot,
      "--os=linux",
      `--cpu=${architecture}`,
      "--ignore-scripts",
      "--package-lock=false",
      "--omit=dev",
      ...packageSpecs,
    ],
    {
      cwd: stagingRoot,
      stdio: "inherit",
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`Unable to install Terminal Sidecar guest dependencies (exit ${result.status}).`);
}

async function assertPreparedRuntime(runtimeRoot: string, architecture: NodeJS.Architecture): Promise<void> {
  const requiredFiles = [
    path.join(runtimeRoot, "node_modules", "@senera", "terminal-sidecar", "bin", "senera-terminal-sidecar.js"),
    path.join(runtimeRoot, "node_modules", "@lydell", `node-pty-linux-${architecture}`, "pty.node"),
    path.join(runtimeRoot, "node_modules", "@msgpack", "msgpack", "package.json"),
    path.join(runtimeRoot, "node_modules", "zod", "package.json"),
  ];
  const missing = requiredFiles.filter((file) => !fs.existsSync(file));
  if (missing.length > 0) throw new Error(`Terminal Sidecar guest runtime is incomplete: ${missing.join(", ")}`);
}

async function isPreparedRuntimeCurrent(
  runtimeRoot: string,
  fingerprint: string,
  architecture: NodeJS.Architecture,
): Promise<boolean> {
  try {
    const manifest = JSON.parse(
      await readFile(path.join(runtimeRoot, RuntimeManifestFileName), "utf8"),
    ) as PreparedTerminalSidecarRuntimeManifest;
    await assertPreparedRuntime(runtimeRoot, architecture);
    return (
      manifest.fingerprint === fingerprint && manifest.architecture === architecture && manifest.platform === "linux"
    );
  } catch {
    return false;
  }
}

async function writeManifest(runtimeRoot: string, manifest: PreparedTerminalSidecarRuntimeManifest): Promise<void> {
  await writeFile(path.join(runtimeRoot, RuntimeManifestFileName), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function readPackageJson(packageRoot: string): Promise<TerminalSidecarPackageJson> {
  return JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as TerminalSidecarPackageJson;
}

async function runtimeFingerprint(
  packageRoot: string,
  packageJson: TerminalSidecarPackageJson,
  architecture: NodeJS.Architecture,
): Promise<string> {
  const hash = createHash("sha256");
  hash.update(JSON.stringify({ architecture, dependencies: packageJson.dependencies }));
  for (const file of SidecarRuntimeFiles) {
    hash.update(file);
    hash.update(await readFile(path.join(packageRoot, file)));
  }
  return hash.digest("hex");
}

function readOptionValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value?.trim() || undefined;
}
