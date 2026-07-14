import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Transform, type TransformCallback, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { agentErrorMessage, type AgentErrorMessageKey } from "../I18n/AgentMessageCatalog.js";
import type { ResolvedAgentUploadsConfig } from "../Types/AgentConfigTypes.js";
import {
  AgentUploadFileNames,
  createAgentUploadId,
  formatAgentUploadUri,
  normalizeAgentUploadUri,
  parseAgentUploadUri,
  resolveAgentUploadDir,
  resolveAgentUploadFile,
  resolveAgentUploadRoot,
} from "./AgentUploadLocator.js";
import { detectAgentUploadMime } from "./AgentUploadMime.js";
import {
  type AgentUploadAttachment,
  type AgentUploadManifest,
  AgentUploadManifestSchema,
  AgentUploadStatus,
  type AgentResolvedUpload,
} from "./AgentUploadTypes.js";

const MILLISECONDS_PER_HOUR = 60 * 60 * 1_000;
const MILLISECONDS_PER_MINUTE = 60 * 1_000;
const INCOMPLETE_UPLOAD_GRACE_MS = MILLISECONDS_PER_HOUR;

export const AgentUploadFailureKinds = {
  Aborted: "Aborted",
  ConcurrencyExceeded: "ConcurrencyExceeded",
  FileCountExceeded: "FileCountExceeded",
  FileMissing: "FileMissing",
  FileTooLarge: "FileTooLarge",
  RequestTooLarge: "RequestTooLarge",
  StorageQuotaExceeded: "StorageQuotaExceeded",
} as const;

export type AgentUploadFailureKind = (typeof AgentUploadFailureKinds)[keyof typeof AgentUploadFailureKinds];

interface AgentUploadFailureDefinition {
  code: string;
  messageKey: AgentErrorMessageKey;
  statusCode: number;
}

const AgentUploadFailureDefinitions = {
  [AgentUploadFailureKinds.Aborted]: {
    code: "upload_aborted",
    messageKey: "upload.aborted",
    statusCode: 499,
  },
  [AgentUploadFailureKinds.ConcurrencyExceeded]: {
    code: "upload_concurrency_exceeded",
    messageKey: "upload.concurrencyExceeded",
    statusCode: 429,
  },
  [AgentUploadFailureKinds.FileCountExceeded]: {
    code: "upload_file_count_exceeded",
    messageKey: "upload.fileCountExceeded",
    statusCode: 413,
  },
  [AgentUploadFailureKinds.FileMissing]: {
    code: "upload_file_missing",
    messageKey: "upload.fileMissing",
    statusCode: 400,
  },
  [AgentUploadFailureKinds.FileTooLarge]: {
    code: "upload_too_large",
    messageKey: "upload.fileTooLarge",
    statusCode: 413,
  },
  [AgentUploadFailureKinds.RequestTooLarge]: {
    code: "upload_request_too_large",
    messageKey: "upload.requestTooLarge",
    statusCode: 413,
  },
  [AgentUploadFailureKinds.StorageQuotaExceeded]: {
    code: "upload_storage_quota_exceeded",
    messageKey: "upload.storageQuotaExceeded",
    statusCode: 507,
  },
} as const satisfies Record<AgentUploadFailureKind, AgentUploadFailureDefinition>;

export class AgentUploadError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "AgentUploadError";
  }

  static from(kind: AgentUploadFailureKind): AgentUploadError {
    const failure = AgentUploadFailureDefinitions[kind];
    return new AgentUploadError(agentErrorMessage(failure.messageKey), failure.code, failure.statusCode);
  }
}

export interface AgentUploadStoreOptions {
  workspaceRoot: string;
  config: ResolvedAgentUploadsConfig | (() => ResolvedAgentUploadsConfig);
  now?: () => Date;
}

export interface AgentUploadSaveInput {
  stream: Readable;
  originalName: string;
  declaredMime?: string;
}

export interface AgentUploadMaintenanceResult {
  retainedBytes: number;
  removedBytes: number;
  removedUploads: number;
}

interface AgentUploadRootState {
  activeUploads: number;
  activeUploadIds: Set<string>;
  reservedBytes: number;
  usageBytes?: number;
  lastScanAt?: number;
  lock: Promise<void>;
}

export class AgentUploadStore {
  private readonly rootStates = new Map<string, AgentUploadRootState>();
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
    const config = this.config();
    const uploadId = createAgentUploadId();
    const uploadUri = formatAgentUploadUri(uploadId);
    const uploadRoot = this.resolveRoot(config);
    const state = this.rootState(uploadRoot);
    const uploadDir = resolveAgentUploadDir(uploadRoot, uploadId);
    const filePath = resolveAgentUploadFile(uploadRoot, uploadId, AgentUploadFileNames.Original);
    const meter = new UploadByteMeter(config.MaxFileBytes);
    let capacityReserved = false;

    this.acquireUploadSlot(state, config);
    state.activeUploadIds.add(uploadId);

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

      await pipeline(input.stream, meter, fs.createWriteStream(filePath));
      const mime = await detectAgentUploadMime({
        filePath,
        originalName: input.originalName,
        declaredMime: input.declaredMime,
      });
      const manifest: AgentUploadManifest = {
        uploadId,
        uploadUri,
        name: sanitizeUploadDisplayName(input.originalName),
        mime: mime.effective,
        declaredMime: mime.declared,
        detectedMime: mime.detected,
        size: meter.byteLength,
        sha256: meter.sha256(),
        createdAt: this.now().toISOString(),
        storage: {
          fileName: AgentUploadFileNames.Original,
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
      return manifestToAttachment(manifest);
    } catch (error) {
      await fsp.rm(uploadDir, { recursive: true, force: true }).catch(() => undefined);
      if (capacityReserved) {
        await this.withRootLock(state, () => {
          state.reservedBytes = Math.max(0, state.reservedBytes - config.MaxFileBytes);
        });
      }
      throw error;
    } finally {
      state.activeUploadIds.delete(uploadId);
      state.activeUploads = Math.max(0, state.activeUploads - 1);
    }
  }

  async resolve(uploadUri: string): Promise<AgentResolvedUpload | undefined> {
    const normalizedUri = normalizeAgentUploadUri(uploadUri);
    if (!normalizedUri) {
      return undefined;
    }

    const uploadId = parseAgentUploadUri(normalizedUri);
    if (!uploadId) {
      return undefined;
    }

    const uploadRoot = this.resolveRoot(this.config());
    const uploadDir = resolveAgentUploadDir(uploadRoot, uploadId);
    const manifestPath = resolveAgentUploadFile(uploadRoot, uploadId, AgentUploadFileNames.Manifest);
    const manifest = AgentUploadManifestSchema.parse(JSON.parse(await fsp.readFile(manifestPath, "utf8")));
    if (manifest.uploadUri !== normalizedUri || manifest.uploadId !== uploadId) {
      return undefined;
    }

    return {
      manifest,
      uploadDir,
      filePath: resolveAgentUploadFile(uploadRoot, uploadId, manifest.storage.fileName),
    };
  }

  async delete(uploadUri: string): Promise<boolean> {
    const uploadId = parseAgentUploadUri(normalizeAgentUploadUri(uploadUri) ?? "");
    if (!uploadId) return false;

    const config = this.config();
    const uploadRoot = this.resolveRoot(config);
    const state = this.rootState(uploadRoot);
    return this.withRootLock(state, async () => {
      const uploadDir = resolveAgentUploadDir(uploadRoot, uploadId);
      const storedBytes = await directorySize(uploadDir).catch(() => 0);
      const removed = await fsp
        .rm(uploadDir, { recursive: true, force: true })
        .then(() => storedBytes > 0)
        .catch(() => false);
      if (removed && state.usageBytes !== undefined) {
        state.usageBytes = Math.max(0, state.usageBytes - storedBytes);
      }
      return removed;
    });
  }

  async deleteMany(uploadUris: readonly string[]): Promise<void> {
    await Promise.all(uploadUris.map((uploadUri) => this.delete(uploadUri)));
  }

  async maintain(): Promise<AgentUploadMaintenanceResult> {
    const config = this.config();
    const uploadRoot = this.resolveRoot(config);
    const state = this.rootState(uploadRoot);
    return this.withRootLock(state, () => this.refreshRootState(uploadRoot, state, config, true));
  }

  private config(): ResolvedAgentUploadsConfig {
    return typeof this.options.config === "function" ? this.options.config() : this.options.config;
  }

  private resolveRoot(config: ResolvedAgentUploadsConfig): string {
    return resolveAgentUploadRoot(this.options.workspaceRoot, config.RootDir);
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
    });
    state.usageBytes = result.retainedBytes;
    state.lastScanAt = now;
    return result;
  }

  private async writeManifest(uploadDir: string, manifest: AgentUploadManifest): Promise<void> {
    await fsp.writeFile(
      path.join(uploadDir, AgentUploadFileNames.Manifest),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
  }
}

interface ScanUploadRootOptions {
  uploadRoot: string;
  activeUploadIds: ReadonlySet<string>;
  now: number;
  retentionMs: number;
}

async function scanUploadRoot(options: ScanUploadRootOptions): Promise<AgentUploadMaintenanceResult> {
  const entries = await fsp.readdir(options.uploadRoot, { withFileTypes: true }).catch((error: unknown) => {
    if (isFileSystemError(error, "ENOENT")) return [];
    throw error;
  });
  const result: AgentUploadMaintenanceResult = { retainedBytes: 0, removedBytes: 0, removedUploads: 0 };

  for (const entry of entries) {
    if (!entry.isDirectory() || options.activeUploadIds.has(entry.name)) continue;
    const uploadDir = resolveAgentUploadDir(options.uploadRoot, entry.name);
    const storedBytes = await directorySize(uploadDir);
    const manifest = await readManifest(uploadDir);
    const createdAt = manifest ? Date.parse(manifest.createdAt) : await directoryModifiedAt(uploadDir);
    const retentionMs = manifest ? options.retentionMs : INCOMPLETE_UPLOAD_GRACE_MS;
    if (Number.isFinite(createdAt) && options.now - createdAt >= retentionMs) {
      await fsp.rm(uploadDir, { recursive: true, force: true });
      result.removedBytes += storedBytes;
      result.removedUploads += 1;
      continue;
    }
    result.retainedBytes += storedBytes;
  }
  return result;
}

async function readManifest(uploadDir: string): Promise<AgentUploadManifest | undefined> {
  return fsp
    .readFile(path.join(uploadDir, AgentUploadFileNames.Manifest), "utf8")
    .then((value) => AgentUploadManifestSchema.parse(JSON.parse(value)))
    .catch(() => undefined);
}

async function directoryModifiedAt(uploadDir: string): Promise<number> {
  return fsp
    .stat(uploadDir)
    .then((stat) => stat.mtimeMs)
    .catch(() => Date.now());
}

async function directorySize(directory: string): Promise<number> {
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return directorySize(entryPath);
      if (!entry.isFile()) return 0;
      return fsp.stat(entryPath).then((stat) => stat.size);
    }),
  );
  return sizes.reduce((total, size) => total + size, 0);
}

function isFileSystemError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

export function manifestToAttachment(manifest: AgentUploadManifest): AgentUploadAttachment {
  return {
    uploadUri: manifest.uploadUri,
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
