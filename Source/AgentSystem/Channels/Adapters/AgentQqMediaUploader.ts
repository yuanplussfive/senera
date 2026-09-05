import { createHash } from "node:crypto";
import { open, readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { AgentChannelHttpError, type AgentChannelHttpTransport } from "../AgentChannelHttpTransport.js";
import {
  QqMediaTypes,
  type QqMediaCacheEntry,
  type QqUploadPreparation,
  describe,
  isRecord,
  numberValue,
  parseUploadPreparation,
  stringValue,
  uploadEndpoint,
} from "./AgentQqProtocol.js";
import type { AgentChannelMedia, AgentChannelSource } from "../AgentChannelTypes.js";

export interface QqMediaUploaderOptions {
  readonly transport: AgentChannelHttpTransport;
  /** Authenticated QQ REST request supplied by the adapter. */
  readonly request: (
    path: string,
    method: "POST",
    body: Record<string, unknown>,
    timeoutMs: number,
  ) => Promise<unknown>;
  readonly maxMediaBytes: number;
  readonly inlineMediaLimitBytes: number;
  readonly mediaUploadTimeoutMs: number;
  readonly chunkUploadTimeoutMs: number;
  readonly uploadConcurrency: number;
  readonly mediaCacheTtlMs: number;
  readonly now: () => Date;
}

/** Non-retryable QQ quota response (biz_code 40093002). */
export class QqDailyUploadLimitError extends Error {
  readonly code = 40093002;
  /** Shared delivery pumps must not retry a platform quota until tomorrow. */
  readonly retryable = false;

  constructor(
    readonly fileName: string,
    readonly fileSize: number,
  ) {
    super(`QQ daily media upload quota exceeded for ${fileName} (${fileSize} bytes).`);
    this.name = "QqDailyUploadLimitError";
  }
}

class QqUploadRetryableError extends Error {
  constructor() {
    super("QQ media upload part is temporarily unavailable.");
    this.name = "QqUploadRetryableError";
  }
}

/**
 * Owns QQ's file_info cache and COS multipart uploader. The adapter only
 * supplies an authenticated REST callback, so upload policy remains isolated
 * from gateway state and message rendering.
 */
export class QqMediaUploader {
  private readonly transport: AgentChannelHttpTransport;
  private readonly request: QqMediaUploaderOptions["request"];
  private readonly maxMediaBytes: number;
  private readonly inlineMediaLimitBytes: number;
  private readonly mediaUploadTimeoutMs: number;
  private readonly chunkUploadTimeoutMs: number;
  private readonly uploadConcurrency: number;
  private readonly mediaCacheTtlMs: number;
  private readonly now: () => Date;
  private readonly mediaCache = new Map<string, QqMediaCacheEntry>();
  private readonly mediaUploads = new Map<string, Promise<string>>();

  constructor(options: QqMediaUploaderOptions) {
    this.transport = options.transport;
    this.request = options.request;
    this.maxMediaBytes = options.maxMediaBytes;
    this.inlineMediaLimitBytes = options.inlineMediaLimitBytes;
    this.mediaUploadTimeoutMs = options.mediaUploadTimeoutMs;
    this.chunkUploadTimeoutMs = options.chunkUploadTimeoutMs;
    this.uploadConcurrency = options.uploadConcurrency;
    this.mediaCacheTtlMs = options.mediaCacheTtlMs;
    this.now = options.now;
  }

  async upload(source: AgentChannelSource, media: AgentChannelMedia): Promise<string> {
    const target = uploadEndpoint(source);
    if (!target) throw new Error("QQ media upload supports direct and group conversations only.");
    // QQ's image endpoint accepts raster formats; keep SVG as a native file
    // so the original vector asset remains downloadable instead of failing
    // the image upload and falling back to Markdown text.
    const fileType = isSvgMedia(media) ? QqMediaTypes.file : QqMediaTypes[media.kind];
    if (!fileType) throw new Error(`Unsupported QQ media kind: ${media.kind}`);
    const fileName = media.filename ?? filenameForMedia(media);
    const cacheKey = await this.mediaCacheKey(target, media, fileName);
    const cached = this.readMediaCache(cacheKey);
    if (cached) return cached;
    const pending = this.mediaUploads.get(cacheKey);
    if (pending) return pending;
    const upload = this.uploadUncached(target, media, fileType, fileName)
      .then((fileInfo) => {
        this.writeMediaCache(cacheKey, fileInfo);
        return fileInfo;
      })
      .finally(() => this.mediaUploads.delete(cacheKey));
    this.mediaUploads.set(cacheKey, upload);
    return upload;
  }

  clear(): void {
    this.mediaCache.clear();
    // In-flight uploads are deliberately allowed to finish; clearing this map
    // prevents stale file_info values from being reused after disconnect.
    this.mediaUploads.clear();
  }

  private async uploadUncached(
    target: string,
    media: AgentChannelMedia,
    fileType: number,
    fileName: string,
  ): Promise<string> {
    if (media.url) {
      assertRemoteMediaUrl(media.url);
      const body: Record<string, unknown> = { file_type: fileType, url: media.url, srv_send_msg: false };
      if (fileType === QqMediaTypes.file && fileName) body.file_name = fileName;
      return this.extractFileInfo(await this.requestMediaApi(`${target}/files`, body));
    }
    if (media.data) {
      return this.uploadBytes(target, decodeMediaData(media.data), fileType, fileName);
    }
    if (!media.path) throw new Error("QQ media requires a URL, data payload, or local path.");
    const filePath = media.path;
    const fileStats = await stat(filePath).catch((error) => {
      throw new Error(`QQ media file could not be read: ${describe(error)}`);
    });
    if (!fileStats.isFile()) throw new Error(`QQ media path is not a file: ${filePath}`);
    if (fileStats.size > this.maxMediaBytes)
      throw new Error(`QQ media exceeds the configured ${this.maxMediaBytes} byte limit.`);
    if (fileStats.size <= this.inlineMediaLimitBytes) {
      return this.uploadBytes(target, new Uint8Array(await readFile(filePath)), fileType, fileName);
    }
    return this.uploadLargeMediaFromPath(target, filePath, fileStats.size, fileType, fileName);
  }

  private async uploadBytes(target: string, bytes: Uint8Array, fileType: number, fileName: string): Promise<string> {
    if (bytes.byteLength > this.maxMediaBytes)
      throw new Error(`QQ media exceeds the configured ${this.maxMediaBytes} byte limit.`);
    if (bytes.byteLength <= this.inlineMediaLimitBytes) {
      const body: Record<string, unknown> = {
        file_type: fileType,
        file_data: Buffer.from(bytes).toString("base64"),
        srv_send_msg: false,
      };
      if (fileType === QqMediaTypes.file && fileName) body.file_name = fileName;
      return this.extractFileInfo(await this.requestMediaApi(`${target}/files`, body));
    }
    return this.uploadLargeMedia(target, bytes, fileType, fileName);
  }

  private async uploadLargeMedia(
    target: string,
    bytes: Uint8Array,
    fileType: number,
    fileName: string,
  ): Promise<string> {
    const hashes = hashBytes(bytes);
    const prepared = await this.prepareUpload(target, fileType, fileName, bytes.byteLength, hashes);
    await this.uploadPreparedParts(target, prepared, bytes.byteLength, (offset, length) =>
      bytes.subarray(offset, offset + length),
    );
    return this.completeUpload(target, prepared.uploadId);
  }

  private async uploadLargeMediaFromPath(
    target: string,
    filePath: string,
    fileSize: number,
    fileType: number,
    fileName: string,
  ): Promise<string> {
    const hashes = await hashFile(filePath, fileSize);
    const prepared = await this.prepareUpload(target, fileType, fileName, fileSize, hashes);
    await this.uploadPreparedParts(target, prepared, fileSize, (offset, length) =>
      readFileRange(filePath, offset, length),
    );
    return this.completeUpload(target, prepared.uploadId);
  }

  private async prepareUpload(
    target: string,
    fileType: number,
    fileName: string,
    fileSize: number,
    hashes: { md5: string; sha1: string; md5_10m: string },
  ): Promise<QqUploadPreparation> {
    return parseUploadPreparation(
      await this.requestMediaApi(`${target}/upload_prepare`, {
        file_type: fileType,
        file_name: fileName,
        file_size: fileSize,
        md5: hashes.md5,
        sha1: hashes.sha1,
        md5_10m: hashes.md5_10m,
      }),
    );
  }

  private async uploadPreparedParts(
    target: string,
    prepared: QqUploadPreparation,
    fileSize: number,
    readPart: (offset: number, length: number) => Promise<Uint8Array> | Uint8Array,
  ): Promise<void> {
    const parts = prepared.parts;
    const workerCount = Math.min(this.uploadConcurrency, prepared.concurrency ?? this.uploadConcurrency, parts.length);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        const part = parts[cursor++];
        if (!part) return;
        const offset = (part.index - 1) * prepared.blockSize;
        const length = Math.min(part.blockSize ?? prepared.blockSize, fileSize - offset);
        if (!Number.isSafeInteger(offset) || offset < 0 || length <= 0)
          throw new Error(`QQ upload part ${part.index} has an invalid range.`);
        const chunk = await readPart(offset, length);
        if (chunk.byteLength !== length)
          throw new Error(`QQ upload part ${part.index} read ${chunk.byteLength} of ${length} bytes.`);
        const md5 = createHash("md5").update(chunk).digest("hex");
        await this.retryMediaOperation(`part ${part.index} PUT`, async () => {
          const uploaded = await this.transport.request(part.url, {
            method: "PUT",
            headers: { "Content-Length": String(chunk.byteLength) },
            body: chunk,
            timeoutMs: this.chunkUploadTimeoutMs,
          });
          if (uploaded.status < 200 || uploaded.status >= 300) {
            throw new AgentChannelHttpError(
              `QQ media part ${part.index} upload failed with HTTP ${uploaded.status}.`,
              uploaded.status,
              uploaded.body,
            );
          }
        });
        await this.retryMediaOperation(
          `part ${part.index} finalize`,
          async () => {
            const response = await this.request(
              `${target}/upload_part_finish`,
              "POST",
              {
                upload_id: prepared.uploadId,
                part_index: part.index,
                block_size: length,
                md5,
              },
              this.mediaUploadTimeoutMs,
            );
            if (isDailyUploadLimitBody(response)) throw new QqDailyUploadLimitError("media", 0);
            if (isRetryableUploadBody(response)) throw new QqUploadRetryableError();
          },
          prepared.retryTimeoutMs,
        );
      }
    };
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  }

  private async completeUpload(target: string, uploadId: string): Promise<string> {
    return this.extractFileInfo(
      await this.retryMediaRequest(`${target}/files`, { upload_id: uploadId }, this.mediaUploadTimeoutMs),
    );
  }

  private async requestMediaApi(path: string, body: Record<string, unknown>): Promise<unknown> {
    return this.retryMediaRequest(path, body, this.mediaUploadTimeoutMs);
  }

  private async retryMediaRequest(path: string, body: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    let attempts = 0;
    while (true) {
      try {
        const response = await this.request(path, "POST", body, timeoutMs);
        if (isDailyUploadLimitBody(response))
          throw new QqDailyUploadLimitError(stringValue(body.file_name) ?? "media", numberValue(body.file_size) ?? 0);
        if (isRetryableUploadBody(response)) throw new QqUploadRetryableError();
        return response;
      } catch (error) {
        attempts += 1;
        if (isDailyUploadLimitBody(error instanceof AgentChannelHttpError ? error.body : error)) {
          throw new QqDailyUploadLimitError(stringValue(body.file_name) ?? "media", numberValue(body.file_size) ?? 0);
        }
        if (!isRetryableMediaError(error) || attempts >= 3) throw error;
        await backoff(attempts);
      }
    }
  }

  private async retryMediaOperation(
    label: string,
    operation: () => Promise<void>,
    retryTimeoutMs?: number,
  ): Promise<void> {
    let attempts = 0;
    const startedAt = this.now().getTime();
    while (true) {
      try {
        await operation();
        return;
      } catch (error) {
        attempts += 1;
        if (error instanceof QqDailyUploadLimitError) throw error;
        if (
          !isRetryableMediaError(error) ||
          attempts >= 3 ||
          (retryTimeoutMs !== undefined && this.now().getTime() - startedAt >= retryTimeoutMs)
        ) {
          throw new Error(
            `QQ media ${label} failed after ${attempts} attempt${attempts === 1 ? "" : "s"}: ${describe(error)}`,
            { cause: error },
          );
        }
        await backoff(attempts, retryTimeoutMs);
      }
    }
  }

  private async mediaCacheKey(target: string, media: AgentChannelMedia, fileName: string): Promise<string> {
    if (media.url) return `${target}:url:${media.kind}:${fileName}:${media.url}`;
    if (media.data)
      return `${target}:data:${media.kind}:${fileName}:${createHash("sha256").update(decodeMediaData(media.data)).digest("hex")}`;
    if (media.path) {
      const metadata = await stat(media.path).catch(() => undefined);
      return metadata?.isFile()
        ? `${target}:path:${media.kind}:${fileName}:${media.path}:${metadata.size}:${metadata.mtimeMs}`
        : `${target}:path:${media.kind}:${fileName}:${media.path}`;
    }
    return `${target}:empty:${media.kind}:${fileName}`;
  }

  private readMediaCache(key: string): string | undefined {
    const cached = this.mediaCache.get(key);
    if (!cached) return undefined;
    if (cached.expiresAt <= this.now().getTime()) {
      this.mediaCache.delete(key);
      return undefined;
    }
    return cached.fileInfo;
  }

  private writeMediaCache(key: string, fileInfo: string): void {
    const now = this.now().getTime();
    for (const [cacheKey, entry] of this.mediaCache) {
      if (entry.expiresAt <= now) this.mediaCache.delete(cacheKey);
    }
    this.mediaCache.set(key, { fileInfo, expiresAt: now + this.mediaCacheTtlMs });
  }

  private extractFileInfo(body: unknown): string {
    const value =
      isRecord(body) && typeof body.file_info === "string"
        ? body.file_info
        : isRecord(body) && isRecord(body.data) && typeof body.data.file_info === "string"
          ? body.data.file_info
          : undefined;
    if (!value) throw new Error("QQ media upload returned no file_info.");
    return value;
  }
}

function filenameForMedia(media: AgentChannelMedia): string {
  if (media.path) return basename(media.path);
  if (media.url) {
    try {
      const value = basename(new URL(media.url).pathname);
      if (value) return value;
    } catch {
      // The URL is validated by the QQ API; use a deterministic fallback name.
    }
  }
  const extension = media.contentType?.split("/")[1]?.split(";")[0] ?? (media.kind === "image" ? "png" : "bin");
  return `senera-media.${extension}`;
}

function isSvgMedia(media: AgentChannelMedia): boolean {
  const mime = media.contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (mime === "image/svg+xml") return true;
  return [media.filename, media.path, media.url].some(
    (value) => typeof value === "string" && /\.svg(?:$|[?#])/iu.test(value),
  );
}

function assertRemoteMediaUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("QQ media URL is invalid.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new Error("QQ media URL must use http or https.");
}

function decodeMediaData(data: string): Uint8Array {
  const comma = data.indexOf(",");
  const encoded = data.startsWith("data:") && comma >= 0 ? data.slice(comma + 1) : data;
  if (!encoded.trim()) throw new Error("QQ media data is empty.");
  const normalized = encoded.replace(/\s+/g, "");
  if (normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized))
    throw new Error("QQ media data is not valid base64.");
  const bytes = new Uint8Array(Buffer.from(normalized, "base64"));
  if (bytes.byteLength === 0) throw new Error("QQ media data is empty.");
  return bytes;
}

function hashBytes(bytes: Uint8Array): { md5: string; sha1: string; md5_10m: string } {
  return {
    md5: createHash("md5").update(bytes).digest("hex"),
    sha1: createHash("sha1").update(bytes).digest("hex"),
    md5_10m: createHash("md5").update(bytes.subarray(0, 10_002_432)).digest("hex"),
  };
}

async function hashFile(
  filePath: string,
  expectedSize: number,
): Promise<{ md5: string; sha1: string; md5_10m: string }> {
  const md5 = createHash("md5");
  const sha1 = createHash("sha1");
  const md5_10m = createHash("md5");
  const handle = await open(filePath, "r");
  const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, Math.max(64 * 1024, expectedSize)));
  let position = 0;
  let prefixBytes = 0;
  try {
    while (position < expectedSize) {
      const result = await handle.read(buffer, 0, Math.min(buffer.byteLength, expectedSize - position), position);
      if (result.bytesRead <= 0) break;
      const chunk = buffer.subarray(0, result.bytesRead);
      md5.update(chunk);
      sha1.update(chunk);
      if (prefixBytes < 10_002_432) {
        md5_10m.update(chunk.subarray(0, 10_002_432 - prefixBytes));
        prefixBytes += Math.min(chunk.byteLength, 10_002_432 - prefixBytes);
      }
      position += result.bytesRead;
    }
  } finally {
    await handle.close();
  }
  if (position !== expectedSize)
    throw new Error(`QQ media file changed while hashing: expected ${expectedSize}, read ${position}.`);
  return { md5: md5.digest("hex"), sha1: sha1.digest("hex"), md5_10m: md5_10m.digest("hex") };
}

async function readFileRange(filePath: string, offset: number, length: number): Promise<Uint8Array> {
  const handle = await open(filePath, "r");
  const buffer = Buffer.allocUnsafe(length);
  let position = 0;
  try {
    while (position < length) {
      const result = await handle.read(buffer, position, length - position, offset + position);
      if (result.bytesRead <= 0) break;
      position += result.bytesRead;
    }
  } finally {
    await handle.close();
  }
  return new Uint8Array(buffer.subarray(0, position));
}

function isRetryableUploadBody(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const code = value.code ?? value.retcode ?? value.biz_code;
  return Number(code) === 40093001;
}

function isDailyUploadLimitBody(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const code = value.code ?? value.retcode ?? value.biz_code;
  return Number(code) === 40093002;
}

function isRetryableMediaError(error: unknown): boolean {
  if (error instanceof QqUploadRetryableError) return true;
  if (error instanceof AgentChannelHttpError) {
    return (
      isRetryableUploadBody(error.body) ||
      error.status === 0 ||
      error.status === 408 ||
      error.status === 425 ||
      error.status === 429 ||
      error.status >= 500
    );
  }
  return (
    error instanceof Error && /timeout|timed out|temporar|network|socket|econn|reset|429|5\d\d/i.test(error.message)
  );
}

async function backoff(attempt: number, maxDelayMs = 8_000): Promise<void> {
  const jitter = Math.floor(Math.random() * 250);
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, Math.min(maxDelayMs, 500 * 2 ** (attempt - 1) + jitter));
    timer.unref?.();
  });
}
