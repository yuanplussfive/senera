import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { SandboxStatus } from "microsandbox";
import type { SeneraMicrosandboxModuleLoader } from "../Execution/SeneraMicrosandboxSdkAdapter.js";
import type { ResolvedAgentSandboxRuntimeConfig } from "../Types/AgentConfigTypes.js";
import type { AgentSandboxRegistryConfig } from "../Types/AgentRuntimeConfigTypes.js";
import { installAgentSandboxBundle } from "./AgentSandboxArchiveInstaller.js";
import {
  createAgentMicrosandboxCli,
  createAgentMicrosandboxImageArchive,
  type AgentMicrosandboxImageArchiveLoader,
  type AgentMicrosandboxPackageEntryResolver,
} from "./AgentMicrosandboxCli.js";
import { normalizeSandboxImages } from "./AgentSandboxRuntimeImages.js";
import { AgentSandboxPreparationStages, type AgentSandboxPreparationProgress } from "./AgentSandboxRuntimeTypes.js";

export { normalizeSandboxImages } from "./AgentSandboxRuntimeImages.js";

export interface AgentSandboxRuntimePaths {
  baseDir: string;
}

export interface AgentSandboxRuntimePreparationOptions {
  workspaceRoot: string;
  config: Pick<ResolvedAgentSandboxRuntimeConfig, "Enabled" | "BaseDir" | "Provisioning">;
  sandboxBundleRoot?: string;
  architecture?: string;
  microsandbox?: MicrosandboxModule;
  microsandboxModuleLoader?: SeneraMicrosandboxModuleLoader;
  microsandboxPackageEntryResolver?: AgentMicrosandboxPackageEntryResolver;
  imageArchive?: AgentMicrosandboxImageArchiveLoader;
  archiveInstaller?: typeof installAgentSandboxBundle;
  log?: (message: string) => void;
  onProgress?: (progress: AgentSandboxPreparationProgress) => void;
}

export interface AgentSandboxRuntimePreparationResult {
  paths: AgentSandboxRuntimePaths;
  preparedImages: string[];
}

export interface MicrosandboxModule {
  Sandbox: {
    builder(name: string): MicrosandboxSandboxBuilder;
    listWith(filter: { labels: Record<string, string> }): Promise<MicrosandboxSandboxHandle[]>;
    remove(name: string): Promise<void>;
  };
}

export interface MicrosandboxSandboxHandle {
  name: string;
  status: SandboxStatus;
}

export interface MicrosandboxSandboxBuilder {
  image(image: string): this;
  registry(configure: (registry: MicrosandboxRegistryConfigBuilder) => MicrosandboxRegistryConfigBuilder): this;
  pullPolicy(policy: string): this;
  cpus(value: number): this;
  memory(value: number): this;
  ephemeral(enabled: boolean): this;
  labels(labels: Record<string, string>): this;
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

const SandboxPreparationPolicy = {
  namePrefix: "senera-sandbox-prepare",
  cpus: 1,
  memoryMiB: 256,
  maxDurationSeconds: 60,
  stopTimeoutMs: 1_000,
  labels: {
    "senera.owner": "senera",
    "senera.purpose": "runtime-preparation",
  },
} as const;

const ReclaimableSandboxStatuses: ReadonlySet<SandboxStatus> = new Set(["stopped", "crashed"]);

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
  await reclaimPreparedSandboxes(microsandbox);

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
  const name = `${SandboxPreparationPolicy.namePrefix}-${safeImageName(image)}-${process.pid}`;
  let sandbox: MicrosandboxSandbox | undefined;
  let sandboxCreation: Promise<MicrosandboxSandbox> | undefined;
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
      .cpus(SandboxPreparationPolicy.cpus)
      .memory(SandboxPreparationPolicy.memoryMiB)
      .ephemeral(false)
      .labels({ ...SandboxPreparationPolicy.labels })
      .replace()
      .quietLogs()
      .disableMetricsSample()
      .disableNetwork()
      .maxDuration(SandboxPreparationPolicy.maxDurationSeconds)
      .createWithPullProgress();
    sandboxCreation = creation.awaitSandbox().then((createdSandbox) => {
      sandbox = createdSandbox;
      return createdSandbox;
    });
    await Promise.all([sandboxCreation, consumeImagePullProgress(creation, image, imageIndex, imageCount, report)]);
    report({
      stage: AgentSandboxPreparationStages.WarmingImage,
      item: image,
      completed: imageIndex + 1,
      total: imageCount,
    });
  } finally {
    await sandboxCreation?.catch(() => undefined);
    await removePreparedSandbox(microsandbox, sandbox);
  }
}

async function reclaimPreparedSandboxes(microsandbox: MicrosandboxModule): Promise<void> {
  const sandboxes = await microsandbox.Sandbox.listWith({ labels: { ...SandboxPreparationPolicy.labels } });
  await Promise.all(
    sandboxes
      .filter((sandbox) => ReclaimableSandboxStatuses.has(sandbox.status))
      .map((sandbox) => microsandbox.Sandbox.remove(sandbox.name)),
  );
}

async function removePreparedSandbox(
  microsandbox: MicrosandboxModule,
  sandbox: MicrosandboxSandbox | undefined,
): Promise<void> {
  if (!sandbox) return;
  try {
    await sandbox.stopWithTimeout(SandboxPreparationPolicy.stopTimeoutMs);
  } catch (stopError) {
    try {
      await sandbox.kill();
    } catch (killError) {
      throw new AggregateError([stopError, killError], `Failed to stop preparation sandbox ${sandbox.name}.`, {
        cause: killError,
      });
    }
  }
  await microsandbox.Sandbox.remove(sandbox.name);
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

  const sandboxBundleRoot = options.sandboxBundleRoot?.trim();
  if (!sandboxBundleRoot) {
    throw new Error("ReleaseBundle sandbox provisioning requires a trusted local Bundle root.");
  }
  const imageArchive =
    options.imageArchive ??
    createAgentMicrosandboxImageArchive(
      createAgentMicrosandboxCli({
        cwd: options.workspaceRoot,
        packageEntryResolver: options.microsandboxPackageEntryResolver,
      }),
    );
  const installation = await (options.archiveInstaller ?? installAgentSandboxBundle)({
    baseDir: paths.baseDir,
    bundleRoot: resolveConfiguredPath(options.workspaceRoot, sandboxBundleRoot),
    architecture: options.architecture,
    imageArchive,
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
