import { readFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import type { SeneraMicrosandboxModuleLoader } from "../Execution/SeneraMicrosandboxSdkAdapter.js";
import type { ResolvedAgentSandboxRuntimeConfig } from "../Types/AgentConfigTypes.js";
import type { AgentSandboxRegistryConfig } from "../Types/AgentRuntimeConfigTypes.js";
import { installAgentSandboxReleaseBundle } from "./AgentSandboxBundleInstaller.js";
import { normalizeSandboxImages } from "./AgentSandboxRuntimeImages.js";
import { AgentSandboxPreparationStages, type AgentSandboxPreparationProgress } from "./AgentSandboxRuntimeTypes.js";

export { normalizeSandboxImages } from "./AgentSandboxRuntimeImages.js";

export interface AgentSandboxRuntimePaths {
  baseDir: string;
}

export interface AgentSandboxRuntimePreparationOptions {
  workspaceRoot: string;
  config: ResolvedAgentSandboxRuntimeConfig;
  productVersion?: string;
  architecture?: string;
  exportBundlePath?: string;
  microsandbox?: MicrosandboxModule;
  microsandboxModuleLoader?: SeneraMicrosandboxModuleLoader;
  bundleInstaller?: typeof installAgentSandboxReleaseBundle;
  log?: (message: string) => void;
  onProgress?: (progress: AgentSandboxPreparationProgress) => void;
}

export interface AgentSandboxRuntimePreparationResult {
  paths: AgentSandboxRuntimePaths;
  preparedImages: string[];
  exportedBundlePath?: string;
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
  registry(configure: (registry: MicrosandboxRegistryConfigBuilder) => MicrosandboxRegistryConfigBuilder): this;
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

export interface MicrosandboxRegistryConfigBuilder {
  auth(auth: { kind: "anonymous" } | { kind: "basic"; username: string; password: string }): this;
  insecure(): this;
  caCerts(pemData: Buffer): this;
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

  report({ stage: AgentSandboxPreparationStages.CheckingHostRuntime });
  await mkdir(paths.baseDir, { recursive: true });
  configureMicrosandboxRuntime(paths);
  report({ stage: AgentSandboxPreparationStages.LoadingRuntime });
  const microsandbox = options.microsandbox ?? (await loadMicrosandbox(options.microsandboxModuleLoader));

  const provisioning = await resolveSandboxProvisioning(options, microsandbox, paths, report);
  for (const [index, image] of provisioning.images.entries()) {
    await warmSandboxImage(
      microsandbox,
      image,
      provisioning.pullPolicy,
      provisioning.registry,
      index,
      provisioning.images.length,
      log,
      report,
    );
    result.preparedImages.push(image);
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
  pullPolicy: "if-missing" | "never",
  registry: ResolvedSandboxRegistry | undefined,
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
    const builder = microsandbox.Sandbox.builder(name).image(image).pullPolicy(pullPolicy);
    configureRegistry(builder, registry);
    const creation = await builder
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

interface ResolvedSandboxProvisioning {
  images: string[];
  pullPolicy: "if-missing" | "never";
  registry?: ResolvedSandboxRegistry;
}

interface ResolvedSandboxRegistry {
  authentication?: { kind: "anonymous" } | { kind: "basic"; username: string; password: string };
  insecure: boolean;
  certificates: Buffer[];
}

async function resolveSandboxProvisioning(
  options: AgentSandboxRuntimePreparationOptions,
  microsandbox: MicrosandboxModule,
  paths: AgentSandboxRuntimePaths,
  report: (progress: AgentSandboxPreparationProgress) => void,
): Promise<ResolvedSandboxProvisioning> {
  const provisioning = options.config.Provisioning;
  if (provisioning.Kind === "Oci") {
    const images = normalizeSandboxImages(provisioning.Images);
    if (images.length === 0) throw new Error("OCI sandbox provisioning requires at least one image.");
    return {
      images,
      pullPolicy: "if-missing",
      registry: provisioning.Registry
        ? await resolveSandboxRegistry(options.workspaceRoot, provisioning.Registry)
        : undefined,
    };
  }

  const productVersion = options.productVersion?.trim();
  if (!productVersion) {
    throw new Error("ReleaseBundle sandbox provisioning requires the application product version.");
  }
  const installation = await (options.bundleInstaller ?? installAgentSandboxReleaseBundle)({
    baseDir: paths.baseDir,
    productVersion,
    architecture: options.architecture,
    snapshot: microsandbox.Snapshot,
    onProgress: report,
  });
  return {
    images: [installation.manifest.runtimeImage],
    pullPolicy: "never",
  };
}

async function resolveSandboxRegistry(
  workspaceRoot: string,
  registry: AgentSandboxRegistryConfig,
): Promise<ResolvedSandboxRegistry> {
  const authentication = registry.Authentication;
  const certificates = await Promise.all(
    (registry.CertificateFiles ?? []).map((filePath) => readFile(resolveConfiguredPath(workspaceRoot, filePath))),
  );
  if (!authentication || authentication.Kind === "Anonymous") {
    return {
      authentication: authentication ? { kind: "anonymous" } : undefined,
      insecure: registry.Insecure ?? false,
      certificates,
    };
  }
  return {
    authentication: {
      kind: "basic",
      username: requireEnvironmentVariable(authentication.UsernameEnvironmentVariable),
      password: requireEnvironmentVariable(authentication.PasswordEnvironmentVariable),
    },
    insecure: registry.Insecure ?? false,
    certificates,
  };
}

function configureRegistry(builder: MicrosandboxSandboxBuilder, registry: ResolvedSandboxRegistry | undefined): void {
  if (!registry) return;
  builder.registry((configuration) => {
    if (registry.authentication) configuration.auth(registry.authentication);
    if (registry.insecure) configuration.insecure();
    for (const certificate of registry.certificates) configuration.caCerts(certificate);
    return configuration;
  });
}

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Sandbox registry environment variable is not set: ${name}`);
  return value;
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
    const sandbox = await microsandbox.Sandbox.get(sandboxName);
    await sandbox.snapshotTo(snapshotPath);
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

function sumNumbers(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}
