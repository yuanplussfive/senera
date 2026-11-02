import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { extension as mimeExtension } from "mime-types";
import type { ResolvedAgentUploadsConfig } from "../Types/AgentConfigTypes.js";
import {
  AgentUploadFileNames,
  resolveAgentUploadDir,
  resolveAgentUploadFile,
  resolveAgentUploadRoot,
} from "./AgentUploadLocator.js";
import {
  createAgentResourceUri,
  normalizeAgentResourceUri,
  parseAgentResourceId,
} from "../Resources/AgentResourceUri.js";
import { detectAgentUploadMime } from "./AgentUploadMime.js";
import { allocateAgentResourceId } from "../Resources/AgentResourceIdAllocator.js";
import { isMissingFileError, removeAgentPathWithRetry, writeFileAtomic } from "../Core/AgentFs.js";
import {
  type AgentUploadAttachment,
  type AgentUploadImageAnalysisAsset,
  type AgentUploadManifest,
  AgentUploadImageAnalysisMimeSchema,
  AgentUploadStatus,
  createAgentUploadImageAnalysisFileName,
  type AgentResolvedUpload,
} from "./AgentUploadTypes.js";
import type {
  AgentPublishedResource,
  AgentResourcePublishBase64Input,
  AgentResourcePublishInput,
  AgentResourcePublisher,
} from "../Resources/AgentResourcePublisher.js";
import { awaitWithAbortSignal, throwIfAborted } from "../Core/AgentCancellation.js";
import {
  AgentImageNormalizationPolicyRevision,
  createAgentImageNormalizationPolicyKey,
  matchesAgentImageInputCapabilities,
  type AgentImageInputCapabilities,
  type AgentNormalizedImage,
} from "../Images/AgentImageNormalizationService.js";

import { AgentUploadError, AgentUploadFailureKinds } from "./AgentUploadErrors.js";
export {
  AgentUploadError,
  AgentUploadFailureKinds,
  AgentUploadIntegrityError,
  type AgentUploadFailureKind,
} from "./AgentUploadErrors.js";
export type { AgentUploadMaintenanceResult } from "./AgentUploadPersistence.js";
import {
  verifyUploadFileIntegrity,
  totalStoredPathBytes,
  storedPathByteLength,
  removeNonFilePath,
  manifestByteLength,
  serializedManifestByteLength,
  scanUploadRoot,
  findPersistentOwnedUploadUris,
  directorySize,
  resolveStoredUpload,
  serializeUploadManifest,
  type AgentUploadMaintenanceResult,
} from "./AgentUploadPersistence.js";

const MILLISECONDS_PER_HOUR = 60 * 60 * 1_000;
const MILLISECONDS_PER_MINUTE = 60 * 1_000;

export interface AgentUploadStoreOptions {
  workspaceRoot: string;
  config: ResolvedAgentUploadsConfig | (() => ResolvedAgentUploadsConfig);
  now?: () => Date;
}

export interface AgentUploadSaveInput {
  stream: Readable;
  originalName: string;
  declaredMime?: string;
  signal?: AbortSignal;
  retention?: AgentResourcePublishInput["retention"];
  owner?: AgentResourcePublishInput["owner"];
}

export interface AgentUploadImageNormalizer {
  normalize(input: {
    bytes: Uint8Array;
    mime: string;
    sourceSha256: string;
    target: AgentImageInputCapabilities;
    transferSource?: boolean;
    signal?: AbortSignal;
  }): Promise<AgentNormalizedImage>;
}

export interface AgentResolvedUploadImage {
  readonly resourceUri: string;
  readonly name: string;
  readonly mime: string;
  readonly size: number;
  readonly sha256: string;
  readonly width?: number;
  readonly height?: number;
  /** Whether the delivered bytes contain more than one display frame. */
  readonly animated: boolean;
  readonly bytes: Buffer;
  readonly derived: boolean;
}

interface AgentUploadRootState {
  activeUploads: number;
  activeUploadIds: Set<string>;
  reservedBytes: number;
  usageBytes?: number;
  lastScanAt?: number;
  lock: Promise<void>;
}

export class AgentUploadStore implements AgentResourcePublisher {
  private readonly rootStates = new Map<string, AgentUploadRootState>();
  private readonly imageProjectionFlights = new Map<string, Promise<AgentResolvedUploadImage | undefined>>();
  private readonly now: () => Date;

  constructor(private readonly options: AgentUploadStoreOptions) {
    this.now = options.now ?? (() => new Date());
  }

  get maxRequestBytes(): number {
    return this.config().MaxRequestBytes;
  }

  get maxFileBytes(): number {
    return this.config().MaxFileBytes;
  }

  get maxFilesPerRequest(): number {
    return this.config().MaxFilesPerRequest;
  }

  get maintenanceIntervalMs(): number {
    return this.config().MaintenanceIntervalMinutes * MILLISECONDS_PER_MINUTE;
  }

  async save(input: AgentUploadSaveInput): Promise<AgentUploadAttachment> {
    return (await this.saveLocated(input)).attachment;
  }

  private async saveLocated(input: AgentUploadSaveInput): Promise<{
    attachment: AgentUploadAttachment;
    filePath: string;
  }> {
    const config = this.config();
    const resourceId = allocateAgentResourceId(this.options.workspaceRoot);
    const resourceUri = createAgentResourceUri(resourceId);
    const uploadRoot = this.resolveRoot(config);
    const state = this.rootState(uploadRoot);
    const uploadDir = resolveAgentUploadDir(uploadRoot, resourceId);
    let filePath = resolveAgentUploadFile(uploadRoot, resourceId, AgentUploadFileNames.Original);
    const meter = new UploadByteMeter(config.MaxFileBytes);
    let capacityReserved = false;

    this.acquireUploadSlot(state, config);
    state.activeUploadIds.add(resourceId);

    try {
      await this.withRootLock(state, async () => {
        await this.refreshRootState(uploadRoot, state, config, false);
        const requiredBytes = state.usageBytes! + state.reservedBytes + config.MaxFileBytes;
        if (requiredBytes > config.MaxStoredBytes) {
          throw AgentUploadError.from(AgentUploadFailureKinds.StorageQuotaExceeded);
        }
        state.reservedBytes += config.MaxFileBytes;
        capacityReserved = true;
      });

      await fsp.mkdir(uploadDir, { recursive: true });

      throwIfAborted(input.signal);
      await pipeline(input.stream, meter, fs.createWriteStream(filePath), { signal: input.signal });
      const mime = await detectAgentUploadMime({
        filePath,
        originalName: input.originalName,
        declaredMime: input.declaredMime,
      });
      const extension = mimeExtension(mime.effective);
      const storageFileName = extension
        ? `${AgentUploadFileNames.Original}.${extension}`
        : AgentUploadFileNames.Original;
      if (storageFileName !== AgentUploadFileNames.Original) {
        const typedFilePath = resolveAgentUploadFile(uploadRoot, resourceId, storageFileName);
        await fsp.rename(filePath, typedFilePath);
        filePath = typedFilePath;
      }
      const manifest: AgentUploadManifest = {
        resourceId,
        resourceUri,
        name: sanitizeUploadDisplayName(input.originalName),
        mime: mime.effective,
        declaredMime: mime.declared,
        detectedMime: mime.detected,
        size: meter.byteLength,
        sha256: meter.sha256(),
        createdAt: this.now().toISOString(),
        ...(input.retention ? { retention: input.retention } : {}),
        ...(input.owner ? { owner: input.owner } : {}),
        storage: {
          fileName: storageFileName,
        },
      };
      await this.writeManifest(uploadDir, manifest);
      const storedBytes = await directorySize(uploadDir);
      await this.withRootLock(state, () => {
        const remainingReservation = Math.max(0, state.reservedBytes - config.MaxFileBytes);
        const committedUsage = (state.usageBytes ?? 0) + storedBytes;
        if (committedUsage + remainingReservation > config.MaxStoredBytes) {
          throw AgentUploadError.from(AgentUploadFailureKinds.StorageQuotaExceeded);
        }
        state.usageBytes = committedUsage;
        state.reservedBytes = remainingReservation;
        capacityReserved = false;
      });
      return { attachment: manifestToAttachment(manifest), filePath };
    } catch (error) {
      await removeAgentPathWithRetry(uploadDir, { recursive: true }).catch(() => undefined);
      if (capacityReserved) {
        await this.withRootLock(state, () => {
          state.reservedBytes = Math.max(0, state.reservedBytes - config.MaxFileBytes);
        });
      }
      throw error;
    } finally {
      state.activeUploadIds.delete(resourceId);
      state.activeUploads = Math.max(0, state.activeUploads - 1);
    }
  }

  /**
   * Publishes host-received bytes through the same quota, MIME detection,
   * manifest, integrity, and retention path as a user upload.
   */
  async publishBytes(input: AgentResourcePublishInput): Promise<AgentPublishedResource> {
    const bytes = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes);
    const saved = await this.saveLocated({
      stream: Readable.from([bytes]),
      originalName: input.name,
      declaredMime: input.mime,
      retention: input.retention,
      owner: input.owner,
      signal: input.signal,
    });
    return { ...saved.attachment, localPath: this.localPathFor(saved.filePath) };
  }

  /**
   * Decodes provider Base64 incrementally so a large image does not require a
   * second full in-memory Buffer before it enters the upload pipeline.
   */
  async publishBase64(input: AgentResourcePublishBase64Input): Promise<AgentPublishedResource> {
    const saved = await this.saveLocated({
      stream: Readable.from(readBase64Chunks(input.base64)).pipe(new Base64DecodeTransform()),
      originalName: input.name,
      declaredMime: input.mime,
      signal: input.signal,
    });
    return { ...saved.attachment, localPath: this.localPathFor(saved.filePath) };
  }

  async resolve(resourceUri: string): Promise<AgentResolvedUpload | undefined> {
    const upload = await resolveStoredUpload(this.resolveRoot(this.config()), resourceUri);
    if (!upload) return undefined;
    await verifyUploadFileIntegrity(upload.filePath, upload.manifest);
    return upload;
  }

  /** Resolves prompt references without hashing bytes; byte readers must use resolve(). */
  async resolvePath(resourceUri: string): Promise<string | undefined> {
    const upload = await resolveStoredUpload(this.resolveRoot(this.config()), resourceUri);
    if (!upload) return undefined;
    const stat = await fsp.stat(upload.filePath);
    return stat.isFile() && stat.size === upload.manifest.size ? upload.filePath : undefined;
  }

  /**
   * Resolves a model-facing image form without replacing the original upload.
   * Verified derivatives are cache entries under this upload's directory,
   * keyed by the normalizer policy that produced them.
   */
  async resolveImageForModel(input: {
    resourceUri: string;
    target: AgentImageInputCapabilities;
    normalizer: AgentUploadImageNormalizer;
    signal?: AbortSignal;
  }): Promise<AgentResolvedUploadImage | undefined> {
    throwIfAborted(input.signal);
    const policyKey = createAgentImageNormalizationPolicyKey(input.target);
    const flightKey = `${input.resourceUri}\u0000${policyKey}`;
    const active = this.imageProjectionFlights.get(flightKey);
    if (active) return awaitWithAbortSignal(active, input.signal);

    // The flight populates a reusable, verified cache entry. It must not be
    // owned by whichever turn happened to request it first: cancelling that
    // turn must not discard work other consumers are already awaiting.
    const flight = this.resolveImageForModelUncached({
      resourceUri: input.resourceUri,
      target: input.target,
      normalizer: input.normalizer,
      policyKey,
    }).finally(() => {
      if (this.imageProjectionFlights.get(flightKey) === flight) this.imageProjectionFlights.delete(flightKey);
    });
    this.imageProjectionFlights.set(flightKey, flight);
    return awaitWithAbortSignal(flight, input.signal);
  }

  async delete(resourceUri: string): Promise<boolean> {
    const resourceId = parseAgentResourceId(normalizeAgentResourceUri(resourceUri) ?? "");
    if (!resourceId) return false;

    const config = this.config();
    const uploadRoot = this.resolveRoot(config);
    const state = this.rootState(uploadRoot);
    return this.withRootLock(state, async () => {
      const uploadDir = resolveAgentUploadDir(uploadRoot, resourceId);
      const storedBytes = await directorySize(uploadDir).catch(() => 0);
      const removed = await removeAgentPathWithRetry(uploadDir, { recursive: true })
        .then(() => storedBytes > 0)
        .catch(() => false);
      if (removed && state.usageBytes !== undefined) {
        state.usageBytes = Math.max(0, state.usageBytes - storedBytes);
      }
      return removed;
    });
  }

  async deleteMany(resourceUris: readonly string[]): Promise<void> {
    await Promise.all(resourceUris.map((resourceUri) => this.delete(resourceUri)));
  }

  /** Removes durable inspection records together with the session history that owns them. */
  async deletePersistentOwned(input: { sessionId: string; requestIds?: readonly string[] }): Promise<void> {
    const config = this.config();
    const uploadRoot = this.resolveRoot(config);
    const state = this.rootState(uploadRoot);
    const resourceUris = await this.withRootLock(state, () => findPersistentOwnedUploadUris(uploadRoot, input));
    await this.deleteMany(resourceUris);
  }

  async maintain(): Promise<AgentUploadMaintenanceResult> {
    const config = this.config();
    const uploadRoot = this.resolveRoot(config);
    const state = this.rootState(uploadRoot);
    return this.withRootLock(state, () => this.refreshRootState(uploadRoot, state, config, true));
  }

  private async resolveImageForModelUncached(input: {
    resourceUri: string;
    target: AgentImageInputCapabilities;
    normalizer: AgentUploadImageNormalizer;
    policyKey: string;
  }): Promise<AgentResolvedUploadImage | undefined> {
    // Canonical resource URIs may identify an Artifact rather than an upload.
    // Those have no upload directory, so a missing manifest means "not an
    // upload image" and the caller falls back to the artifact bytes.
    const upload = await this.resolve(input.resourceUri).catch((error: unknown) => {
      if (isMissingFileError(error)) return undefined;
      throw error;
    });
    if (!upload || !upload.manifest.mime.startsWith("image/")) return undefined;

    const cached = await this.readCachedImageAnalysis(upload, input.policyKey, input.target);
    if (cached) return cached;

    const sourceBytes = await fsp.readFile(upload.filePath);
    const normalized = await input.normalizer.normalize({
      bytes: sourceBytes,
      mime: upload.manifest.mime,
      sourceSha256: upload.manifest.sha256,
      target: input.target,
      transferSource: true,
    });
    assertNormalizedImageMatchesUpload(normalized, upload.manifest, input.policyKey, input.target);
    if (!normalized.derived) return imageProjectionFromOriginal(upload, normalized);

    return this.storeImageAnalysis(upload, normalized, input.policyKey, input.target);
  }

  private async readCachedImageAnalysis(
    upload: AgentResolvedUpload,
    policyKey: string,
    target: AgentImageInputCapabilities,
  ): Promise<AgentResolvedUploadImage | undefined> {
    const asset = upload.manifest.imageAnalysis?.find(
      (candidate) =>
        candidate.policyRevision === AgentImageNormalizationPolicyRevision &&
        candidate.policyKey === policyKey &&
        candidate.sourceSha256 === upload.manifest.sha256 &&
        isImageAnalysisAssetCompatible(candidate, target),
    );
    if (!asset) return undefined;
    const filePath = resolveAgentUploadFile(
      this.resolveRoot(this.config()),
      upload.manifest.resourceId,
      asset.fileName,
    );
    // A derivative is a rebuildable cache, unlike the canonical original.
    // Invalid cache bytes are deliberately re-derived under the same policy.
    const bytes = await readVerifiedAnalysisAsset(filePath, asset).catch(() => undefined);
    if (!bytes) return undefined;
    return {
      resourceUri: upload.manifest.resourceUri,
      name: upload.manifest.name,
      mime: asset.mime,
      size: asset.size,
      sha256: asset.sha256,
      ...(asset.width === undefined ? {} : { width: asset.width }),
      ...(asset.height === undefined ? {} : { height: asset.height }),
      animated: false,
      bytes,
      derived: true,
    };
  }

  private async storeImageAnalysis(
    upload: AgentResolvedUpload,
    normalized: AgentNormalizedImage,
    policyKey: string,
    target: AgentImageInputCapabilities,
  ): Promise<AgentResolvedUploadImage> {
    if (normalized.animated) {
      throw new Error("Animated images must remain verified originals and cannot be stored as analysis derivatives.");
    }
    const config = this.config();
    const uploadRoot = this.resolveRoot(config);
    const state = this.rootState(uploadRoot);
    const mime = AgentUploadImageAnalysisMimeSchema.parse(normalized.mime);
    const sha256 = sha256Hex(normalized.bytes);
    const asset: AgentUploadImageAnalysisAsset = {
      policyRevision: AgentImageNormalizationPolicyRevision,
      policyKey,
      sourceSha256: upload.manifest.sha256,
      fileName: createAgentUploadImageAnalysisFileName({ policyKey, sha256, mime }),
      mime,
      size: normalized.bytes.byteLength,
      sha256,
      ...(normalized.width === undefined ? {} : { width: normalized.width }),
      ...(normalized.height === undefined ? {} : { height: normalized.height }),
    };

    return this.withRootLock(state, async () => {
      const current = await this.resolve(upload.manifest.resourceUri);
      if (!current) return imageProjectionFromNormalized(upload.manifest, normalized, asset);
      const existing = await this.readCachedImageAnalysis(current, policyKey, target);
      if (existing) return existing;

      const currentManifestBytes = await manifestByteLength(current.uploadDir);
      const previousDirectoryBytes = await directorySize(current.uploadDir);
      const existingAssets = current.manifest.imageAnalysis ?? [];
      const retainsCurrentAsset = (candidate: AgentUploadImageAnalysisAsset): boolean =>
        candidate.policyRevision === AgentImageNormalizationPolicyRevision &&
        candidate.policyKey !== policyKey &&
        candidate.sourceSha256 === current.manifest.sha256;
      const retainedAssets = existingAssets.filter(retainsCurrentAsset);
      const obsoleteAssets = existingAssets.filter((candidate) => !retainsCurrentAsset(candidate));
      const manifest: AgentUploadManifest = {
        ...current.manifest,
        imageAnalysis: [...retainedAssets, asset],
      };
      const filePath = resolveAgentUploadFile(uploadRoot, current.manifest.resourceId, asset.fileName);
      const obsoletePaths = uniqueAnalysisAssetPaths(uploadRoot, current.manifest.resourceId, obsoleteAssets).filter(
        (candidate) => candidate !== filePath,
      );
      const [previousTargetBytes, obsoleteBytes] = await Promise.all([
        storedPathByteLength(filePath),
        totalStoredPathBytes(obsoletePaths),
      ]);
      const addedBytes =
        normalized.bytes.byteLength -
        previousTargetBytes -
        obsoleteBytes +
        serializedManifestByteLength(manifest) -
        currentManifestBytes;
      await this.refreshRootState(uploadRoot, state, config, false);
      if ((state.usageBytes ?? 0) + state.reservedBytes + Math.max(0, addedBytes) > config.MaxStoredBytes) {
        return imageProjectionFromNormalized(current.manifest, normalized, asset);
      }

      await removeNonFilePath(filePath);
      await writeFileAtomic(filePath, normalized.bytes);
      try {
        await this.writeManifest(current.uploadDir, manifest);
      } catch (error) {
        await removeAgentPathWithRetry(filePath).catch(() => undefined);
        throw error;
      }
      // Old cache entries are no longer reachable once the manifest has moved.
      // A locked file here is harmless: upload retention eventually removes the
      // complete directory, while the live manifest remains valid.
      await Promise.allSettled(obsoletePaths.map((candidate) => removeAgentPathWithRetry(candidate)));
      const nextDirectoryBytes = await directorySize(current.uploadDir);
      state.usageBytes = Math.max(0, (state.usageBytes ?? 0) + nextDirectoryBytes - previousDirectoryBytes);
      return imageProjectionFromNormalized(manifest, normalized, asset);
    });
  }

  private config(): ResolvedAgentUploadsConfig {
    return typeof this.options.config === "function" ? this.options.config() : this.options.config;
  }

  private resolveRoot(config: ResolvedAgentUploadsConfig): string {
    return resolveAgentUploadRoot(this.options.workspaceRoot, config.RootDir);
  }

  private localPathFor(filePath: string): string {
    const relativePath = path.relative(path.resolve(this.options.workspaceRoot), filePath);
    if (
      !relativePath ||
      relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      throw new TypeError("Published upload path is outside the workspace.");
    }
    return relativePath.split(path.sep).join("/");
  }

  private rootState(uploadRoot: string): AgentUploadRootState {
    const existing = this.rootStates.get(uploadRoot);
    if (existing) return existing;

    const state: AgentUploadRootState = {
      activeUploads: 0,
      activeUploadIds: new Set(),
      reservedBytes: 0,
      lock: Promise.resolve(),
    };
    this.rootStates.set(uploadRoot, state);
    return state;
  }

  private acquireUploadSlot(state: AgentUploadRootState, config: ResolvedAgentUploadsConfig): void {
    if (state.activeUploads >= config.MaxConcurrentUploads) {
      throw AgentUploadError.from(AgentUploadFailureKinds.ConcurrencyExceeded);
    }
    state.activeUploads += 1;
  }

  private async withRootLock<T>(state: AgentUploadRootState, action: () => T | Promise<T>): Promise<T> {
    const previous = state.lock;
    let release = (): void => undefined;
    state.lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await action();
    } finally {
      release();
    }
  }

  private async refreshRootState(
    uploadRoot: string,
    state: AgentUploadRootState,
    config: ResolvedAgentUploadsConfig,
    force: boolean,
  ): Promise<AgentUploadMaintenanceResult> {
    const now = this.now().getTime();
    const maintenanceIntervalMs = config.MaintenanceIntervalMinutes * MILLISECONDS_PER_MINUTE;
    if (!force && state.usageBytes !== undefined && now - (state.lastScanAt ?? 0) < maintenanceIntervalMs) {
      return { retainedBytes: state.usageBytes, removedBytes: 0, removedUploads: 0 };
    }

    const result = await scanUploadRoot({
      uploadRoot,
      activeUploadIds: state.activeUploadIds,
      now,
      retentionMs: config.RetentionHours * MILLISECONDS_PER_HOUR,
      incompleteRetentionMs: config.IncompleteRetentionHours * MILLISECONDS_PER_HOUR,
    });
    state.usageBytes = result.retainedBytes;
    state.lastScanAt = now;
    return result;
  }

  private async writeManifest(uploadDir: string, manifest: AgentUploadManifest): Promise<void> {
    await writeFileAtomic(path.join(uploadDir, AgentUploadFileNames.Manifest), serializeUploadManifest(manifest));
  }
}

async function readVerifiedAnalysisAsset(filePath: string, asset: AgentUploadImageAnalysisAsset): Promise<Buffer> {
  const stat = await fsp.lstat(filePath);
  if (!stat.isFile() || stat.size !== asset.size)
    throw new Error(`Cached image analysis asset is invalid: ${asset.fileName}`);
  const bytes = await fsp.readFile(filePath);
  if (sha256Hex(bytes) !== asset.sha256) throw new Error(`Cached image analysis asset is invalid: ${asset.fileName}`);
  return bytes;
}

function isImageAnalysisAssetCompatible(
  asset: AgentUploadImageAnalysisAsset,
  target: AgentImageInputCapabilities,
): boolean {
  // Analysis assets are generated only through the static local codecs listed
  // in AgentUploadImageAnalysisMimeSchema. Dynamic media is always retained
  // as a verified original rather than cached as a derivative.
  return matchesAgentImageInputCapabilities(
    {
      mime: asset.mime,
      byteLength: asset.size,
      width: asset.width,
      height: asset.height,
      animated: false,
    },
    target,
  );
}

function uniqueAnalysisAssetPaths(
  uploadRoot: string,
  resourceId: string,
  assets: readonly AgentUploadImageAnalysisAsset[],
): string[] {
  return [...new Set(assets.map((asset) => resolveAgentUploadFile(uploadRoot, resourceId, asset.fileName)))];
}

function assertNormalizedImageMatchesUpload(
  normalized: AgentNormalizedImage,
  manifest: AgentUploadManifest,
  policyKey: string,
  target: AgentImageInputCapabilities,
): void {
  if (normalized.sourceSha256 !== manifest.sha256 || normalized.policyKey !== policyKey) {
    throw new Error("Image normalizer returned media for a different source or policy.");
  }
  if (
    !matchesAgentImageInputCapabilities(
      {
        mime: normalized.mime,
        byteLength: normalized.bytes.byteLength,
        width: normalized.width,
        height: normalized.height,
        animated: normalized.animated,
      },
      target,
    )
  ) {
    throw new Error("Image normalizer returned media outside the requested model input contract.");
  }
  if (!normalized.derived) {
    if (normalized.bytes.byteLength !== manifest.size || sha256Hex(normalized.bytes) !== manifest.sha256) {
      throw new Error("Image normalizer returned unverified source media.");
    }
  }
}

function imageProjectionFromOriginal(
  upload: AgentResolvedUpload,
  normalized: AgentNormalizedImage,
): AgentResolvedUploadImage {
  return {
    resourceUri: upload.manifest.resourceUri,
    name: upload.manifest.name,
    mime: normalized.mime,
    size: normalized.bytes.byteLength,
    sha256: normalized.sourceSha256,
    ...(normalized.width === undefined ? {} : { width: normalized.width }),
    ...(normalized.height === undefined ? {} : { height: normalized.height }),
    animated: normalized.animated,
    bytes: normalized.bytes,
    derived: false,
  };
}

function imageProjectionFromNormalized(
  manifest: AgentUploadManifest,
  normalized: AgentNormalizedImage,
  asset: AgentUploadImageAnalysisAsset,
): AgentResolvedUploadImage {
  return {
    resourceUri: manifest.resourceUri,
    name: manifest.name,
    mime: asset.mime,
    size: asset.size,
    sha256: asset.sha256,
    ...(asset.width === undefined ? {} : { width: asset.width }),
    ...(asset.height === undefined ? {} : { height: asset.height }),
    animated: false,
    bytes: normalized.bytes,
    derived: true,
  };
}

function sha256Hex(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function manifestToAttachment(manifest: AgentUploadManifest): AgentUploadAttachment {
  return {
    resourceUri: manifest.resourceUri,
    name: manifest.name,
    mime: manifest.mime,
    size: manifest.size,
    sha256: manifest.sha256,
    status: AgentUploadStatus.Uploaded,
  };
}

function sanitizeUploadDisplayName(value: string): string {
  const name = path.basename(path.win32.basename(value.trim())).normalize("NFC");
  return name ? name : "uploaded-file";
}

class UploadByteMeter extends Transform {
  private readonly hash = crypto.createHash("sha256");
  byteLength = 0;

  constructor(private readonly maxFileBytes: number) {
    super();
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.byteLength += chunk.byteLength;
    if (this.byteLength > this.maxFileBytes) {
      callback(AgentUploadError.from(AgentUploadFailureKinds.FileTooLarge));
      return;
    }

    this.hash.update(chunk);
    callback(null, chunk);
  }

  sha256(): string {
    return this.hash.digest("hex");
  }
}

class Base64DecodeTransform extends Transform {
  private carry = "";

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    const input = this.carry + stripBase64Whitespace(chunk.toString("ascii"));
    const completeLength = input.length - (input.length % 4);
    if (completeLength > 0) this.push(Buffer.from(input.slice(0, completeLength), "base64"));
    this.carry = input.slice(completeLength);
    callback();
  }

  _flush(callback: TransformCallback): void {
    if (this.carry) this.push(Buffer.from(this.carry, "base64"));
    callback();
  }
}

function stripBase64Whitespace(value: string): string {
  const projected: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code !== 0x09 && code !== 0x0a && code !== 0x0c && code !== 0x0d && code !== 0x20) {
      projected.push(value[index]!);
    }
  }
  return projected.join("");
}

function* readBase64Chunks(value: string, chunkSize = 64 * 1024): Generator<string> {
  for (let offset = 0; offset < value.length; offset += chunkSize) {
    yield value.slice(offset, offset + chunkSize);
  }
}
