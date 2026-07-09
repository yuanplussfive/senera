import fs from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ResolvedAgentSandboxRuntimeConfig } from "../Types/AgentConfigTypes.js";

export interface AgentSandboxRuntimePaths {
  baseDir: string;
  bundleDir: string;
  msbPath: string;
  libkrunfwPath: string;
}

export interface AgentSandboxRuntimePreparationOptions {
  workspaceRoot: string;
  config: ResolvedAgentSandboxRuntimeConfig;
  images?: readonly string[];
  strict?: boolean;
  skipImagePull?: boolean;
  importBundles?: boolean;
  exportBundlePath?: string;
  microsandbox?: MicrosandboxModule;
  log?: (message: string) => void;
}

export interface AgentSandboxRuntimePreparationResult {
  paths: AgentSandboxRuntimePaths;
  importedBundles: string[];
  preparedImages: string[];
  exportedBundlePath?: string;
  skippedReason?: string;
}

export interface MicrosandboxModule {
  install(): Promise<void>;
  isInstalled(): boolean;
  setup(): MicrosandboxSetupBuilder;
  setRuntimeLibkrunfwPath(path: string): void;
  Snapshot: MicrosandboxSnapshotApi;
  Sandbox: {
    builder(name: string): MicrosandboxSandboxBuilder;
    get(name: string): Promise<MicrosandboxSandboxHandle>;
  };
}

export interface MicrosandboxSetupBuilder {
  baseDir(path: string): this;
  install(): Promise<void>;
}

export interface MicrosandboxSnapshotApi {
  import(archive: string, dest?: string): Promise<unknown>;
  export(nameOrPath: string, out: string, opts?: { withImage?: boolean }): Promise<void>;
}

export interface MicrosandboxSandboxBuilder {
  image(image: string): this;
  pullPolicy(policy: string): this;
  cpus(value: number): this;
  memory(value: number): this;
  replace(): this;
  quietLogs(): this;
  disableMetricsSample(): this;
  disableNetwork(): this;
  maxDuration(seconds: number): this;
  create(): Promise<MicrosandboxSandbox>;
}

export interface MicrosandboxSandbox {
  name: string;
  stopWithTimeout(timeoutMs: number): Promise<unknown>;
  kill(): Promise<unknown>;
}

export interface MicrosandboxSandboxHandle {
  snapshotTo(path: string): Promise<unknown>;
}

const SandboxPreparePrefix = "senera-sandbox-prepare";
const BundleExtensions = new Set([".tar", ".zst"]);

export async function prepareAgentSandboxRuntime(
  options: AgentSandboxRuntimePreparationOptions,
): Promise<AgentSandboxRuntimePreparationResult> {
  const log = options.log ?? (() => undefined);
  const paths = resolveAgentSandboxRuntimePaths(options.workspaceRoot, options.config);
  const result: AgentSandboxRuntimePreparationResult = {
    paths,
    importedBundles: [],
    preparedImages: [],
  };

  try {
    const microsandbox = options.microsandbox ?? await loadMicrosandbox();
    await mkdir(paths.baseDir, { recursive: true });
    await mkdir(paths.bundleDir, { recursive: true });
    configureMicrosandboxRuntime(microsandbox, paths);
    await installMicrosandboxRuntime(microsandbox, paths, log);

    if (options.importBundles ?? options.config.ImportBundlesOnStartup) {
      result.importedBundles = await importSandboxBundles(microsandbox, paths.bundleDir, log);
    }

    if (!options.skipImagePull) {
      for (const image of normalizeSandboxImages(options.config.Images, options.images)) {
        await warmSandboxImage(microsandbox, image, log);
        result.preparedImages.push(image);
      }
    }

    if (options.exportBundlePath) {
      result.exportedBundlePath = await exportSandboxBundle(
        microsandbox,
        options.exportBundlePath,
        result.preparedImages,
        log,
      );
    }
  } catch (error) {
    if (options.strict) {
      throw error;
    }
    result.skippedReason = errorMessage(error);
    log(`sandbox prepare skipped: ${result.skippedReason}`);
  }

  return result;
}

export function resolveAgentSandboxRuntimePaths(
  workspaceRoot: string,
  config: Pick<ResolvedAgentSandboxRuntimeConfig, "BaseDir" | "BundleDir">,
): AgentSandboxRuntimePaths {
  const baseDir = resolveConfiguredPath(workspaceRoot, config.BaseDir);
  return {
    baseDir,
    bundleDir: resolveConfiguredPath(workspaceRoot, config.BundleDir),
    msbPath: path.join(baseDir, "bin", process.platform === "win32" ? "msb.exe" : "msb"),
    libkrunfwPath: path.join(
      baseDir,
      "lib",
      process.platform === "win32"
        ? "libkrunfw.dll"
        : process.platform === "darwin"
          ? "libkrunfw.dylib"
          : "libkrunfw.so",
    ),
  };
}

export function configureMicrosandboxRuntime(
  microsandbox: Pick<MicrosandboxModule, "setRuntimeLibkrunfwPath">,
  paths: AgentSandboxRuntimePaths,
): void {
  process.env.MSB_PATH = paths.msbPath;
  microsandbox.setRuntimeLibkrunfwPath(paths.libkrunfwPath);
}

export function normalizeSandboxImages(
  configuredImages: readonly string[],
  extraImages: readonly string[] = [],
): string[] {
  return [...new Set([...configuredImages, ...extraImages].map((image) => image.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

async function loadMicrosandbox(): Promise<MicrosandboxModule> {
  return await import("microsandbox") as MicrosandboxModule;
}

async function installMicrosandboxRuntime(
  microsandbox: MicrosandboxModule,
  paths: AgentSandboxRuntimePaths,
  log: (message: string) => void,
): Promise<void> {
  if (fs.existsSync(paths.msbPath) && fs.existsSync(paths.libkrunfwPath) && microsandbox.isInstalled()) {
    log("microsandbox runtime already installed.");
    return;
  }

  log(`Installing microsandbox runtime into ${paths.baseDir}...`);
  await microsandbox.setup().baseDir(paths.baseDir).install();
}

async function importSandboxBundles(
  microsandbox: MicrosandboxModule,
  bundleDir: string,
  log: (message: string) => void,
): Promise<string[]> {
  const bundles = await discoverSandboxBundles(bundleDir);
  for (const bundle of bundles) {
    log(`Importing sandbox bundle ${bundle}...`);
    await microsandbox.Snapshot.import(bundle);
  }
  return bundles;
}

async function discoverSandboxBundles(bundleDir: string): Promise<string[]> {
  if (!fs.existsSync(bundleDir)) {
    return [];
  }

  const entries = await readdir(bundleDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(bundleDir, entry.name))
    .filter(isSandboxBundlePath)
    .sort((left, right) => left.localeCompare(right));
}

function isSandboxBundlePath(filePath: string): boolean {
  if (filePath.endsWith(".tar.zst")) {
    return true;
  }
  return BundleExtensions.has(path.extname(filePath));
}

async function warmSandboxImage(
  microsandbox: MicrosandboxModule,
  image: string,
  log: (message: string) => void,
): Promise<void> {
  const name = `${SandboxPreparePrefix}-${safeImageName(image)}-${process.pid}`;
  let sandbox: MicrosandboxSandbox | undefined;
  log(`Preparing sandbox image ${image}...`);
  try {
    sandbox = await microsandbox.Sandbox.builder(name)
      .image(image)
      .pullPolicy("if-missing")
      .cpus(1)
      .memory(256)
      .replace()
      .quietLogs()
      .disableMetricsSample()
      .disableNetwork()
      .maxDuration(60)
      .create();
  } finally {
    if (sandbox) {
      await sandbox.stopWithTimeout(1_000).catch(async () => {
        await sandbox?.kill().catch(() => undefined);
      });
    }
  }
}

async function exportSandboxBundle(
  microsandbox: MicrosandboxModule,
  exportBundlePath: string,
  preparedImages: readonly string[],
  log: (message: string) => void,
): Promise<string> {
  const image = preparedImages[0];
  if (!image) {
    throw new Error("导出 sandbox bundle 前必须至少准备一个镜像。");
  }

  const sandboxName = `${SandboxPreparePrefix}-${safeImageName(image)}-${process.pid}`;
  const snapshotRoot = await mkdtemp(path.join(os.tmpdir(), "senera-sandbox-snapshot-"));
  const snapshotPath = path.join(snapshotRoot, "snapshot");
  await mkdir(path.dirname(exportBundlePath), { recursive: true });
  try {
    log(`Creating sandbox snapshot ${snapshotPath}...`);
    await microsandbox.Sandbox.get(sandboxName).then(
      (handle) => handle.snapshotTo(snapshotPath),
      async () => {
        const sandbox = await microsandbox.Sandbox.builder(sandboxName)
          .image(image)
          .pullPolicy("if-missing")
          .cpus(1)
          .memory(256)
          .replace()
          .quietLogs()
          .disableMetricsSample()
          .disableNetwork()
          .maxDuration(60)
          .create();
        try {
          await sandbox.stopWithTimeout(1_000);
        } finally {
          await sandbox.kill().catch(() => undefined);
        }
        await microsandbox.Sandbox.get(sandboxName).then((handle) => handle.snapshotTo(snapshotPath));
      },
    );
    log(`Exporting sandbox bundle ${exportBundlePath}...`);
    await microsandbox.Snapshot.export(snapshotPath, exportBundlePath, { withImage: true });
    return exportBundlePath;
  } finally {
    await rm(snapshotRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

function resolveConfiguredPath(workspaceRoot: string, value: string): string {
  return path.isAbsolute(value)
    ? path.normalize(value)
    : path.resolve(workspaceRoot, value);
}

function safeImageName(image: string): string {
  return image
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
