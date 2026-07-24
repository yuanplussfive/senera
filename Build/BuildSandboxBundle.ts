import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { link, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isMainModule } from "../Source/AgentSystem/Core/AgentPath.js";
import {
  AgentSandboxBundleManifestSchema,
  assertAgentSandboxBundleManifest,
  readAgentSandboxDistributionContract,
  resolveAgentSandboxReleaseLocation,
  type AgentSandboxBundleManifest,
  type AgentSandboxDistributionContract,
} from "../Source/AgentSystem/Sandbox/AgentSandboxDistributionContract.js";
import {
  createMicrosandboxDistributionRuntime,
  type MicrosandboxDistributionRuntime,
} from "./MicrosandboxDistributionRuntime.js";
import { readProductReleaseInfo } from "./ProductReleaseInfo.js";

export interface BuildSandboxBundleOptions {
  workspaceRoot: string;
  outputRoot: string;
  productVersion: string;
  architecture?: string;
  contract?: AgentSandboxDistributionContract;
  runtime?: MicrosandboxDistributionRuntime;
  log?: (message: string) => void;
}

export interface SandboxBundleBuildResult {
  bundlePath: string;
  manifestPath: string;
  manifest: AgentSandboxBundleManifest;
}

if (isMainModule(import.meta.url)) {
  const workspaceRoot = process.cwd();
  const release = readProductReleaseInfo({ workspaceRoot });
  const outputRoot = resolveOutputRoot(workspaceRoot, process.argv.slice(2));
  const result = await buildSandboxBundle({
    workspaceRoot,
    outputRoot,
    productVersion: release.version,
    log: (message) => process.stdout.write(`${message}\n`),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export async function buildSandboxBundle(options: BuildSandboxBundleOptions): Promise<SandboxBundleBuildResult> {
  const contract = options.contract ?? readAgentSandboxDistributionContract();
  const location = resolveAgentSandboxReleaseLocation(contract, options.productVersion, options.architecture);
  await assertMicrosandboxVersion(options.workspaceRoot, contract.microsandboxVersion);
  await mkdir(options.outputRoot, { recursive: true });

  const stagingBundlePath = path.join(
    options.outputRoot,
    `.${location.target.bundleAssetName}.${process.pid}.${randomUUID()}.tmp`,
  );
  const bundlePath = path.join(options.outputRoot, location.target.bundleAssetName);
  const manifestPath = path.join(options.outputRoot, contract.release.manifestAssetName);
  await assertOutputsAbsent([bundlePath, manifestPath]);
  const sourceRuntimeRoot = await mkdtemp(path.join(os.tmpdir(), "senera-sandbox-bundle-source-"));
  const normalizedRuntimeRoot = await mkdtemp(path.join(os.tmpdir(), "senera-sandbox-bundle-normalized-"));
  const verificationRuntimeRoot = await mkdtemp(path.join(os.tmpdir(), "senera-sandbox-bundle-verification-"));
  const snapshotRoot = await mkdtemp(path.join(os.tmpdir(), "senera-sandbox-bundle-snapshot-"));
  const imageArchivePath = path.join(
    options.outputRoot,
    `.${location.target.bundleAssetName}.${process.pid}.${randomUUID()}.oci.tar`,
  );
  const buildId = randomUUID().replaceAll("-", "").slice(0, 16);
  const sourceSandboxName = `senera-bundle-source-${buildId}`;
  const normalizedSandboxName = `senera-bundle-normalized-${buildId}`;
  const verificationSandboxName = `senera-bundle-verification-${buildId}`;
  try {
    const runtime =
      options.runtime ??
      createMicrosandboxDistributionRuntime({ workspaceRoot: options.workspaceRoot, log: options.log });

    await runtime.prepareImage({
      baseDir: sourceRuntimeRoot,
      reference: location.target.sourceImage,
      sandboxName: sourceSandboxName,
      pullPolicy: "if-missing",
      probe: location.target.probe,
    });
    await runtime.saveOciImage({
      baseDir: sourceRuntimeRoot,
      reference: location.target.sourceImage,
      outputPath: imageArchivePath,
    });
    await runtime.loadOciImage({
      baseDir: normalizedRuntimeRoot,
      archivePath: imageArchivePath,
      reference: location.target.runtimeImage,
    });
    await runtime.prepareImage({
      baseDir: normalizedRuntimeRoot,
      reference: location.target.runtimeImage,
      sandboxName: normalizedSandboxName,
      pullPolicy: "never",
      probe: location.target.probe,
    });
    await runtime.exportSandboxBundle({
      baseDir: normalizedRuntimeRoot,
      sandboxName: normalizedSandboxName,
      snapshotPath: path.join(snapshotRoot, "snapshot"),
      outputPath: stagingBundlePath,
    });
    const bundleStat = await stat(stagingBundlePath);
    if (!bundleStat.isFile() || bundleStat.size <= 0) {
      throw new Error(`Microsandbox did not produce a valid bundle: ${stagingBundlePath}`);
    }
    if (bundleStat.size > contract.downloadPolicy.bundleMaxBytes) {
      throw new Error(`Sandbox bundle exceeds the distribution limit: ${bundleStat.size} bytes.`);
    }
    await runtime.importSandboxBundle({
      baseDir: verificationRuntimeRoot,
      bundlePath: stagingBundlePath,
    });
    await runtime.prepareImage({
      baseDir: verificationRuntimeRoot,
      reference: location.target.runtimeImage,
      sandboxName: verificationSandboxName,
      pullPolicy: "never",
      probe: location.target.probe,
    });

    const manifest = AgentSandboxBundleManifestSchema.parse({
      formatVersion: 2,
      distributionId: contract.id,
      bundleVersion: contract.bundleVersion,
      productVersion: options.productVersion,
      microsandboxVersion: contract.microsandboxVersion,
      target: location.targetId,
      sourceImage: location.target.sourceImage,
      runtimeImage: location.target.runtimeImage,
      asset: {
        fileName: location.target.bundleAssetName,
        url: location.bundleUrl,
        sizeBytes: bundleStat.size,
        sha256: await sha256File(stagingBundlePath),
      },
    });
    assertAgentSandboxBundleManifest(manifest, contract, options.productVersion, location);
    await publishFile(stagingBundlePath, bundlePath);
    await writeFileAtomically(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return { bundlePath, manifestPath, manifest };
  } finally {
    await Promise.all([
      rm(sourceRuntimeRoot, { recursive: true, force: true }),
      rm(normalizedRuntimeRoot, { recursive: true, force: true }),
      rm(verificationRuntimeRoot, { recursive: true, force: true }),
      rm(snapshotRoot, { recursive: true, force: true }),
      rm(imageArchivePath, { force: true }),
      rm(stagingBundlePath, { force: true }),
    ]);
  }
}

async function assertMicrosandboxVersion(workspaceRoot: string, expectedVersion: string): Promise<void> {
  const packagePath = path.join(workspaceRoot, "node_modules", "microsandbox", "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as unknown;
  if (!isRecord(packageJson) || packageJson.version !== expectedVersion) {
    throw new Error(`Sandbox distribution requires microsandbox ${expectedVersion}: ${packagePath}`);
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function publishFile(sourcePath: string, targetPath: string): Promise<void> {
  await link(sourcePath, targetPath);
  await rm(sourcePath);
}

async function writeFileAtomically(filePath: string, content: string): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" });
    await publishFile(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function assertOutputsAbsent(filePaths: readonly string[]): Promise<void> {
  for (const filePath of filePaths) {
    try {
      await stat(filePath);
    } catch (error) {
      if (nodeErrorCode(error) === "ENOENT") continue;
      throw error;
    }
    throw new Error(`Sandbox release output already exists: ${filePath}`);
  }
}

function nodeErrorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function resolveOutputRoot(workspaceRoot: string, arguments_: readonly string[]): string {
  const outputIndex = arguments_.indexOf("--output");
  const configured = outputIndex >= 0 ? arguments_[outputIndex + 1]?.trim() : undefined;
  return path.resolve(workspaceRoot, configured || path.join("Release", "SandboxBundle"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
