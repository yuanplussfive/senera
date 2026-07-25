import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  AgentSandboxArchiveManifestSchema,
  assertAgentSandboxArchiveManifest,
  readAgentSandboxDistributionContract,
  resolveAgentSandboxBundleLocation,
  type AgentSandboxArchiveManifest,
  type AgentSandboxDistributionContract,
} from "./AgentSandboxDistributionContract.js";
import { AgentSandboxPreparationStages, type AgentSandboxPreparationProgress } from "./AgentSandboxRuntimeTypes.js";
import type { AgentMicrosandboxImageArchiveLoader } from "./AgentMicrosandboxCli.js";

const InstallationReceiptSchema = z
  .object({
    formatVersion: z.literal(4),
    distributionId: z.string().min(1),
    archiveVersion: z.string().min(1),
    target: z.string().min(1),
    sourceImage: z.string().min(1),
    runtimeImage: z.string().min(1),
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

const ProgressByteInterval = 1024 * 1024;
const ProgressTimeIntervalMs = 250;

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
  await writeNewFileAtomically(receiptPath, `${JSON.stringify(expectedReceipt, null, 2)}\n`);
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
  const value = await stat(filePath).catch((error: unknown) => {
    if (nodeErrorCode(error) === "ENOENT") {
      throw new Error(`Sandbox Bundle manifest is missing: ${filePath}`, { cause: error });
    }
    throw error;
  });
  if (!value.isFile()) throw new Error(`Sandbox Bundle manifest is not a file: ${filePath}`);
  if (value.size <= 0 || value.size > maxBytes) {
    throw new Error(`Sandbox Bundle manifest size is invalid: ${value.size} bytes (${filePath}).`);
  }
  return AgentSandboxArchiveManifestSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
}

async function verifyBundleArchive(input: {
  archivePath: string;
  manifest: AgentSandboxArchiveManifest;
  maxBytes: number;
  report: (progress: AgentSandboxPreparationProgress) => void;
  clock: () => number;
}): Promise<void> {
  const value = await stat(input.archivePath).catch((error: unknown) => {
    if (nodeErrorCode(error) === "ENOENT") {
      throw new Error(`Sandbox Bundle archive is missing: ${input.archivePath}`, { cause: error });
    }
    throw error;
  });
  if (!value.isFile()) throw new Error(`Sandbox Bundle archive is not a file: ${input.archivePath}`);
  if (value.size > input.maxBytes || value.size !== input.manifest.asset.sizeBytes) {
    throw new Error(
      `Sandbox Bundle archive size does not match its manifest: ${value.size} !== ${input.manifest.asset.sizeBytes}.`,
    );
  }

  const hash = createHash("sha256");
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
  for await (const chunk of createReadStream(input.archivePath)) {
    hash.update(chunk);
    processedBytes += chunk.byteLength;
    if (
      processedBytes - lastReportedBytes >= ProgressByteInterval ||
      input.clock() - lastReportedAt >= ProgressTimeIntervalMs
    ) {
      publish();
    }
  }
  if (processedBytes !== lastReportedBytes) publish();
  if (hash.digest("hex") !== input.manifest.asset.sha256) {
    throw new Error(`Sandbox Bundle archive failed SHA-256 verification: ${input.archivePath}`);
  }
}

async function readOptionalJson<T>(filePath: string, schema: z.ZodType<T>): Promise<T | undefined> {
  try {
    return schema.parse(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

async function writeNewFileAtomically(filePath: string, content: string): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporaryPath, "wx");
    try {
      await file.writeFile(content, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function createInstallationReceipt(manifest: AgentSandboxArchiveManifest): InstallationReceipt {
  return {
    formatVersion: 4,
    distributionId: manifest.distributionId,
    archiveVersion: manifest.archiveVersion,
    target: manifest.target,
    sourceImage: manifest.sourceImage,
    runtimeImage: manifest.runtimeImage,
    bundleSha256: manifest.asset.sha256,
  };
}

function assertReceipt(actual: InstallationReceipt, expected: InstallationReceipt): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Sandbox Bundle installation receipt does not match the active manifest.");
  }
}

function nodeErrorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}
