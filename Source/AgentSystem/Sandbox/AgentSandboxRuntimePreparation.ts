import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import type { SeneraMicrosandboxModuleLoader } from "../Execution/SeneraMicrosandboxSdkAdapter.js";
import type { ResolvedAgentSandboxRuntimeConfig } from "../Types/AgentConfigTypes.js";
import { normalizeSandboxImages } from "./AgentSandboxRuntimeImages.js";
import { AgentSandboxPreparationStages, type AgentSandboxPreparationProgress } from "./AgentSandboxRuntimeTypes.js";

export { normalizeSandboxImages } from "./AgentSandboxRuntimeImages.js";

export interface AgentSandboxRuntimePaths {
  baseDir: string;
}

export interface AgentSandboxRuntimePreparationOptions {
  workspaceRoot: string;
  config: ResolvedAgentSandboxRuntimeConfig;
  images?: readonly string[];
  strict?: boolean;
  skipImagePull?: boolean;
  exportBundlePath?: string;
  microsandbox?: MicrosandboxModule;
  microsandboxModuleLoader?: SeneraMicrosandboxModuleLoader;
  log?: (message: string) => void;
  onProgress?: (progress: AgentSandboxPreparationProgress) => void;
}

export interface AgentSandboxRuntimePreparationResult {
  paths: AgentSandboxRuntimePaths;
  preparedImages: string[];
  exportedBundlePath?: string;
  skippedReason?: string;
}

export interface MicrosandboxModule {
  Snapshot: MicrosandboxSnapshotApi;
  Sandbox: {
    builder(name: string): MicrosandboxSandboxBuilder;
    get(name: string): Promise<MicrosandboxSandboxHandle>;
  };
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
  createWithPullProgress(): Promise<MicrosandboxPullProgressCreate>;
}

export interface MicrosandboxPullProgressCreate extends AsyncIterable<MicrosandboxPullProgressEvent> {
  awaitSandbox(): Promise<MicrosandboxSandbox>;
}

export type MicrosandboxPullProgressEvent =
  | { kind: "resolving"; reference: string }
  | { kind: "resolved"; reference: string; totalDownloadBytes: number | null }
  | { kind: "layerDownloadProgress"; layerIndex: number; downloadedBytes: number; totalBytes: number | null }
  | { kind: "layerDownloadComplete"; layerIndex: number; downloadedBytes: number }
  | { kind: "layerDownloadVerifying"; layerIndex: number }
  | { kind: "layerMaterializeStarted"; layerIndex: number }
  | { kind: "layerMaterializeProgress"; layerIndex: number; bytesRead: number; totalBytes: number }
  | { kind: "layerMaterializeWriting"; layerIndex: number }
  | { kind: "layerMaterializeComplete"; layerIndex: number }
  | { kind: "stitchMergingTrees" }
  | { kind: "stitchWritingFsmeta" }
  | { kind: "stitchWritingVmdk" }
  | { kind: "stitchComplete" }
  | { kind: "complete"; reference: string };

export interface MicrosandboxSandbox {
  name: string;
  stopWithTimeout(timeoutMs: number): Promise<unknown>;
  kill(): Promise<unknown>;
}

export interface MicrosandboxSandboxHandle {
  snapshotTo(path: string): Promise<unknown>;
}

const SandboxPreparePrefix = "senera-sandbox-prepare";

export async function prepareAgentSandboxRuntime(
  options: AgentSandboxRuntimePreparationOptions,
): Promise<AgentSandboxRuntimePreparationResult> {
  const log = options.log ?? (() => undefined);
  const report = options.onProgress ?? (() => undefined);
  const paths = resolveAgentSandboxRuntimePaths(options.workspaceRoot, options.config);
  const result: AgentSandboxRuntimePreparationResult = {
    paths,
    preparedImages: [],
  };

  try {
    report({ stage: AgentSandboxPreparationStages.CheckingHostRuntime });
    await mkdir(paths.baseDir, { recursive: true });
    configureMicrosandboxRuntime(paths);
    report({ stage: AgentSandboxPreparationStages.LoadingRuntime });
    const microsandbox = options.microsandbox ?? (await loadMicrosandbox(options.microsandboxModuleLoader));

    if (!options.skipImagePull) {
      const images = normalizeSandboxImages(options.config.Images, options.images);
      for (const [index, image] of images.entries()) {
        await warmSandboxImage(microsandbox, image, index, images.length, log, report);
        result.preparedImages.push(image);
      }
    }

    if (options.exportBundlePath) {
      report({ stage: AgentSandboxPreparationStages.ExportingBundle });
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
  config: Pick<ResolvedAgentSandboxRuntimeConfig, "BaseDir">,
): AgentSandboxRuntimePaths {
  const baseDir = resolveConfiguredPath(workspaceRoot, config.BaseDir);
  return { baseDir };
}

export function configureMicrosandboxRuntime(paths: AgentSandboxRuntimePaths): void {
  process.env.MSB_HOME = paths.baseDir;
}

async function loadMicrosandbox(loader: SeneraMicrosandboxModuleLoader = () => import("microsandbox")) {
  return (await loader()) as MicrosandboxModule;
}

async function warmSandboxImage(
  microsandbox: MicrosandboxModule,
  image: string,
  imageIndex: number,
  imageCount: number,
  log: (message: string) => void,
  report: (progress: AgentSandboxPreparationProgress) => void,
): Promise<void> {
  const name = `${SandboxPreparePrefix}-${safeImageName(image)}-${process.pid}`;
  let sandbox: MicrosandboxSandbox | undefined;
  log(`Preparing sandbox image ${image}...`);
  report({
    stage: AgentSandboxPreparationStages.WarmingImage,
    item: image,
    completed: imageIndex,
    total: imageCount,
  });
  try {
    const creation = await microsandbox.Sandbox.builder(name)
      .image(image)
      .pullPolicy("if-missing")
      .cpus(1)
      .memory(256)
      .replace()
      .quietLogs()
      .disableMetricsSample()
      .disableNetwork()
      .maxDuration(60)
      .createWithPullProgress();
    const [createdSandbox] = await Promise.all([
      creation.awaitSandbox(),
      consumeImagePullProgress(creation, image, imageIndex, imageCount, report),
    ]);
    sandbox = createdSandbox;
    report({
      stage: AgentSandboxPreparationStages.WarmingImage,
      item: image,
      completed: imageIndex + 1,
      total: imageCount,
    });
  } finally {
    if (sandbox) {
      await sandbox.stopWithTimeout(1_000).catch(async () => {
        await sandbox?.kill().catch(() => undefined);
      });
    }
  }
}

async function consumeImagePullProgress(
  stream: MicrosandboxPullProgressCreate,
  image: string,
  imageIndex: number,
  imageCount: number,
  report: (progress: AgentSandboxPreparationProgress) => void,
): Promise<void> {
  const layerDownloads = new Map<number, number>();
  let totalBytes: number | undefined;
  for await (const event of stream) {
    if (event.kind === "resolved" && event.totalDownloadBytes !== null) {
      totalBytes = event.totalDownloadBytes;
    }
    if (event.kind === "layerDownloadProgress" || event.kind === "layerDownloadComplete") {
      layerDownloads.set(event.layerIndex, event.downloadedBytes);
    }
    report({
      stage: AgentSandboxPreparationStages.WarmingImage,
      item: image,
      completed: imageIndex,
      total: imageCount,
      downloadedBytes: sumNumbers(layerDownloads.values()),
      totalBytes,
    });
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
    throw new Error(agentErrorMessage("sandbox.bundleImageRequired"));
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
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(workspaceRoot, value);
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

function sumNumbers(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}
