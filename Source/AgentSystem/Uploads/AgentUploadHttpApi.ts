import fs from "node:fs";
import fsp from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { pipeline, Transform, type Readable, type TransformCallback } from "node:stream";
import busboy from "busboy";
import { applyCredentialedCors, writeCorsPreflight } from "../Auth/AgentCredentialedCors.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import { formatAgentUploadUri } from "./AgentUploadLocator.js";
import { isAgentInlineImageMime } from "./AgentUploadMime.js";
import { AgentUploadError, AgentUploadFailureKinds, type AgentUploadStore } from "./AgentUploadStore.js";
import type { AgentUploadAttachment } from "./AgentUploadTypes.js";

export const AgentUploadHttpRoutes = {
  Uploads: "/api/uploads",
  ContentSegment: "content",
} as const;

type AgentUploadHttpRoute =
  | { readonly kind: "collection" }
  | { readonly kind: "content"; readonly uploadId: string }
  | { readonly kind: "invalid" };

export interface AgentUploadHttpApiOptions {
  store: AgentUploadStore;
  isOriginAllowed?: (origin: string) => boolean;
}

export class AgentUploadHttpApi {
  private maintenanceEnabled = false;
  private maintenanceTimer?: NodeJS.Timeout;

  constructor(private readonly options: AgentUploadHttpApiOptions) {}

  startMaintenance(): void {
    if (this.maintenanceEnabled) return;
    this.maintenanceEnabled = true;
    void this.options.store.maintain().catch(() => undefined);
    this.scheduleMaintenance();
  }

  stopMaintenance(): void {
    this.maintenanceEnabled = false;
    if (this.maintenanceTimer) {
      clearTimeout(this.maintenanceTimer);
      this.maintenanceTimer = undefined;
    }
  }

  canHandle(request: IncomingMessage): boolean {
    return this.readRoute(request) !== undefined;
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const route = this.readRoute(request);
    if (!route) {
      this.sendNotFound(response);
      return;
    }

    if (
      !applyCredentialedCors(request, response, {
        allowedMethods: ["GET", "HEAD", "POST", "OPTIONS"],
        isOriginAllowed: (origin) => this.options.isOriginAllowed?.(origin) ?? false,
      })
    ) {
      this.sendJson(response, 403, {
        ok: false,
        error: {
          code: "forbidden_origin",
          message: agentErrorMessage("auth.requestDenied"),
        },
      });
      return;
    }

    if (request.method === "OPTIONS") {
      writeCorsPreflight(response);
      return;
    }

    if (route.kind === "invalid") {
      this.sendNotFound(response);
      return;
    }

    try {
      if (route.kind === "collection") {
        await this.handleCollection(request, response);
      } else {
        await this.handleContent(request, response, route.uploadId);
      }
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      const statusCode = error instanceof AgentUploadError ? error.statusCode : 500;
      this.sendJson(response, statusCode, {
        ok: false,
        error: {
          code: error instanceof AgentUploadError ? error.code : "upload_failed",
          message: error instanceof AgentUploadError ? error.message : agentErrorMessage("upload.failed"),
        },
      });
    }
  }

  private async handleCollection(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== "POST") {
      this.sendJson(response, 405, {
        ok: false,
        error: {
          code: "method_not_allowed",
          message: agentErrorMessage("upload.methodPostOnly"),
        },
      });
      return;
    }

    const uploads = await this.collectUploads(request);
    if (uploads.length === 0) {
      throw AgentUploadError.from(AgentUploadFailureKinds.FileMissing);
    }

    this.sendJson(response, 200, {
      ok: true,
      uploads,
    });
  }

  private async handleContent(request: IncomingMessage, response: ServerResponse, uploadId: string): Promise<void> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      this.sendJson(response, 405, {
        ok: false,
        error: {
          code: "method_not_allowed",
          message: agentErrorMessage("upload.contentMethodReadOnly"),
        },
      });
      return;
    }

    const resolved = await this.resolveContentUpload(uploadId);
    if (!resolved) {
      this.sendNotFound(response);
      return;
    }

    const contentType = resolved.manifest.detectedMime;
    if (!isAgentInlineImageMime(contentType)) {
      this.sendJson(response, 415, {
        ok: false,
        error: {
          code: "upload_content_unsupported",
          message: agentErrorMessage("upload.contentUnsupported"),
        },
      });
      return;
    }

    let contentLength: number;
    try {
      const stats = await fsp.stat(resolved.filePath);
      if (!stats.isFile()) {
        this.sendNotFound(response);
        return;
      }
      contentLength = stats.size;
    } catch (error) {
      if (isMissingFileError(error)) {
        this.sendNotFound(response);
        return;
      }
      throw error;
    }

    const etag = formatUploadContentEtag(resolved.manifest.sha256);
    const headers = {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "Content-Length": contentLength,
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Type": contentType,
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
    } as const;

    if (matchesIfNoneMatch(request.headers["if-none-match"], etag)) {
      response.writeHead(304, headers);
      response.end();
      return;
    }

    response.writeHead(200, headers);
    if (request.method === "HEAD") {
      response.end();
      return;
    }

    await new Promise<void>((resolve, reject) => {
      pipeline(fs.createReadStream(resolved.filePath), response, (error) => (error ? reject(error) : resolve()));
    });
  }

  private async resolveContentUpload(uploadId: string) {
    try {
      return await this.options.store.resolve(formatAgentUploadUri(uploadId));
    } catch (error) {
      if (isMissingFileError(error)) return undefined;
      throw error;
    }
  }

  private collectUploads(request: IncomingMessage): Promise<AgentUploadAttachment[]> {
    return new Promise((resolve, reject) => {
      const uploads: Array<Promise<AgentUploadAttachment>> = [];
      const store = this.options.store;
      let collectionError: unknown;
      let completed = false;
      const parser = busboy({
        headers: request.headers,
        defParamCharset: "utf8",
        limits: {
          fileSize: store.maxFileBytes,
          files: store.maxFilesPerRequest,
        },
      });
      const requestLimiter = new UploadRequestByteLimiter(store.maxRequestBytes);

      parser.on("file", (_fieldName, file, info) => {
        if (collectionError) {
          file.resume();
          return;
        }
        file.on("limit", () => {
          file.destroy(AgentUploadError.from(AgentUploadFailureKinds.FileTooLarge));
        });
        uploads.push(
          store
            .save({
              stream: file as Readable,
              originalName: info.filename,
              declaredMime: info.mimeType,
            })
            .catch((error: unknown) => {
              file.resume();
              throw error;
            }),
        );
      });
      parser.on("filesLimit", () => {
        collectionError ??= AgentUploadError.from(AgentUploadFailureKinds.FileCountExceeded);
      });
      request.on("aborted", () => {
        collectionError ??= AgentUploadError.from(AgentUploadFailureKinds.Aborted);
      });

      pipeline(request, requestLimiter, parser, (pipelineError) => {
        if (completed) return;
        completed = true;
        void settleUploadCollection({
          uploads,
          store,
          error: pipelineError instanceof AgentUploadError ? pipelineError : (collectionError ?? pipelineError),
        }).then(resolve, reject);
      });
    });
  }

  private scheduleMaintenance(): void {
    if (!this.maintenanceEnabled) return;
    this.maintenanceTimer = setTimeout(() => {
      this.maintenanceTimer = undefined;
      void this.options.store
        .maintain()
        .catch(() => undefined)
        .finally(() => this.scheduleMaintenance());
    }, this.options.store.maintenanceIntervalMs);
    this.maintenanceTimer.unref();
  }

  private readRoute(request: IncomingMessage): AgentUploadHttpRoute | undefined {
    let pathname: string;
    try {
      pathname = new URL(request.url ?? "/", "http://senera.local").pathname;
    } catch {
      return undefined;
    }

    if (pathname === AgentUploadHttpRoutes.Uploads) {
      return { kind: "collection" };
    }
    if (!pathname.startsWith(`${AgentUploadHttpRoutes.Uploads}/`)) {
      return undefined;
    }

    const segments = pathname.slice(AgentUploadHttpRoutes.Uploads.length + 1).split("/");
    if (segments.length !== 2 || segments[1] !== AgentUploadHttpRoutes.ContentSegment) {
      return { kind: "invalid" };
    }
    try {
      return { kind: "content", uploadId: decodeURIComponent(segments[0]) };
    } catch {
      return { kind: "invalid" };
    }
  }

  private sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
    response.writeHead(statusCode, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify(payload));
  }

  private sendNotFound(response: ServerResponse): void {
    this.sendJson(response, 404, {
      ok: false,
      error: {
        code: "upload_content_not_found",
        message: agentErrorMessage("upload.contentNotFound"),
      },
    });
  }
}

function formatUploadContentEtag(sha256: string): string {
  return `"${sha256}"`;
}

function matchesIfNoneMatch(value: string | string[] | undefined, etag: string): boolean {
  const validators = Array.isArray(value) ? value : value?.split(",");
  return (
    validators?.some((candidate) => {
      const normalized = candidate.trim();
      return normalized === "*" || normalized === etag || normalized === `W/${etag}`;
    }) ?? false
  );
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

interface SettleUploadCollectionOptions {
  uploads: readonly Promise<AgentUploadAttachment>[];
  store: AgentUploadStore;
  error?: unknown;
}

async function settleUploadCollection(options: SettleUploadCollectionOptions): Promise<AgentUploadAttachment[]> {
  const results = await Promise.allSettled(options.uploads);
  const uploads = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  const error = options.error ?? rejected?.reason;
  if (!error) return uploads;

  await options.store.deleteMany(uploads.map((upload) => upload.uploadUri));
  throw normalizeUploadError(error);
}

function normalizeUploadError(error: unknown): Error {
  if (error instanceof AgentUploadError) return error;
  if (error instanceof Error && "code" in error && error.code === "ERR_STREAM_PREMATURE_CLOSE") {
    return AgentUploadError.from(AgentUploadFailureKinds.Aborted);
  }
  return error instanceof Error ? error : new Error(String(error));
}

class UploadRequestByteLimiter extends Transform {
  private byteLength = 0;

  constructor(private readonly maxRequestBytes: number) {
    super();
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.byteLength += chunk.byteLength;
    if (this.byteLength > this.maxRequestBytes) {
      callback(AgentUploadError.from(AgentUploadFailureKinds.RequestTooLarge));
      return;
    }
    callback(null, chunk);
  }
}
