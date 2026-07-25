import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { link, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { constants as zlibConstants, createGzip } from "node:zlib";
import { isMainModule } from "../Source/AgentSystem/Core/AgentPath.js";
import {
  AgentSandboxArchiveManifestSchema,
  assertAgentSandboxArchiveManifest,
  readAgentSandboxDistributionContract,
  resolveAgentSandboxBundleLocation,
  type AgentSandboxArchiveManifest,
  type AgentSandboxDistributionContract,
} from "../Source/AgentSystem/Sandbox/AgentSandboxDistributionContract.js";
import { resolveAgentMicrosandboxPackage } from "../Source/AgentSystem/Sandbox/AgentMicrosandboxCli.js";
import {
  createMicrosandboxDistributionRuntime,
  type MicrosandboxDistributionRuntime,
} from "./MicrosandboxDistributionRuntime.js";

export interface BuildSandboxImageArchiveOptions {
  workspaceRoot: string;
  outputRoot: string;
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
  const outputRoot = resolveOutputRoot(workspaceRoot, process.argv.slice(2));
  const result = await buildSandboxImageArchive({
    workspaceRoot,
    outputRoot,
    log: (message) => process.stdout.write(`${message}\n`),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export async function buildSandboxImageArchive(
  options: BuildSandboxImageArchiveOptions,
): Promise<SandboxImageArchiveBuildResult> {
  const contract = options.contract ?? readAgentSandboxDistributionContract();
  const location = resolveAgentSandboxBundleLocation(contract, options.architecture);
  await assertMicrosandboxVersion(contract.microsandboxVersion);
  await mkdir(options.outputRoot, { recursive: true });

  const archivePath = path.join(options.outputRoot, location.archiveFileName);
  const manifestPath = path.join(options.outputRoot, location.manifestFileName);
  const stagingBundlePath = path.join(
    options.outputRoot,
    `.${location.archiveFileName}.${process.pid}.${randomUUID()}.tmp`,
  );
  await assertOutputsAbsent([archivePath, manifestPath]);

  let sourceRuntimeRoot: string | undefined = await mkdtemp(path.join(os.tmpdir(), "senera-sandbox-image-source-"));
  const verificationRuntimeRoot = await mkdtemp(path.join(os.tmpdir(), "senera-sandbox-image-verification-"));
  const archiveStagingRoot = await mkdtemp(path.join(os.tmpdir(), "senera-sandbox-image-archive-"));
  const rawArchivePath = path.join(archiveStagingRoot, "image.oci.tar");
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
      outputPath: rawArchivePath,
    });
    const rawArchiveStat = await requireFileWithinLimit(
      rawArchivePath,
      contract.limits.archiveMaxBytes,
      "uncompressed OCI archive",
    );
    options.log?.(`Compressing sandbox OCI archive as ${location.target.archive.compression}...`);
    await compressArchive(rawArchivePath, stagingBundlePath, location.target.archive.compression);
    const bundleStat = await requireFileWithinLimit(
      stagingBundlePath,
      contract.limits.bundleMaxBytes,
      "compressed Sandbox Bundle",
    );

    // Verification must have no access to the cache or raw archive that produced the Bundle.
    await rm(sourceRuntimeRoot, { recursive: true, force: true });
    sourceRuntimeRoot = undefined;
    await rm(rawArchivePath, { force: true });

    await runtime.loadOciImage({
      baseDir: verificationRuntimeRoot,
      archivePath: stagingBundlePath,
      reference: location.target.runtimeImage,
      compression: location.target.archive.compression,
      expectedUncompressedBytes: rawArchiveStat.size,
      maxUncompressedBytes: contract.limits.archiveMaxBytes,
    });
    await runtime.prepareImage({
      baseDir: verificationRuntimeRoot,
      reference: location.target.runtimeImage,
      sandboxName: `senera-image-verification-${buildId}`,
      pullPolicy: "never",
      probe: location.target.probe,
    });

    const manifest = AgentSandboxArchiveManifestSchema.parse({
      formatVersion: 4,
      distributionId: contract.id,
      archiveVersion: contract.archiveVersion,
      microsandboxVersion: contract.microsandboxVersion,
      target: location.targetId,
      sourceImage: location.target.sourceImage,
      runtimeImage: location.target.runtimeImage,
      asset: {
        format: location.target.archive.format,
        mediaType: location.target.archive.mediaType,
        compression: location.target.archive.compression,
        compressedMediaType: location.target.archive.compressedMediaType,
        fileName: location.archiveFileName,
        sizeBytes: bundleStat.size,
        uncompressedSizeBytes: rawArchiveStat.size,
        sha256: await sha256File(stagingBundlePath),
      },
    });
    assertAgentSandboxArchiveManifest(manifest, contract, location.targetId);
    await publishFile(stagingBundlePath, archivePath);
    await writeFileAtomically(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return { archivePath, manifestPath, manifest };
  } finally {
    await Promise.all([
      sourceRuntimeRoot ? rm(sourceRuntimeRoot, { recursive: true, force: true }) : Promise.resolve(),
      rm(verificationRuntimeRoot, { recursive: true, force: true }),
      rm(archiveStagingRoot, { recursive: true, force: true }),
      rm(stagingBundlePath, { force: true }),
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

async function compressArchive(sourcePath: string, targetPath: string, compression: "gzip"): Promise<void> {
  switch (compression) {
    case "gzip":
      await pipeline(
        createReadStream(sourcePath),
        createGzip({ level: zlibConstants.Z_BEST_COMPRESSION }),
        createWriteStream(targetPath, { flags: "wx" }),
      );
      return;
  }
}

async function requireFileWithinLimit(filePath: string, maxBytes: number, label: string) {
  const value = await stat(filePath);
  if (!value.isFile() || value.size <= 0) {
    throw new Error(`Microsandbox did not produce a valid ${label}: ${filePath}`);
  }
  if (value.size > maxBytes) {
    throw new Error(`Sandbox ${label} exceeds the distribution limit: ${value.size} bytes.`);
  }
  return value;
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
    throw new Error(`Sandbox Bundle output already exists: ${filePath}`);
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
