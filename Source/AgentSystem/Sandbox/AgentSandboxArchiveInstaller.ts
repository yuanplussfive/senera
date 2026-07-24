import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  AgentSandboxArchiveManifestSchema,
  assertAgentSandboxArchiveManifest,
  readAgentSandboxDistributionContract,
  resolveAgentSandboxReleaseLocation,
  type AgentSandboxArchiveManifest,
  type AgentSandboxDistributionContract,
} from "./AgentSandboxDistributionContract.js";
import { AgentSandboxPreparationStages, type AgentSandboxPreparationProgress } from "./AgentSandboxRuntimeTypes.js";
import type { AgentMicrosandboxImageArchiveLoader } from "./AgentMicrosandboxCli.js";

const InstallationReceiptSchema = z
  .object({
    formatVersion: z.literal(3),
    distributionId: z.string().min(1),
    archiveVersion: z.string().min(1),
    productVersion: z.string().min(1),
    target: z.string().min(1),
    sourceImage: z.string().min(1),
    runtimeImage: z.string().min(1),
    archiveSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

type InstallationReceipt = z.infer<typeof InstallationReceiptSchema>;

export interface AgentSandboxArchiveInstallerOptions {
  baseDir: string;
  productVersion: string;
  imageArchive: AgentMicrosandboxImageArchiveLoader;
  architecture?: string;
  contract?: AgentSandboxDistributionContract;
  fetch?: typeof globalThis.fetch;
  onProgress?: (progress: AgentSandboxPreparationProgress) => void;
}

export interface AgentSandboxArchiveInstallation {
  manifest: AgentSandboxArchiveManifest;
  archivePath: string;
  imported: boolean;
}

export async function installAgentSandboxReleaseArchive(
  options: AgentSandboxArchiveInstallerOptions,
): Promise<AgentSandboxArchiveInstallation> {
  const contract = options.contract ?? readAgentSandboxDistributionContract();
  const location = resolveAgentSandboxReleaseLocation(contract, options.productVersion, options.architecture);
  const report = options.onProgress ?? (() => undefined);
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const installationRoot = path.join(
    options.baseDir,
    "archives",
    contract.id,
    contract.archiveVersion,
    options.productVersion,
    location.targetId,
  );
  const manifestPath = path.join(installationRoot, contract.release.manifestAssetName);
  const archivePath = path.join(installationRoot, location.target.archive.assetName);
  const receiptPath = path.join(installationRoot, "installation.json");

  await mkdir(installationRoot, { recursive: true });
  report({ stage: AgentSandboxPreparationStages.ResolvingArchive, item: location.manifestUrl });
  const manifest = await loadOrDownloadManifest({
    manifestPath,
    manifestUrl: location.manifestUrl,
    contract,
    productVersion: options.productVersion,
    location,
    fetchImplementation,
    requestTimeoutMs: contract.downloadPolicy.requestTimeoutMs,
  });
  await ensureArchive({
    archivePath,
    manifest,
    maxBytes: contract.downloadPolicy.archiveMaxBytes,
    requestTimeoutMs: contract.downloadPolicy.requestTimeoutMs,
    fetchImplementation,
    report,
  });

  const expectedReceipt = createInstallationReceipt(manifest);
  const receipt = await readOptionalJson(receiptPath, InstallationReceiptSchema);
  if (receipt) {
    assertReceipt(receipt, expectedReceipt);
    return { manifest, archivePath, imported: false };
  }

  report({ stage: AgentSandboxPreparationStages.ImportingImage, item: manifest.asset.fileName });
  await options.imageArchive.load({
    baseDir: options.baseDir,
    archivePath,
    reference: manifest.runtimeImage,
  });
  await writeNewFileAtomically(receiptPath, `${JSON.stringify(expectedReceipt, null, 2)}\n`);
  return { manifest, archivePath, imported: true };
}

async function loadOrDownloadManifest(input: {
  manifestPath: string;
  manifestUrl: string;
  contract: AgentSandboxDistributionContract;
  productVersion: string;
  location: ReturnType<typeof resolveAgentSandboxReleaseLocation>;
  fetchImplementation: typeof globalThis.fetch;
  requestTimeoutMs: number;
}): Promise<AgentSandboxArchiveManifest> {
  const cached = await readOptionalJson(input.manifestPath, AgentSandboxArchiveManifestSchema);
  if (cached) {
    assertAgentSandboxArchiveManifest(cached, input.contract, input.productVersion, input.location);
    return cached;
  }

  const response = await input.fetchImplementation(input.manifestUrl, {
    redirect: "follow",
    signal: AbortSignal.timeout(input.requestTimeoutMs),
  });
  assertSecureResponse(response, input.manifestUrl);
  const content = await readBoundedResponse(response, input.contract.downloadPolicy.manifestMaxBytes);
  const manifest = AgentSandboxArchiveManifestSchema.parse(JSON.parse(content.toString("utf8")));
  assertAgentSandboxArchiveManifest(manifest, input.contract, input.productVersion, input.location);
  await writeNewFileAtomically(input.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function ensureArchive(input: {
  archivePath: string;
  manifest: AgentSandboxArchiveManifest;
  maxBytes: number;
  requestTimeoutMs: number;
  fetchImplementation: typeof globalThis.fetch;
  report: (progress: AgentSandboxPreparationProgress) => void;
}): Promise<void> {
  const existing = await optionalFileSize(input.archivePath);
  if (existing !== undefined) {
    if (existing !== input.manifest.asset.sizeBytes) {
      throw new Error(`Cached sandbox image archive has an unexpected size: ${input.archivePath}`);
    }
    input.report({
      stage: AgentSandboxPreparationStages.VerifyingArchive,
      item: input.manifest.asset.fileName,
      downloadedBytes: existing,
      totalBytes: input.manifest.asset.sizeBytes,
    });
    const digest = await sha256File(input.archivePath);
    if (digest !== input.manifest.asset.sha256) {
      throw new Error(`Cached sandbox image archive failed SHA-256 verification: ${input.archivePath}`);
    }
    return;
  }

  if (input.manifest.asset.sizeBytes > input.maxBytes) {
    throw new Error(
      `Sandbox image archive exceeds the declared download limit: ${input.manifest.asset.sizeBytes} bytes.`,
    );
  }
  const response = await input.fetchImplementation(input.manifest.asset.url, {
    redirect: "follow",
    signal: AbortSignal.timeout(input.requestTimeoutMs),
  });
  assertSecureResponse(response, input.manifest.asset.url);
  assertContentLength(response, input.manifest.asset.sizeBytes, input.maxBytes);

  const temporaryPath = `${input.archivePath}.${process.pid}.${randomUUID()}.download`;
  const file = await open(temporaryPath, "wx");
  const hash = createHash("sha256");
  let downloadedBytes = 0;
  let complete = false;
  try {
    const reader = response.body?.getReader();
    if (!reader) throw new Error(`Sandbox image archive response has no body: ${input.manifest.asset.url}`);
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      downloadedBytes += chunk.value.byteLength;
      if (downloadedBytes > input.maxBytes || downloadedBytes > input.manifest.asset.sizeBytes) {
        throw new Error(`Sandbox image archive download exceeded its declared size: ${input.manifest.asset.url}`);
      }
      hash.update(chunk.value);
      await file.write(chunk.value);
      input.report({
        stage: AgentSandboxPreparationStages.DownloadingArchive,
        item: input.manifest.asset.fileName,
        downloadedBytes,
        totalBytes: input.manifest.asset.sizeBytes,
      });
    }
    await file.sync();
    if (downloadedBytes !== input.manifest.asset.sizeBytes) {
      throw new Error(`Sandbox image archive download size does not match its manifest: ${input.manifest.asset.url}`);
    }
    input.report({
      stage: AgentSandboxPreparationStages.VerifyingArchive,
      item: input.manifest.asset.fileName,
      downloadedBytes,
      totalBytes: input.manifest.asset.sizeBytes,
    });
    if (hash.digest("hex") !== input.manifest.asset.sha256) {
      throw new Error(`Downloaded sandbox image archive failed SHA-256 verification: ${input.manifest.asset.url}`);
    }
    complete = true;
  } finally {
    await file.close();
    if (!complete) await rm(temporaryPath, { force: true });
  }
  try {
    await rename(temporaryPath, input.archivePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<Buffer> {
  assertContentLength(response, undefined, maxBytes);
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`HTTP response has no body: ${response.url}`);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > maxBytes) throw new Error(`HTTP response exceeded ${maxBytes} bytes: ${response.url}`);
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks);
}

function assertSecureResponse(response: Response, requestedUrl: string): void {
  if (!response.ok) throw new Error(`Unable to download ${requestedUrl}: HTTP ${response.status}.`);
  if (new URL(response.url || requestedUrl).protocol !== "https:") {
    throw new Error(`Refusing a sandbox distribution response fetched over an insecure protocol: ${response.url}`);
  }
}

function assertContentLength(response: Response, expectedBytes: number | undefined, maxBytes: number): void {
  const header = response.headers.get("content-length");
  if (header === null) return;
  const length = Number(header);
  if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes) {
    throw new Error(`Invalid sandbox distribution Content-Length: ${header}`);
  }
  if (expectedBytes !== undefined && length !== expectedBytes) {
    throw new Error(
      `Sandbox image archive Content-Length does not match its manifest: ${length} !== ${expectedBytes}.`,
    );
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

async function optionalFileSize(filePath: string): Promise<number | undefined> {
  try {
    const value = await stat(filePath);
    if (!value.isFile()) throw new Error(`Sandbox image archive cache entry is not a file: ${filePath}`);
    return value.size;
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
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
    formatVersion: 3,
    distributionId: manifest.distributionId,
    archiveVersion: manifest.archiveVersion,
    productVersion: manifest.productVersion,
    target: manifest.target,
    sourceImage: manifest.sourceImage,
    runtimeImage: manifest.runtimeImage,
    archiveSha256: manifest.asset.sha256,
  };
}

function assertReceipt(actual: InstallationReceipt, expected: InstallationReceipt): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Sandbox image archive installation receipt does not match the active release manifest.");
  }
}

function nodeErrorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}
