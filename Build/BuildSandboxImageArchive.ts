import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { link, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isMainModule } from "../Source/AgentSystem/Core/AgentPath.js";
import {
  AgentSandboxArchiveManifestSchema,
  assertAgentSandboxArchiveManifest,
  readAgentSandboxDistributionContract,
  resolveAgentSandboxReleaseLocation,
  type AgentSandboxArchiveManifest,
  type AgentSandboxDistributionContract,
} from "../Source/AgentSystem/Sandbox/AgentSandboxDistributionContract.js";
import { resolveAgentMicrosandboxPackage } from "../Source/AgentSystem/Sandbox/AgentMicrosandboxCli.js";
import {
  createMicrosandboxDistributionRuntime,
  type MicrosandboxDistributionRuntime,
} from "./MicrosandboxDistributionRuntime.js";
import { readProductReleaseInfo } from "./ProductReleaseInfo.js";

export interface BuildSandboxImageArchiveOptions {
  workspaceRoot: string;
  outputRoot: string;
  productVersion: string;
  architecture?: string;
  contract?: AgentSandboxDistributionContract;
  runtime?: MicrosandboxDistributionRuntime;
  log?: (message: string) => void;
}

export interface SandboxImageArchiveBuildResult {
  archivePath: string;
  manifestPath: string;
  manifest: AgentSandboxArchiveManifest;
}

if (isMainModule(import.meta.url)) {
  const workspaceRoot = process.cwd();
  const release = readProductReleaseInfo({ workspaceRoot });
  const outputRoot = resolveOutputRoot(workspaceRoot, process.argv.slice(2));
  const result = await buildSandboxImageArchive({
    workspaceRoot,
    outputRoot,
    productVersion: release.version,
    log: (message) => process.stdout.write(`${message}\n`),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export async function buildSandboxImageArchive(
  options: BuildSandboxImageArchiveOptions,
): Promise<SandboxImageArchiveBuildResult> {
  const contract = options.contract ?? readAgentSandboxDistributionContract();
  const location = resolveAgentSandboxReleaseLocation(contract, options.productVersion, options.architecture);
  await assertMicrosandboxVersion(contract.microsandboxVersion);
  await mkdir(options.outputRoot, { recursive: true });

  const archivePath = path.join(options.outputRoot, location.target.archive.assetName);
  const manifestPath = path.join(options.outputRoot, contract.release.manifestAssetName);
  const stagingArchivePath = path.join(
    options.outputRoot,
    `.${location.target.archive.assetName}.${process.pid}.${randomUUID()}.tmp`,
  );
  await assertOutputsAbsent([archivePath, manifestPath]);

  let sourceRuntimeRoot: string | undefined = await mkdtemp(path.join(os.tmpdir(), "senera-sandbox-image-source-"));
  const verificationRuntimeRoot = await mkdtemp(path.join(os.tmpdir(), "senera-sandbox-image-verification-"));
  const buildId = randomUUID().replaceAll("-", "").slice(0, 16);
  try {
    const runtime =
      options.runtime ??
      createMicrosandboxDistributionRuntime({ workspaceRoot: options.workspaceRoot, log: options.log });

    await runtime.prepareImage({
      baseDir: sourceRuntimeRoot,
      reference: location.target.sourceImage,
      sandboxName: `senera-image-source-${buildId}`,
      pullPolicy: "if-missing",
      probe: location.target.probe,
    });
    await runtime.saveOciImage({
      baseDir: sourceRuntimeRoot,
      reference: location.target.sourceImage,
      outputPath: stagingArchivePath,
    });
    const archiveStat = await stat(stagingArchivePath);
    if (!archiveStat.isFile() || archiveStat.size <= 0) {
      throw new Error(`Microsandbox did not produce a valid OCI image archive: ${stagingArchivePath}`);
    }
    if (archiveStat.size > contract.downloadPolicy.archiveMaxBytes) {
      throw new Error(`Sandbox image archive exceeds the distribution limit: ${archiveStat.size} bytes.`);
    }

    // Verification must have no access to the cache that produced the archive.
    await rm(sourceRuntimeRoot, { recursive: true, force: true });
    sourceRuntimeRoot = undefined;

    await runtime.loadOciImage({
      baseDir: verificationRuntimeRoot,
      archivePath: stagingArchivePath,
      reference: location.target.runtimeImage,
    });
    await runtime.prepareImage({
      baseDir: verificationRuntimeRoot,
      reference: location.target.runtimeImage,
      sandboxName: `senera-image-verification-${buildId}`,
      pullPolicy: "never",
      probe: location.target.probe,
    });

    const manifest = AgentSandboxArchiveManifestSchema.parse({
      formatVersion: 3,
      distributionId: contract.id,
      archiveVersion: contract.archiveVersion,
      productVersion: options.productVersion,
      microsandboxVersion: contract.microsandboxVersion,
      target: location.targetId,
      sourceImage: location.target.sourceImage,
      runtimeImage: location.target.runtimeImage,
      asset: {
        format: location.target.archive.format,
        mediaType: location.target.archive.mediaType,
        fileName: location.target.archive.assetName,
        url: location.archiveUrl,
        sizeBytes: archiveStat.size,
        sha256: await sha256File(stagingArchivePath),
      },
    });
    assertAgentSandboxArchiveManifest(manifest, contract, options.productVersion, location);
    await publishFile(stagingArchivePath, archivePath);
    await writeFileAtomically(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return { archivePath, manifestPath, manifest };
  } finally {
    await Promise.all([
      sourceRuntimeRoot ? rm(sourceRuntimeRoot, { recursive: true, force: true }) : Promise.resolve(),
      rm(verificationRuntimeRoot, { recursive: true, force: true }),
      rm(stagingArchivePath, { force: true }),
    ]);
  }
}

async function assertMicrosandboxVersion(expectedVersion: string): Promise<void> {
  const microsandboxPackage = await resolveAgentMicrosandboxPackage();
  if (microsandboxPackage.version !== expectedVersion) {
    throw new Error(
      `Sandbox distribution requires microsandbox ${expectedVersion}, received ${microsandboxPackage.version}: ${microsandboxPackage.rootPath}`,
    );
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
  return path.resolve(workspaceRoot, configured || path.join("Release", "SandboxImage"));
}
