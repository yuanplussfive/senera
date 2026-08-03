import { createHash } from "node:crypto";
import { mkdir, open, readFile, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  AgentSandboxArchiveManifestSchema,
  AgentSandboxDistributionFormatVersion,
  assertAgentSandboxArchiveManifest,
  readAgentSandboxDistributionContract,
  resolveAgentSandboxBundleLocation,
  type AgentSandboxArchiveManifest,
  type AgentSandboxDistributionContract,
} from "./AgentSandboxDistributionContract.js";
import { AgentSandboxPreparationStages, type AgentSandboxPreparationProgress } from "./AgentSandboxRuntimeTypes.js";
import type { AgentMicrosandboxImageArchiveLoader } from "./AgentMicrosandboxCli.js";
import { nodeErrorCode, writeFileAtomic } from "../Core/AgentFs.js";
import { parseJsonText } from "../Core/AgentJsonParsing.js";

const InstallationReceiptSchema = z
  .object({
    formatVersion: z.literal(AgentSandboxDistributionFormatVersion),
    distributionId: z.string().min(1),
    archiveVersion: z.string().min(1),
    target: z.string().min(1),
    sourceImage: z.string().min(1),
    runtimeImage: z.string().min(1),
    configDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    bundleSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

type InstallationReceipt = z.infer<typeof InstallationReceiptSchema>;

export interface AgentSandboxArchiveInstallerOptions {
  baseDir: string;
  bundleRoot: string;
  imageArchive: AgentMicrosandboxImageArchiveLoader;
  architecture?: string;
  contract?: AgentSandboxDistributionContract;
  onProgress?: (progress: AgentSandboxPreparationProgress) => void;
  clock?: () => number;
}

export interface AgentSandboxArchiveInstallation {
  manifest: AgentSandboxArchiveManifest;
  archivePath: string;
  imported: boolean;
}

export interface AgentSandboxVerifiedBundle {
  manifest: AgentSandboxArchiveManifest;
  archivePath: string;
}

interface BundleArchiveVerificationInput {
  archivePath: string;
  manifest: AgentSandboxArchiveManifest;
  maxBytes: number;
  report: (progress: AgentSandboxPreparationProgress) => void;
  clock: () => number;
}

const ProgressByteInterval = 1024 * 1024;
const ProgressTimeIntervalMs = 250;
const FileReadChunkBytes = 64 * 1024;

export async function installAgentSandboxBundle(
  options: AgentSandboxArchiveInstallerOptions,
): Promise<AgentSandboxArchiveInstallation> {
  const contract = options.contract ?? readAgentSandboxDistributionContract();
  const location = resolveAgentSandboxBundleLocation(contract, options.architecture);
  const report = options.onProgress ?? (() => undefined);
  const verified = await verifyAgentSandboxBundle(options);
  const { manifest, archivePath } = verified;

  const installationRoot = path.join(
    options.baseDir,
    "archives",
    contract.id,
    contract.archiveVersion,
    location.targetId,
    manifest.asset.sha256,
  );
  const receiptPath = path.join(installationRoot, "installation.json");
  const expectedReceipt = createInstallationReceipt(manifest);
  const receipt = await readOptionalJson(receiptPath, InstallationReceiptSchema);
  if (receipt) {
    assertReceipt(receipt, expectedReceipt);
    return { manifest, archivePath, imported: false };
  }

  await mkdir(installationRoot, { recursive: true });
  report({ stage: AgentSandboxPreparationStages.ImportingImage, item: manifest.asset.fileName });
  await options.imageArchive.load({
    baseDir: options.baseDir,
    archivePath,
    reference: manifest.runtimeImage,
    compression: manifest.asset.compression,
    expectedUncompressedBytes: manifest.asset.uncompressedSizeBytes,
    maxUncompressedBytes: contract.limits.archiveMaxBytes,
  });
  await writeFileAtomic(receiptPath, `${JSON.stringify(expectedReceipt, null, 2)}\n`, { fsync: true });
  return { manifest, archivePath, imported: true };
}

export async function verifyAgentSandboxBundle(
  options: Pick<
    AgentSandboxArchiveInstallerOptions,
    "bundleRoot" | "architecture" | "contract" | "onProgress" | "clock"
  >,
): Promise<AgentSandboxVerifiedBundle> {
  const contract = options.contract ?? readAgentSandboxDistributionContract();
  const location = resolveAgentSandboxBundleLocation(contract, options.architecture);
  const report = options.onProgress ?? (() => undefined);
  const bundleRoot = path.resolve(options.bundleRoot);
  const manifestPath = path.join(bundleRoot, location.manifestFileName);
  report({ stage: AgentSandboxPreparationStages.ResolvingArchive, item: manifestPath });
  const manifest = await readBundleManifest(manifestPath, contract.limits.manifestMaxBytes);
  assertAgentSandboxArchiveManifest(manifest, contract, location.targetId);
  const archivePath = path.join(bundleRoot, manifest.asset.fileName);
  await verifyBundleArchive({
    archivePath,
    manifest,
    maxBytes: contract.limits.bundleMaxBytes,
    report,
    clock: options.clock ?? Date.now,
  });
  return { manifest, archivePath };
}

async function readBundleManifest(filePath: string, maxBytes: number): Promise<AgentSandboxArchiveManifest> {
  const file = await open(filePath, "r").catch((error: unknown) => {
    if (nodeErrorCode(error) === "ENOENT") {
      throw new Error(`Sandbox Bundle manifest is missing: ${filePath}`, { cause: error });
    }
    throw error;
  });
  try {
    const value = await file.stat();
    if (!value.isFile()) throw new Error(`Sandbox Bundle manifest is not a file: ${filePath}`);
    if (value.size <= 0 || value.size > maxBytes) {
      throw new Error(`Sandbox Bundle manifest size is invalid: ${value.size} bytes (${filePath}).`);
    }
    const content = await readFileHandleWithLimit(file, maxBytes);
    if (content.byteLength <= 0 || content.byteLength > maxBytes) {
      throw new Error(`Sandbox Bundle manifest size is invalid: ${content.byteLength} bytes (${filePath}).`);
    }
    return AgentSandboxArchiveManifestSchema.parse(parseJsonText(content.toString("utf8"), "Sandbox bundle manifest"));
  } finally {
    await file.close();
  }
}

async function verifyBundleArchive(input: BundleArchiveVerificationInput): Promise<void> {
  const file = await open(input.archivePath, "r").catch((error: unknown) => {
    if (nodeErrorCode(error) === "ENOENT") {
      throw new Error(`Sandbox Bundle archive is missing: ${input.archivePath}`, { cause: error });
    }
    throw error;
  });
  try {
    const value = await file.stat();
    if (!value.isFile()) throw new Error(`Sandbox Bundle archive is not a file: ${input.archivePath}`);
    if (value.size > input.maxBytes || value.size !== input.manifest.asset.sizeBytes) {
      throw archiveSizeMismatch(input, value.size);
    }

    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(FileReadChunkBytes);
    let processedBytes = 0;
    let lastReportedBytes = 0;
    let lastReportedAt = input.clock();
    const publish = (): void => {
      input.report({
        stage: AgentSandboxPreparationStages.VerifyingArchive,
        item: input.manifest.asset.fileName,
        downloadedBytes: processedBytes,
        totalBytes: input.manifest.asset.sizeBytes,
      });
      lastReportedBytes = processedBytes;
      lastReportedAt = input.clock();
    };
    publish();
    while (true) {
      const { bytesRead } = await file.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      processedBytes += bytesRead;
      if (processedBytes > input.maxBytes || processedBytes > input.manifest.asset.sizeBytes) {
        throw archiveSizeMismatch(input, processedBytes);
      }
      hash.update(buffer.subarray(0, bytesRead));
      if (
        processedBytes - lastReportedBytes >= ProgressByteInterval ||
        input.clock() - lastReportedAt >= ProgressTimeIntervalMs
      ) {
        publish();
      }
    }
    if (processedBytes !== input.manifest.asset.sizeBytes) {
      throw archiveSizeMismatch(input, processedBytes);
    }
    if (processedBytes !== lastReportedBytes) publish();
    if (hash.digest("hex") !== input.manifest.asset.sha256) {
      throw new Error(`Sandbox Bundle archive failed SHA-256 verification: ${input.archivePath}`);
    }
  } finally {
    await file.close();
  }
}

async function readFileHandleWithLimit(file: FileHandle, maxBytes: number): Promise<Buffer> {
  const content = Buffer.allocUnsafe(maxBytes + 1);
  let offset = 0;
  while (offset < content.byteLength) {
    const { bytesRead } = await file.read(content, offset, content.byteLength - offset, null);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  return content.subarray(0, offset);
}

function archiveSizeMismatch(
  input: Pick<BundleArchiveVerificationInput, "archivePath" | "manifest">,
  actualBytes: number,
): Error {
  return new Error(
    `Sandbox Bundle archive size does not match its manifest: ${actualBytes} !== ${input.manifest.asset.sizeBytes} (${input.archivePath}).`,
  );
}

async function readOptionalJson<T>(filePath: string, schema: z.ZodType<T>): Promise<T | undefined> {
  try {
    return schema.parse(parseJsonText(await readFile(filePath, "utf8"), "Sandbox installation receipt"));
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

function createInstallationReceipt(manifest: AgentSandboxArchiveManifest): InstallationReceipt {
  return {
    formatVersion: AgentSandboxDistributionFormatVersion,
    distributionId: manifest.distributionId,
    archiveVersion: manifest.archiveVersion,
    target: manifest.target,
    sourceImage: manifest.sourceImage,
    runtimeImage: manifest.runtimeImage,
    configDigest: manifest.configDigest,
    bundleSha256: manifest.asset.sha256,
  };
}

function assertReceipt(actual: InstallationReceipt, expected: InstallationReceipt): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Sandbox Bundle installation receipt does not match the active manifest.");
  }
}
